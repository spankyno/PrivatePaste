import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { logger } from 'hono/logger'
import { nanoid } from 'nanoid'
import type { Env } from './lib/types'
import { authMiddleware } from './middleware/auth'
import { rateLimitMiddleware, authRateLimit } from './middleware/rateLimit'
import pastesRouter from './routes/pastes'
import foldersRouter from './routes/folders'
import { handleScheduled } from './cron'
import { verifyTurnstile } from './lib/turnstile'

const app = new Hono<{ Bindings: Env }>()

// ⚠ Sustituye con tu URL real del Worker tras el primer deploy
const PRODUCTION_URL = 'https://privatepaste-production.YOUR_SUBDOMAIN.workers.dev'

// ─── Middleware global ────────────────────────────────────────────────────────
// Fix 3: CSP explícita — secureHeaders() por defecto no la configura
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc:  ["'self'"],
    scriptSrc:   ["'self'", "'unsafe-inline'", 'https://challenges.cloudflare.com'],   // necesario para el build de Vite y Turnstile
    styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
    imgSrc:      ["'self'", 'data:'],
    connectSrc:  ["'self'", 'https://challenges.cloudflare.com'],
    frameSrc:    ["'self'", 'https://challenges.cloudflare.com'],
    objectSrc:   ["'none'"],
    baseUri:     ["'self'"],
  },
  xFrameOptions:         'DENY',
  xContentTypeOptions:   'nosniff',
  referrerPolicy:        'strict-origin-when-cross-origin',
}))
app.use('*', cors({
  // Fix 2: localhost solo permitido en desarrollo
  origin: (origin, c) => {
    const env = (c.env as { ENVIRONMENT?: string }).ENVIRONMENT
    if (env !== 'production' && origin === 'http://localhost:5173') return origin
    return origin === PRODUCTION_URL ? origin : null
  },
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))
app.use('/api/*', logger())
app.use('/api/*', authMiddleware)
app.use('/api/*', rateLimitMiddleware)

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }))

// ─── Auth helpers ─────────────────────────────────────────────────────────────
// ─── Crypto helpers — PBKDF2 (100k iter) + timing-safe compare ──────────────

/** Convierte Uint8Array a hex string */
function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Comparación de strings en tiempo constante — evita timing attacks */
function timingSafeEqual(a: string, b: string): boolean {
  const ua = new TextEncoder().encode(a)
  const ub = new TextEncoder().encode(b)
  if (ua.length !== ub.length) return false
  let diff = 0
  for (let i = 0; i < ua.length; i++) diff |= (ua[i] ?? 0) ^ (ub[i] ?? 0)
  return diff === 0
}

/** Hash de contraseña con PBKDF2-SHA256 (100.000 iteraciones) + salt aleatorio de 16 bytes */
async function hashPw(password: string): Promise<string> {
  const salt      = crypto.getRandomValues(new Uint8Array(16))
  const saltHex   = toHex(salt.buffer)
  const keyMat    = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits      = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, keyMat, 256)
  return `pbkdf2:${saltHex}:${toHex(bits)}`
}

/** Verifica contraseña — soporta el formato antiguo sha256 y el nuevo pbkdf2 */
async function verifyPw(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('pbkdf2:')) {
    // Formato nuevo: pbkdf2:saltHex:hashHex
    const parts   = stored.split(':')
    const saltHex = parts[1] ?? ''
    const hashHex = parts[2] ?? ''
    const saltBuf = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
    const keyMat  = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
    const bits    = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBuf, iterations: 100_000, hash: 'SHA-256' }, keyMat, 256)
    return timingSafeEqual(toHex(bits), hashHex)
  }
  // Formato antiguo sha256: saltHex:hashHex — comparación segura igualmente
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const data    = new TextEncoder().encode(salt + password)
  const newHash = await crypto.subtle.digest('SHA-256', data)
  return timingSafeEqual(toHex(newHash), hash)
}
function setCookie(token: string, clear = false): string {
  return `pp_session=${clear ? '' : token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${clear ? 0 : 2592000}`
}
function jsonRes(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...headers }
  })
}

/** En producción, nunca exponer detalles internos de errores al cliente */
function safeError(c: { env: { ENVIRONMENT: string } }, publicMsg: string, internalErr: unknown, status = 500) {
  console.error(`[${publicMsg}]`, internalErr)
  const isProd = c.env.ENVIRONMENT === 'production'
  return jsonRes({ error: publicMsg, ...(isProd ? {} : { detail: String(internalErr) }) }, status)
}

