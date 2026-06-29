/**
 * Auth routes — D1 nativo con prepare().
 * Sin Drizzle para evitar problemas de bundle en Cloudflare Workers.
 */
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import type { Env } from '../lib/types'

const router = new Hono<{ Bindings: Env }>()

// ─── Crypto helpers ───────────────────────────────────────────────────────────

async function hashPassword(password: string): Promise<string> {
  const salt    = nanoid(16)
  const encoder = new TextEncoder()
  const data    = encoder.encode(salt + password)
  const hash    = await crypto.subtle.digest('SHA-256', data)
  const hex     = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  return `${salt}:${hex}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const encoder = new TextEncoder()
  const data    = encoder.encode(salt + password)
  const newHash = await crypto.subtle.digest('SHA-256', data)
  const hex     = Array.from(new Uint8Array(newHash))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  return hex === hash
}

function sessionCookie(token: string, clear = false): string {
  const maxAge = clear ? 0 : 60 * 60 * 24 * 30
  const value  = clear ? '' : token
  return `pp_session=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })
}

// ─── Sign up ──────────────────────────────────────────────────────────────────

router.post('/sign-up/email', async (c) => {
  try {
    const body = await c.req.json<{ email: string; password: string; name?: string }>()

    if (!body.email || !body.password)
      return json({ error: 'Email and password are required' }, 400)
    if (body.password.length < 8)
      return json({ error: 'Password must be at least 8 characters' }, 400)

    const db  = c.env.DB
    const now = Math.floor(Date.now() / 1000)

    // Check duplicate
    const existing = await db.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(body.email.toLowerCase()).first()
    if (existing) return json({ error: 'Email already registered' }, 409)

    const userId       = nanoid()
    const passwordHash = await hashPassword(body.password)
    const token        = nanoid(32)
    const expiresAt    = now + 60 * 60 * 24 * 30

    // Insert user
    await db.prepare(
      `INSERT INTO users (id, email, name, role, created_at, updated_at)
       VALUES (?, ?, ?, 'registered', ?, ?)`
    ).bind(userId, body.email.toLowerCase(), body.name ?? null, now, now).run()

    // Insert account with password hash
    await db.prepare(
      `INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
       VALUES (?, ?, 'email', ?, ?, ?, ?)`
    ).bind(nanoid(), userId, userId, passwordHash, now, now).run()

    // Insert session
    await db.prepare(
      `INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      nanoid(), userId, token, expiresAt,
      c.req.header('CF-Connecting-IP') ?? null,
      c.req.header('User-Agent') ?? null,
      now, now
    ).run()

    return json(
      { user: { id: userId, email: body.email.toLowerCase(), name: body.name ?? null, role: 'registered' } },
      201,
      { 'Set-Cookie': sessionCookie(token) }
    )
  } catch (err) {
    console.error('[sign-up]', err)
    return json({ error: 'Registration failed', detail: String(err) }, 500)
  }
})

// ─── Sign in ──────────────────────────────────────────────────────────────────

router.post('/sign-in/email', async (c) => {
  try {
    const body = await c.req.json<{ email: string; password: string }>()

    if (!body.email || !body.password)
      return json({ error: 'Email and password are required' }, 400)

    const db  = c.env.DB
    const now = Math.floor(Date.now() / 1000)

    const user = await db.prepare(
      'SELECT * FROM users WHERE email = ?'
    ).bind(body.email.toLowerCase()).first<{ id: string; email: string; name: string | null; role: string }>()
    if (!user) return json({ error: 'Invalid email or password' }, 401)

    const account = await db.prepare(
      'SELECT password FROM accounts WHERE user_id = ? AND provider_id = ?'
    ).bind(user.id, 'email').first<{ password: string }>()
    if (!account?.password) return json({ error: 'Invalid email or password' }, 401)

    const valid = await verifyPassword(body.password, account.password)
    if (!valid) return json({ error: 'Invalid email or password' }, 401)

    const token     = nanoid(32)
    const expiresAt = now + 60 * 60 * 24 * 30

    await db.prepare(
      `INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      nanoid(), user.id, token, expiresAt,
      c.req.header('CF-Connecting-IP') ?? null,
      c.req.header('User-Agent') ?? null,
      now, now
    ).run()

    return json(
      { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
      200,
      { 'Set-Cookie': sessionCookie(token) }
    )
  } catch (err) {
    console.error('[sign-in]', err)
    return json({ error: 'Login failed', detail: String(err) }, 500)
  }
})

// ─── Sign out ─────────────────────────────────────────────────────────────────

router.post('/sign-out', async (c) => {
  try {
    const cookie = c.req.header('Cookie') ?? ''
    const match  = cookie.match(/(?:^|;\s*)pp_session=([^;]+)/)
    const token  = match?.[1]
    if (token) {
      await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
    }
  } catch (err) {
    console.error('[sign-out]', err)
  }
  return json({ success: true }, 200, { 'Set-Cookie': sessionCookie('', true) })
})

// ─── Get session ──────────────────────────────────────────────────────────────

router.get('/session', async (c) => {
  try {
    const cookie = c.req.header('Cookie') ?? ''
    const match  = cookie.match(/(?:^|;\s*)pp_session=([^;]+)/)
    const token  = match?.[1]
    if (!token) return json({ session: null, user: null })

    const now = Math.floor(Date.now() / 1000)
    const row = await c.env.DB.prepare(`
      SELECT s.id as sid, s.expires_at,
             u.id, u.email, u.name, u.role
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
    `).bind(token).first<{
      sid: string; expires_at: number
      id: string; email: string; name: string | null; role: string
    }>()

    if (!row || row.expires_at < now) return json({ session: null, user: null })

    return json({
      session: { id: row.sid, expiresAt: row.expires_at },
      user:    { id: row.id, email: row.email, name: row.name, role: row.role },
    })
  } catch (err) {
    console.error('[session]', err)
    return json({ session: null, user: null })
  }
})

export default router
