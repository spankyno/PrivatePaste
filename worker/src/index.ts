import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { logger } from 'hono/logger'
import { nanoid } from 'nanoid'
import type { Env } from './lib/types'
import { authMiddleware, requireAuth } from './middleware/auth'
import { rateLimitMiddleware, authRateLimit } from './middleware/rateLimit'
import pastesRouter from './routes/pastes'
import foldersRouter from './routes/folders'
import { handleScheduled } from './cron'
import { hashPassword, verifyPassword, needsRehash } from './lib/password'
import { getProExpiresAt } from './lib/tiers'
import { verifyTurnstile } from './lib/turnstile'
import { errorResponse } from './lib/http'

const app = new Hono<{ Bindings: Env }>()

// ⚠ Sustituye con tu URL real del Worker tras el primer deploy
const PRODUCTION_URL = 'https://privatepaste-production.kbo1.workers.dev'

// Red de seguridad: cualquier excepción no capturada por una ruta/middleware
// (incluidas las que puedan lanzar Hono o sus propios middlewares) pasa por
// aquí en lugar de devolver el stack trace por defecto al cliente.
app.onError((err, c) => errorResponse(c, 'Internal server error', err, 500))

// ─── Middleware global ────────────────────────────────────────────────────────
// CSP explícita (secureHeaders() no la activa por defecto). Ajustada al
// frontend real: SPA servida desde el propio Worker (mismo origen), fuente
// Google Fonts vía @import en index.css, sin scripts/estilos de terceros
// ni iframes.
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc:     ["'self'"],
    scriptSrc:      ["'self'", 'https://challenges.cloudflare.com'],
    styleSrc:       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc:        ["'self'", 'https://fonts.gstatic.com'],
    imgSrc:         ["'self'", 'data:'],
    connectSrc:     ["'self'", 'https://challenges.cloudflare.com'],
    frameSrc:       ['https://challenges.cloudflare.com'],
    objectSrc:      ["'none'"],
    baseUri:        ["'self'"],
    formAction:     ["'self'"],
    frameAncestors: ["'none'"],
    upgradeInsecureRequests: [],
  },
}))
app.use('*', cors({
  origin: ['http://localhost:5173', PRODUCTION_URL],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))
app.use('/api/*', logger())
app.use('/api/*', authMiddleware)
app.use('/api/*', rateLimitMiddleware)
app.use('/raw/*', authMiddleware)

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }))

// ─── Auth helpers ─────────────────────────────────────────────────────────────
// hashPassword/verifyPassword ahora viven en ./lib/password.ts (PBKDF2-SHA256)
function setCookie(token: string, clear = false): string {
  return `pp_session=${clear ? '' : token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${clear ? 0 : 2592000}`
}
function jsonRes(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...headers }
  })
}

