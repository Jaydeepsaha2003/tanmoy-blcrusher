import path from 'node:path'
import express, { type Request, type Response } from 'express'
import { parse as parseCookie, serialize as serializeCookie } from 'cookie'
import { handlers } from '../src/main/handlers'
import { authenticate, getUserById } from '../src/main/services/users'
import { runWithUser } from '../src/main/context'
import { logActivity } from '../src/main/services/audit'
import { can, isWriteMethod, SELF_METHODS } from '../src/shared/permissions'
import type { User } from '../src/shared/types'
import {
  createSession,
  sessionUserId,
  destroySession,
  cleanupSessions,
  SESSION_TTL_MS
} from '../src/main/services/sessions'
import { initDb } from '../src/main/db'
import { maybeRunScheduledDeletion } from '../src/main/services/system'
import { publicRateList } from '../src/main/services/rates'
import type { PublicRateList } from '../src/shared/types'

// Throttle the "is a scheduled deletion due?" check on request activity.
let lastDeletionCheck = 0

function failed(result: unknown): boolean {
  return (
    !!result && typeof result === 'object' && 'ok' in result && (result as { ok: unknown }).ok === false
  )
}

// Passenger (Hostinger Node hosting) may hand us a Unix-socket path in PORT, so
// keep the raw value rather than coercing to a number.
const PORT: string | number = process.env.PORT || 3000
const HOST = process.env.HOST
const COOKIE = 'bl_session'
const SECURE = process.env.SECURE_COOKIE === '1' || process.env.SECURE_COOKIE === 'true'

// SQLite fallback dir (ignored when DB_HOST/DB_NAME selects MySQL).
if (!process.env.BL_DB_DIR) process.env.BL_DB_DIR = path.resolve(process.cwd(), 'data')

const STATIC_DIR = process.env.BL_STATIC_DIR || path.resolve(process.cwd(), 'out/renderer')

function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    'Set-Cookie',
    serializeCookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: SECURE,
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000)
    })
  )
}

function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    serializeCookie(COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: SECURE, path: '/', maxAge: 0 })
  )
}

function tokenFrom(req: Request): string | undefined {
  return parseCookie(req.headers.cookie || '')[COOKIE]
}

const app = express()
app.set('trust proxy', 1)
app.use(express.json({ limit: '5mb' }))

app.get('/healthz', (_req, res) => {
  res.type('text').send('ok')
})

// Single API endpoint — session + per-user permissions + audit, all async.
app.post('/api/call', async (req, res) => {
  const { method, payload } = (req.body ?? {}) as { method?: string; payload?: unknown }
  if (!method) return res.status(400).json({ error: 'Missing method.' })
  const token = tokenFrom(req)
  const ip = req.ip || ''

  // Fire the due-deletion check at most every 10 min, so it runs even if the
  // host suspended the process and the hourly interval missed.
  if (Date.now() - lastDeletionCheck > 600000) {
    lastDeletionCheck = Date.now()
    void maybeRunScheduledDeletion().catch(() => {})
  }

  try {
    if (method === 'auth.login') {
      const creds = (payload ?? {}) as { username?: string; password?: string }
      const user = await authenticate(creds.username || '', creds.password || '')
      if (!user) return res.json({ result: { ok: false } })
      setSessionCookie(res, await createSession(user.id))
      await logActivity({ method: 'auth.login', user, ip })
      return res.json({ result: { ok: true, user } })
    }
    if (method === 'auth.me') {
      const uid = await sessionUserId(token)
      const user = uid ? await getUserById(uid) : null
      return res.json({ result: { ok: !!user, user } })
    }
    if (method === 'auth.logout') {
      const uid = await sessionUserId(token)
      const user = uid ? await getUserById(uid) : null
      if (user) await logActivity({ method: 'auth.logout', user, ip })
      await destroySession(token)
      clearSessionCookie(res)
      return res.json({ result: { ok: true } })
    }

    // Everything else requires a valid session + permission.
    const uid = await sessionUserId(token)
    const user: User | null = uid ? await getUserById(uid) : null
    if (!user) return res.status(401).json({ error: 'Not authenticated.' })
    if (!can(user, method)) {
      return res.status(403).json({ error: 'You do not have permission to do that.' })
    }
    const fn = handlers[method]
    if (!fn) return res.status(400).json({ error: `Unknown API method: ${method}` })

    const result = await runWithUser(user, async () => {
      const r = await fn(payload)
      if ((isWriteMethod(method) || SELF_METHODS.has(method)) && !failed(r)) {
        await logActivity({ method, payload, user, ip })
      }
      return r
    })
    return res.json({ result })
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message || 'Operation failed' })
  }
})

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )
}

