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
