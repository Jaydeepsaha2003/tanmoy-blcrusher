import path from 'node:path'
import express, { type Request, type Response } from 'express'
import { parse as parseCookie, serialize as serializeCookie } from 'cookie'
import { handlers } from '../src/main/handlers'
import { authenticate, getUserById } from '../src/main/services/users'
import { setCurrentUser } from '../src/main/context'
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
import { getDb } from '../src/main/db'

function failed(result: unknown): boolean {
  return (
    !!result && typeof result === 'object' && 'ok' in result && (result as { ok: unknown }).ok === false
  )
}

// Passenger (Hostinger Node hosting) may hand us a Unix-socket path in PORT, so
// keep the raw value rather than coercing to a number.
const PORT: string | number = process.env.PORT || 3000
// Bind a specific interface only when asked (the Docker image sets 0.0.0.0).
// Under Passenger, leave HOST unset so its patched listen() binds its own socket.
const HOST = process.env.HOST
const COOKIE = 'bl_session'
// Set SECURE_COOKIE=1 in production (behind HTTPS) so the cookie is only sent
// over TLS. Leave unset for plain-HTTP local testing.
const SECURE = process.env.SECURE_COOKIE === '1' || process.env.SECURE_COOKIE === 'true'

// Default the data dir next to the working directory if the host didn't set one.
if (!process.env.BL_DB_DIR) process.env.BL_DB_DIR = path.resolve(process.cwd(), 'data')

// Where the built renderer (index.html + assets) lives.
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

function clearSessionCookie(res: express.Response): void {
  res.setHeader(
    'Set-Cookie',
    serializeCookie(COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: SECURE,
      path: '/',
      maxAge: 0
    })
  )
}

function tokenFrom(req: express.Request): string | undefined {
  return parseCookie(req.headers.cookie || '')[COOKIE]
}

const app = express()
// Honour X-Forwarded-* from the cloud load balancer (needed for secure cookies).
app.set('trust proxy', 1)
app.use(express.json({ limit: '5mb' }))

// Liveness probe for cloud platforms.
app.get('/healthz', (_req, res) => {
  res.type('text').send('ok')
})

// Single API endpoint — mirrors the desktop IPC bridge, gated by a session and
// per-user permissions, with an audit trail for mutating actions.
app.post('/api/call', (req, res) => {
  const { method, payload } = (req.body ?? {}) as { method?: string; payload?: unknown }
  if (!method) return res.status(400).json({ error: 'Missing method.' })
  const token = tokenFrom(req)
  const ip = req.ip || ''

  try {
    // --- Auth methods manage the session cookie ---
    if (method === 'auth.login') {
      const creds = (payload ?? {}) as { username?: string; password?: string }
      const user = authenticate(creds.username || '', creds.password || '')
      if (!user) return res.json({ result: { ok: false } })
      setSessionCookie(res, createSession(user.id))
      logActivity({ method: 'auth.login', user, ip })
      return res.json({ result: { ok: true, user } })
    }
    if (method === 'auth.me') {
      const uid = sessionUserId(token)
      const user = uid ? getUserById(uid) : null
      return res.json({ result: { ok: !!user, user } })
    }
    if (method === 'auth.logout') {
      const uid = sessionUserId(token)
      const user = uid ? getUserById(uid) : null
      if (user) logActivity({ method: 'auth.logout', user, ip })
      destroySession(token)
      clearSessionCookie(res)
      return res.json({ result: { ok: true } })
    }

    // --- Everything else requires a valid session + permission ---
    const uid = sessionUserId(token)
    const user: User | null = uid ? getUserById(uid) : null
    if (!user) return res.status(401).json({ error: 'Not authenticated.' })
    if (!can(user, method)) {
      return res.status(403).json({ error: 'You do not have permission to do that.' })
    }
    const fn = handlers[method]
    if (!fn) return res.status(400).json({ error: `Unknown API method: ${method}` })

    setCurrentUser(user)
    try {
      const result = fn(payload)
      if ((isWriteMethod(method) || SELF_METHODS.has(method)) && !failed(result)) {
        logActivity({ method, payload, user, ip })
      }
      return res.json({ result })
    } finally {
      setCurrentUser(null)
    }
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

// Initialise the DB (creates file + schema + default password) and tidy sessions.
getDb()
cleanupSessions()

function onListening(): void {
  // eslint-disable-next-line no-console
  console.log(`BL Crusher Manager web server listening (port ${PORT}${HOST ? `, host ${HOST}` : ''})`)
  // eslint-disable-next-line no-console
  console.log(`  data dir : ${process.env.BL_DB_DIR}`)
  // eslint-disable-next-line no-console
  console.log(`  static   : ${STATIC_DIR}`)
}

if (HOST) app.listen(PORT as number, HOST, onListening)
else app.listen(PORT as number, onListening)