// ─── POST /api/auth/sign-up/email ─────────────────────────────────────────────
app.post('/api/auth/sign-up/email', authRateLimit, async (c) => {
  try {
    const body = await c.req.json<{
      email: string
      password: string
      name?: string
      turnstileToken?: string
      website?: string
    }>()
    if (!body.email || !body.password)
      return jsonRes({ error: 'Email and password required' }, 400)
    if (body.password.length < 8)
      return jsonRes({ error: 'Password must be at least 8 characters' }, 400)
    
    // Honeypot check (website must be empty)
    if (body.website)
      return jsonRes({ error: 'Bot registration blocked' }, 400)

    // Fix 1: validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
    if (!emailRegex.test(body.email) || body.email.length > 254)
      return jsonRes({ error: 'Invalid email format' }, 400)

    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
    
    // Turnstile verification
    const turnstileOk = await verifyTurnstile(body.turnstileToken, c.env.TURNSTILE_SECRET_KEY, ip)
    if (!turnstileOk) {
      return jsonRes({ error: 'Turnstile verification failed' }, 400)
    }

    const db  = c.env.DB
    const now = Math.floor(Date.now() / 1000)

    const existing = await db.prepare('SELECT id FROM users WHERE email = ?')
      .bind(body.email.toLowerCase()).first()
    if (existing) return jsonRes({ error: 'Email already registered' }, 409)

    const userId = nanoid()
    const token  = nanoid(32)
    const exp    = now + 2592000

    await db.prepare(
      'INSERT INTO users (id, email, name, role, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    ).bind(userId, body.email.toLowerCase(), body.name ?? null, 'registered', now, now).run()

    await db.prepare(
      'INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
    ).bind(nanoid(), userId, 'email', userId, await hashPw(body.password), now, now).run()

    await db.prepare(
      'INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(nanoid(), userId, token, exp,
      c.req.header('CF-Connecting-IP') ?? null,
      c.req.header('User-Agent') ?? null,
      now, now).run()

    return jsonRes(
      { user: { id: userId, email: body.email.toLowerCase(), name: body.name ?? null, role: 'registered' } },
      201, { 'Set-Cookie': setCookie(token) }
    )
  } catch (err) {
    return safeError(c, 'Registration failed', err)
  }
})

// ─── POST /api/auth/sign-in/email ─────────────────────────────────────────────
app.post('/api/auth/sign-in/email', authRateLimit, async (c) => {
  try {
    const body = await c.req.json<{ email: string; password: string }>()
    if (!body.email || !body.password)
      return jsonRes({ error: 'Email and password required' }, 400)

    const db  = c.env.DB
    const now = Math.floor(Date.now() / 1000)

    const user = await db.prepare('SELECT * FROM users WHERE email = ?')
      .bind(body.email.toLowerCase()).first<any>()
    if (!user) return jsonRes({ error: 'Invalid email or password' }, 401)

    const account = await db.prepare('SELECT password FROM accounts WHERE user_id = ? AND provider_id = ?')
      .bind(user.id, 'email').first<{ password: string }>()
    if (!account?.password) return jsonRes({ error: 'Invalid email or password' }, 401)

    if (!await verifyPw(body.password, account.password))
      return jsonRes({ error: 'Invalid email or password' }, 401)

    const token = nanoid(32)
    const exp   = now + 2592000

    await db.prepare(
      'INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(nanoid(), user.id, token, exp,
      c.req.header('CF-Connecting-IP') ?? null,
      c.req.header('User-Agent') ?? null,
      now, now).run()

    return jsonRes(
      { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
      200, { 'Set-Cookie': setCookie(token) }
    )
  } catch (err) {
    return safeError(c, 'Login failed', err)
  }
})

// ─── POST /api/auth/sign-out ──────────────────────────────────────────────────
app.post('/api/auth/sign-out', async (c) => {
  const cookie = c.req.header('Cookie') ?? ''
  const token  = cookie.match(/(?:^|;\s*)pp_session=([^;]+)/)?.[1]
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
  }
  return jsonRes({ success: true }, 200, { 'Set-Cookie': setCookie('', true) })
})

// ─── GET /api/auth/session ────────────────────────────────────────────────────
app.get('/api/auth/session', async (c) => {
  const cookie = c.req.header('Cookie') ?? ''
  const token  = cookie.match(/(?:^|;\s*)pp_session=([^;]+)/)?.[1]
  if (!token) return jsonRes({ session: null, user: null })

  const now = Math.floor(Date.now() / 1000)
  const row = await c.env.DB.prepare(`
    SELECT s.id as sid, s.expires_at, u.id, u.email, u.name, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? LIMIT 1
  `).bind(token).first<any>()

  if (!row || row.expires_at < now) return jsonRes({ session: null, user: null })
  return jsonRes({
    session: { id: row.sid, expiresAt: row.expires_at },
    user:    { id: row.id, email: row.email, name: row.name, role: row.role },
  })
})

// ─── GET /api/me ──────────────────────────────────────────────────────────────
app.get('/api/me', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ user: null, tier: 'anon' })
  return c.json({ user, tier: c.get('tier') })
})

// ─── Pastes + Folders ─────────────────────────────────────────────────────────
app.route('/api/pastes',  pastesRouter)
app.route('/api/folders', foldersRouter)

// ─── Raw ──────────────────────────────────────────────────────────────────────
app.get('/raw/:id', async (c) => {
  const { id } = c.req.param()
  const now    = Math.floor(Date.now() / 1000)
  const paste  = await c.env.DB.prepare('SELECT * FROM pastes WHERE id = ?').bind(id).first<any>()
  if (!paste)                                     return c.text('Not found', 404)
  if (paste.expires_at && paste.expires_at < now) return c.text('Expired', 410)
  if (paste.visibility === 'private' && paste.user_id !== c.get('userId'))
                                                  return c.text('Private', 403)
  if (paste.visibility === 'password' && paste.user_id !== c.get('userId'))
                                                  return c.text('Password required', 403)
  c.executionCtx.waitUntil(
    c.env.DB.prepare('UPDATE pastes SET views = views + 1 WHERE id = ?').bind(id).run()
  )
  return c.text(paste.content, 200, { 'Content-Type': 'text/plain; charset=utf-8' })
})

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', async (c) => {
  try { return await c.env.ASSETS.fetch(c.req.raw) }
  catch { return c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url))) }
})

export default { fetch: app.fetch, scheduled: handleScheduled }
