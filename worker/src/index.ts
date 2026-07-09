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
import { sendEmail, verificationEmailHtml } from './lib/email'
import { verifyTurnstile } from './lib/turnstile'

const app = new Hono<{ Bindings: Env }>()

const PRODUCTION_URL = 'https://privatepaste-production.kbo1.workers.dev'

// ─── Middleware global ────────────────────────────────────────────────────────
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc:  ["'self'"],
    scriptSrc:   ["'self'", "'unsafe-inline'", 'https://challenges.cloudflare.com'],
    styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
    imgSrc:      ["'self'", 'data:'],
    connectSrc:  ["'self'", 'https://challenges.cloudflare.com'],
    frameSrc:    ["'self'", 'https://challenges.cloudflare.com'],  // Turnstile iframe
    objectSrc:   ["'none'"],
    baseUri:     ["'self'"],
  },
  xFrameOptions:         'SAMEORIGIN',  // DENY rompería el iframe de Turnstile
  xContentTypeOptions:   'nosniff',
  referrerPolicy:        'strict-origin-when-cross-origin',
}))
app.use('*', cors({
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

// ─── Crypto helpers — PBKDF2 (100k iter) + timing-safe compare ───────────────

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  const ua = new TextEncoder().encode(a)
  const ub = new TextEncoder().encode(b)
  if (ua.length !== ub.length) return false
  let diff = 0
  for (let i = 0; i < ua.length; i++) diff |= (ua[i] ?? 0) ^ (ub[i] ?? 0)
  return diff === 0
}

async function hashPw(password: string): Promise<string> {
  const salt    = crypto.getRandomValues(new Uint8Array(16))
  const saltHex = toHex(salt.buffer)
  const keyMat  = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits    = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, keyMat, 256)
  return `pbkdf2:${saltHex}:${toHex(bits)}`
}

async function verifyPw(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('pbkdf2:')) {
    const parts   = stored.split(':')
    const saltHex = parts[1] ?? ''
    const hashHex = parts[2] ?? ''
    const saltBuf = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
    const keyMat  = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
    const bits    = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBuf, iterations: 100_000, hash: 'SHA-256' }, keyMat, 256)
    return timingSafeEqual(toHex(bits), hashHex)
  }
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

function safeError(c: { env: Env }, publicMsg: string, internalErr: unknown, status = 500) {
  console.error(`[${publicMsg}]`, internalErr)
  const isProd = c.env.ENVIRONMENT === 'production'
  return jsonRes({ error: publicMsg, ...(isProd ? {} : { detail: String(internalErr) }) }, status)
}

/** Serializa un usuario de D1 al shape que espera el frontend */
function serializeUser(u: any) {
  return {
    id:              u.id,
    email:           u.email,
    name:            u.name ?? null,
    role:            u.role,
    proExpiresAt:    u.pro_expires_at    ?? null,
    emailVerifiedAt: u.email_verified_at ?? null,
  }
}