// ─── POST /api/auth/sign-up/email ─────────────────────────────────────────────
app.post('/api/auth/sign-up/email', authRateLimit, async (c) => {
  try {
    const body = await c.req.json<{
      email: string; password: string; name?: string
      website?: string       // honeypot: campo invisible para humanos
      turnstileToken?: string
    }>()

    // Honeypot: un bot que rellena formularios por fuerza bruta suele
    // completar también los campos ocultos. Si viene relleno, se rechaza
    // sin dar pistas de que se trata de un honeypot (mensaje genérico).
    if (body.website) {
      console.warn('[sign-up] blocked: honeypot field filled')
      return jsonRes({ error: 'Invalid request' }, 400)
    }

    const turnstileOk = await verifyTurnstile(
      body.turnstileToken,
      c.env.TURNSTILE_SECRET_KEY,
      c.req.header('CF-Connecting-IP'),
    )
    if (!turnstileOk)
      return jsonRes({ error: 'Verification failed. Please try again.' }, 400)

    if (!body.email || !body.password)
      return jsonRes({ error: 'Email and password required' }, 400)
    if (body.password.length < 8)
      return jsonRes({ error: 'Password must be at least 8 characters' }, 400)

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
    ).bind(nanoid(), userId, 'email', userId, await hashPassword(body.password), now, now).run()

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
    return errorResponse(c, 'Registration failed', err)
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

    if (!await verifyPassword(body.password, account.password))
      return jsonRes({ error: 'Invalid email or password' }, 401)

    // Migración transparente: si el hash guardado es del esquema antiguo
    // (SHA-256 simple) o usa menos iteraciones que las actuales, se
    // regenera con PBKDF2 ahora que tenemos la contraseña en texto plano.
    if (needsRehash(account.password)) {
      await db.prepare('UPDATE accounts SET password = ?, updated_at = ? WHERE user_id = ? AND provider_id = ?')
        .bind(await hashPassword(body.password), now, user.id, 'email').run()
    }

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
    return errorResponse(c, 'Login failed', err)
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

// ─── POST /api/auth/change-password ───────────────────────────────────────────
// Requiere sesión activa + contraseña actual. Tras el cambio, revoca todas
// las demás sesiones del usuario (otros dispositivos/navegadores/tokens
// robados) para que dejen de ser válidas de inmediato; solo la sesión
// actual (con la que se hizo la petición) se mantiene viva.
app.post('/api/auth/change-password', requireAuth, authRateLimit, async (c) => {
  try {
    const userId = c.get('userId')!
    const body = await c.req.json<{ currentPassword: string; newPassword: string }>()

    if (!body.currentPassword || !body.newPassword)
      return jsonRes({ error: 'Current and new password are required' }, 400)
    if (body.newPassword.length < 8)
      return jsonRes({ error: 'New password must be at least 8 characters' }, 400)

    const db  = c.env.DB
    const now = Math.floor(Date.now() / 1000)

    const account = await db.prepare(
      'SELECT password FROM accounts WHERE user_id = ? AND provider_id = ?'
    ).bind(userId, 'email').first<{ password: string }>()
    if (!account?.password) return jsonRes({ error: 'Invalid current password' }, 401)

    if (!await verifyPassword(body.currentPassword, account.password))
      return jsonRes({ error: 'Invalid current password' }, 401)

    await db.prepare(
      'UPDATE accounts SET password = ?, updated_at = ? WHERE user_id = ? AND provider_id = ?'
    ).bind(await hashPassword(body.newPassword), now, userId, 'email').run()

    // Revoca todas las sesiones salvo la actual: cualquier token robado o
    // sesión abierta en otro dispositivo antes del cambio deja de servir.
    const currentToken = (c.req.header('Cookie') ?? '')
      .match(/(?:^|;\s*)pp_session=([^;]+)/)?.[1]

    if (currentToken) {
      await db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?')
        .bind(userId, currentToken).run()
    } else {
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run()
    }

    return jsonRes({ success: true })
  } catch (err) {
    return errorResponse(c, 'Failed to change password', err)
  }
})

// ─── GET /api/auth/session ────────────────────────────────────────────────────
app.get('/api/auth/session', async (c) => {
  const cookie = c.req.header('Cookie') ?? ''
  const token  = cookie.match(/(?:^|;\s*)pp_session=([^;]+)/)?.[1]
  if (!token) return jsonRes({ session: null, user: null })

  const now = Math.floor(Date.now() / 1000)
  const row = await c.env.DB.prepare(`
    SELECT s.id as sid, s.expires_at, u.id, u.email, u.name, u.role, u.updated_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? LIMIT 1
  `).bind(token).first<any>()

  if (!row || row.expires_at < now) return jsonRes({ session: null, user: null })
  return jsonRes({
    session: { id: row.sid, expiresAt: row.expires_at },
    user:    {
      id: row.id, email: row.email, name: row.name, role: row.role,
      proExpiresAt: row.role === 'pro' ? getProExpiresAt(row.updated_at) : null,
    },
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
  const { id }    = c.req.param()
  const now       = Math.floor(Date.now() / 1000)
  const userId    = c.get('userId')
  const paste     = await c.env.DB.prepare('SELECT * FROM pastes WHERE id = ?').bind(id).first<any>()
  if (!paste) return c.text('Not found', 404)

  const isOwner   = !!userId && paste.user_id === userId
  const isExpired = paste.expires_at && paste.expires_at < now

  if (isExpired && !isOwner)                          return c.text('Expired', 410)
  if (paste.visibility === 'private' && !isOwner)      return c.text('Private', 403)
  if (paste.visibility === 'password' && !isOwner)     return c.text('Password required', 403)
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

export { app }
export default { fetch: app.fetch, scheduled: handleScheduled }
