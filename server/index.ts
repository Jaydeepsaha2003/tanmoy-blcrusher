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
      if (!user) {
        // Record failed attempts (username only — never the password) for security review.
        await logActivity({ method: 'auth.loginFailed', payload: { username: creds.username || '' }, ip })
        return res.json({ result: { ok: false } })
      }
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

function initials(name: string): string {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

function renderRatePage(data: PublicRateList): string {
  const updated = data.updated_at
    ? new Date(data.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : ''
  const rows = data.rates.length
    ? data.rates
        .map(
          (r) => `
            <tr>
              <td class="prod">${esc(r.product_name)}</td>
              <td><span class="unit">${esc(r.uom)}</span></td>
              <td class="r">₹${fmtRate(r.rate)}</td>
            </tr>`
        )
        .join('')
    : ''

  const body = data.rates.length
    ? `<div class="card">
         <table>
           <thead><tr><th>Product</th><th>Unit</th><th class="r">Rate</th></tr></thead>
           <tbody>${rows}</tbody>
         </table>
       </div>`
    : `<div class="card empty">No rates have been published yet. Please contact us for a quote.</div>`

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<meta name="robots" content="noindex,nofollow"/>
<meta name="theme-color" content="#0b1220"/>
<title>${esc(data.business_name)} — Rate List</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
<style>
  :root { color-scheme: light; --bg:#eef1f6; --ink:#0f1729; --muted:#64748b; --line:#eceef2; --brand:#1f6feb; --brand2:#0b3aa3; }
  * { box-sizing: border-box; }
  html,body { margin:0; }
  body { font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg);
         color:var(--ink); -webkit-font-smoothing:antialiased; line-height:1.5; }
  .wrap { max-width: 600px; margin:0 auto; padding: 0 16px 56px; }
  .hero { margin: 18px 0 0; border-radius: 22px; padding: 30px 24px 26px; color:#fff; text-align:center;
          background: radial-gradient(120% 120% at 50% -10%, #2b7bff 0%, var(--brand) 45%, var(--brand2) 100%);
          box-shadow: 0 18px 40px -18px rgba(31,111,235,.6); }
  .avatar { width:56px; height:56px; border-radius:16px; margin:0 auto 12px; display:flex; align-items:center;
            justify-content:center; font-weight:800; font-size:20px; letter-spacing:.02em;
            background:rgba(255,255,255,.18); backdrop-filter:blur(4px); border:1px solid rgba(255,255,255,.25); }
  .hero .biz { font-size: 23px; font-weight: 800; letter-spacing:-.02em; }
  .hero .sub { opacity:.92; font-size: 13.5px; margin-top:4px; font-weight:500; }
  .badge { display:inline-block; margin-top:14px; background:rgba(255,255,255,.16); border:1px solid rgba(255,255,255,.28);
           color:#fff; font-weight:600; font-size:12px; padding:6px 14px; border-radius:999px; letter-spacing:.02em; }
  .card { background:#fff; border:1px solid #e8ebf1; border-radius:18px; margin-top:18px; overflow:hidden;
          box-shadow: 0 6px 24px -16px rgba(15,23,41,.25); }
  .card.empty { padding:28px 20px; text-align:center; color:var(--muted); font-size:14px; }
  table { width:100%; border-collapse: collapse; font-size:15px; }
  thead th { background:#f8fafc; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.06em;
             color:var(--muted); font-weight:700; padding:12px 18px; border-bottom:1px solid var(--line); }
  thead th.r, td.r { text-align:right; }
  tbody td { padding:14px 18px; border-bottom:1px solid var(--line); }
  tbody tr:last-child td { border-bottom:none; }
  tbody tr:nth-child(even) { background:#fcfdfe; }
  .prod { font-weight:600; }
  .unit { display:inline-block; background:#eef4ff; color:#2563cc; font-weight:600; font-size:12px;
          padding:3px 9px; border-radius:7px; }
  td.r { font-weight:700; font-variant-numeric: tabular-nums; white-space:nowrap; }
  footer { text-align:center; color:#94a0b3; font-size:12px; margin-top:22px; line-height:1.7; }
  footer b { color:#64748b; font-weight:600; }
</style>
</head><body>
  <div class="wrap">
    <div class="hero">
      <div class="avatar">${esc(initials(data.business_name))}</div>
      <div class="biz">${esc(data.business_name)}</div>
      <div class="sub">Rate list prepared for ${esc(data.customer_name)}</div>
      <div class="badge">CURRENT PRICES</div>
    </div>
    ${body}
    <footer>
      ${updated ? `<b>Updated ${esc(updated)}</b><br/>` : ''}
      Prices are indicative and subject to change. Please confirm before placing an order.
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