// ─── POST /api/auth/sign-up/email ─────────────────────────────────────────────
app.post('/api/auth/sign-up/email', authRateLimit, async (c) => {
  try {
    const body = await c.req.json<{
      email: string
      password: string
      name?: string
      turnstileToken?: string
      website?: string          // honeypot — debe estar vacío
    }>()

    // Honeypot: si viene relleno, es un bot — rechazar silenciosamente con 200
    if (body.website) return jsonRes({ ok: true }, 200)

    if (!body.email || !body.password)
      return jsonRes({ error: 'Email and password required' }, 400)
    if (body.password.length < 8)
      return jsonRes({ error: 'Password must be at least 8 characters' }, 400)

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
    if (!emailRegex.test(body.email) || body.email.length > 254)
      return jsonRes({ error: 'Invalid email format' }, 400)

    // Verificar Turnstile si está configurado
    if (c.env.TURNSTILE_SECRET_KEY) {
      const ok = await verifyTurnstile(
        body.turnstileToken,
        c.env.TURNSTILE_SECRET_KEY,
        c.req.header('CF-Connecting-IP'),
      )
      if (!ok) return jsonRes({ error: 'Bot verification failed. Please try again.' }, 400)
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
      c.req.header('User-Agent')?.slice(0, 512) ?? null,
      now, now).run()

    // Enviar email de verificación si Resend está configurado
    if (c.env.RESEND_API_KEY && c.env.EMAIL_FROM) {
      const verifyToken = nanoid(32)
      const verifyExp   = now + 86_400  // 24h

      await db.prepare(
        'INSERT INTO verifications (id, identifier, value, expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?)'
      ).bind(nanoid(), body.email.toLowerCase(), verifyToken, verifyExp, now, now).run()

      const verifyUrl = `${PRODUCTION_URL}/verify-email?token=${verifyToken}`
      // waitUntil: no bloquear la respuesta por el envío del email
      c.executionCtx.waitUntil(
        sendEmail(c.env.RESEND_API_KEY, c.env.EMAIL_FROM, body.email, 'Verifica tu email en PrivatePaste', verificationEmailHtml(verifyUrl))
      )
    }

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<any>()

    return jsonRes(
      { user: serializeUser(user) },
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
      c.req.header('User-Agent')?.slice(0, 512) ?? null,
      now, now).run()

    return jsonRes(
      { user: serializeUser(user) },
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
    SELECT s.id as sid, s.expires_at,
           u.id, u.email, u.name, u.role, u.pro_expires_at, u.email_verified_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? LIMIT 1
  `).bind(token).first<any>()

  if (!row || row.expires_at < now) return jsonRes({ session: null, user: null })
  return jsonRes({
    session: { id: row.sid, expiresAt: row.expires_at },
    user:    serializeUser(row),
  })
})

// ─── POST /api/auth/verify-email ──────────────────────────────────────────────
app.post('/api/auth/verify-email', async (c) => {
  try {
    const { token } = await c.req.json<{ token: string }>()
    if (!token) return jsonRes({ error: 'Token required' }, 400)

    const db  = c.env.DB
    const now = Math.floor(Date.now() / 1000)

    const verification = await db.prepare(
      'SELECT * FROM verifications WHERE value = ? LIMIT 1'
    ).bind(token).first<any>()

    if (!verification)               return jsonRes({ error: 'Invalid or expired token' }, 400)
    if (verification.expires_at < now) return jsonRes({ error: 'Token expired. Request a new one.' }, 400)

    // Marcar email como verificado
    await db.prepare('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE email = ?')
      .bind(now, now, verification.identifier).run()

    // Borrar el token usado
    await db.prepare('DELETE FROM verifications WHERE value = ?').bind(token).run()

    return jsonRes({ success: true })
  } catch (err) {
    return safeError(c, 'Email verification failed', err)
  }
})

// ─── POST /api/auth/resend-verification ───────────────────────────────────────
app.post('/api/auth/resend-verification', async (c) => {
  try {
    const user = c.get('user')
    if (!user) return jsonRes({ error: 'Authentication required' }, 401)

    const db  = c.env.DB
    const now = Math.floor(Date.now() / 1000)

    // Comprobar que el email no está ya verificado
    const dbUser = await db.prepare('SELECT email_verified_at FROM users WHERE id = ?')
      .bind(user.id).first<{ email_verified_at: number | null }>()
    if (dbUser?.email_verified_at) return jsonRes({ error: 'Email already verified' }, 400)

    if (!c.env.RESEND_API_KEY || !c.env.EMAIL_FROM)
      return jsonRes({ error: 'Email service not configured' }, 503)

    // Borrar tokens anteriores para este email
    await db.prepare('DELETE FROM verifications WHERE identifier = ?').bind(user.email).run()

    const verifyToken = nanoid(32)
    const verifyExp   = now + 86_400

    await db.prepare(
      'INSERT INTO verifications (id, identifier, value, expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    ).bind(nanoid(), user.email, verifyToken, verifyExp, now, now).run()

    const verifyUrl = `${PRODUCTION_URL}/verify-email?token=${verifyToken}`
    c.executionCtx.waitUntil(
      sendEmail(c.env.RESEND_API_KEY, c.env.EMAIL_FROM, user.email, 'Verifica tu email en PrivatePaste', verificationEmailHtml(verifyUrl))
    )

    return jsonRes({ success: true })
  } catch (err) {
    return safeError(c, 'Failed to resend verification', err)
  }
})

// ─── GET /api/me ──────────────────────────────────────────────────────────────
app.get('/api/me', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ user: null, tier: 'anon' })

  // Leer campos extendidos (proExpiresAt, emailVerifiedAt) directamente de D1
  try {
    const dbUser = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?')
      .bind(user.id).first<any>()
    return c.json({ user: serializeUser(dbUser), tier: c.get('tier') })
  } catch {
    return c.json({ user: { ...user, proExpiresAt: null, emailVerifiedAt: null }, tier: c.get('tier') })
  }
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