function fmtRate(n: number): string {
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function renderRatePage(data: PublicRateList): string {
  const updated = data.updated_at ? new Date(data.updated_at).toLocaleDateString('en-IN') : ''
  const sections = data.groups.length
    ? data.groups
        .map(
          (g) => `
        <section class="card">
          <h2>${esc(g.plant_name)}</h2>
          <table>
            <thead><tr><th>Product</th><th>Unit</th><th class="r">Rate</th></tr></thead>
            <tbody>
              ${g.rates
                .map(
                  (r) =>
                    `<tr><td>${esc(r.product_name)}</td><td>${esc(r.uom)}</td><td class="r">₹ ${fmtRate(r.rate)}</td></tr>`
                )
                .join('')}
            </tbody>
          </table>
        </section>`
        )
        .join('')
    : `<section class="card"><p class="muted">No rates have been published yet. Please contact us.</p></section>`

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>${esc(data.business_name)} — Rate List</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:#f4f5f7; color:#1f2430; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 20px 16px 48px; }
  header { text-align:center; padding: 22px 0 10px; }
  header .biz { font-size: 22px; font-weight: 800; letter-spacing:-.01em; }
  header .sub { color:#6b7280; font-size: 13px; margin-top:2px; }
  .pill { display:inline-block; margin-top:12px; background:#1f6feb; color:#fff; font-weight:600; font-size:13px; padding:6px 14px; border-radius:999px; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:14px 16px; margin-top:16px; box-shadow:0 1px 2px rgba(0,0,0,.04); }
  .card h2 { margin:0 0 10px; font-size:15px; font-weight:700; color:#111827; }
  table { width:100%; border-collapse: collapse; font-size:14px; }
  th, td { text-align:left; padding:9px 8px; border-bottom:1px solid #f0f1f3; }
  th { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#6b7280; }
  tr:last-child td { border-bottom:none; }
  .r { text-align:right; font-variant-numeric: tabular-nums; font-weight:600; white-space:nowrap; }
  .muted { color:#6b7280; }
  footer { text-align:center; color:#9aa1ab; font-size:12px; margin-top:24px; }
</style>
</head><body>
  <div class="wrap">
    <header>
      <div class="biz">${esc(data.business_name)}</div>
      <div class="sub">Rate List for ${esc(data.customer_name)}</div>
      <div class="pill">Current Prices</div>
    </header>
    ${sections}
    <footer>
      ${updated ? `Rates last updated ${esc(updated)}. ` : ''}Prices are indicative and subject to change.
    </footer>
  </div>
</body></html>`
}

// Public, no-login rate page (random token per customer). Registered before the
// static handler so it always renders live data, not the SPA shell.
app.get('/rates/:token', async (req, res) => {
  try {
    const data = await publicRateList({ token: req.params.token })
    if (!data) {
      res
        .status(404)
        .type('html')
        .send(
          '<!doctype html><meta charset="utf-8"/><body style="font-family:system-ui;text-align:center;padding:48px;color:#374151"><h2>Rate list not found</h2><p>This link is invalid or has been revoked.</p></body>'
        )
      return
    }
    res.set('Cache-Control', 'no-store')
    res.type('html').send(renderRatePage(data))
  } catch {
    res.status(500).type('text').send('Unable to load rate list.')
  }
})

// Static renderer + SPA fallback (HashRouter, so index.html covers all routes).
app.use(express.static(STATIC_DIR))
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
  res.sendFile(path.join(STATIC_DIR, 'index.html'))
})

function onListening(): void {
  // eslint-disable-next-line no-console
  console.log(`BL Crusher Manager web server listening (port ${PORT}${HOST ? `, host ${HOST}` : ''})`)
  // eslint-disable-next-line no-console
  console.log(`  static : ${STATIC_DIR}`)
}

// Initialise the database (connect + migrate + seed) BEFORE accepting traffic.
initDb()
  .then(async () => {
    await cleanupSessions()
    await maybeRunScheduledDeletion().catch(() => false)
    // Re-check hourly while the process is alive.
    setInterval(() => void maybeRunScheduledDeletion().catch(() => false), 60 * 60 * 1000)
    if (HOST) app.listen(PORT as number, HOST, onListening)
    else app.listen(PORT as number, onListening)
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Database initialisation failed:', err)
    process.exit(1)
  })
