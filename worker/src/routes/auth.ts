import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { createDb, users, sessions, accounts } from '../db'

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
  const value  = clear ? '' : token
  const maxAge = clear ? 0 : 60 * 60 * 24 * 30
  return `pp_session=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

// ─── Sign up ──────────────────────────────────────────────────────────────────

router.post('/sign-up/email', async (c) => {
  try {
    const body = await c.req.json<{ email: string; password: string; name?: string }>()

    if (!body.email || !body.password)
      return c.json({ error: 'Email and password are required' }, 400)
    if (body.password.length < 8)
      return c.json({ error: 'Password must be at least 8 characters' }, 400)

    const db  = createDb(c.env.DB)
    const now = Math.floor(Date.now() / 1000)

    // Check duplicate email
    const existing = await db.select({ id: users.id })
      .from(users).where(eq(users.email, body.email.toLowerCase())).limit(1)
    if (existing[0])
      return c.json({ error: 'Email already registered' }, 409)

    const userId       = nanoid()
    const passwordHash = await hashPassword(body.password)
    const token        = nanoid(32)
    const expiresAt    = now + 60 * 60 * 24 * 30

    // Insert user
    await db.insert(users).values({
      id:        userId,
      email:     body.email.toLowerCase(),
      name:      body.name ?? null,
      role:      'registered',
      createdAt: now,
      updatedAt: now,
    })

    // Insert account — solo los campos que existen en nuestro schema
    await db.insert(accounts).values({
      id:          nanoid(),
      accountId:   userId,
      providerId:  'email',
      userId:      userId,
      password:    passwordHash,
      createdAt:   now,
      updatedAt:   now,
    })

    // Insert session
    await db.insert(sessions).values({
      id:        nanoid(),
      userId:    userId,
      token:     token,
      expiresAt: expiresAt,
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
      createdAt: now,
      updatedAt: now,
    })

    return new Response(
      JSON.stringify({ user: { id: userId, email: body.email.toLowerCase(), name: body.name ?? null, role: 'registered' } }),
      {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie':   sessionCookie(token),
        },
      }
    )
  } catch (err) {
    console.error('[sign-up] error:', err)
    return c.json({ error: 'Registration failed', detail: String(err) }, 500)
  }
})

// ─── Sign in ──────────────────────────────────────────────────────────────────

router.post('/sign-in/email', async (c) => {
  try {
    const body = await c.req.json<{ email: string; password: string }>()

    if (!body.email || !body.password)
      return c.json({ error: 'Email and password are required' }, 400)

    const db  = createDb(c.env.DB)
    const now = Math.floor(Date.now() / 1000)

    const userRows = await db.select().from(users)
      .where(eq(users.email, body.email.toLowerCase())).limit(1)
    const user = userRows[0]
    if (!user) return c.json({ error: 'Invalid email or password' }, 401)

    const accountRows = await db.select().from(accounts)
      .where(eq(accounts.userId, user.id)).limit(1)
    const account = accountRows[0]
    if (!account?.password) return c.json({ error: 'Invalid email or password' }, 401)

    const valid = await verifyPassword(body.password, account.password)
    if (!valid) return c.json({ error: 'Invalid email or password' }, 401)

    const token     = nanoid(32)
    const expiresAt = now + 60 * 60 * 24 * 30

    await db.insert(sessions).values({
      id:        nanoid(),
      userId:    user.id,
      token:     token,
      expiresAt: expiresAt,
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
      createdAt: now,
      updatedAt: now,
    })

    return new Response(
      JSON.stringify({ user: { id: user.id, email: user.email, name: user.name, role: user.role } }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie':   sessionCookie(token),
        },
      }
    )
  } catch (err) {
    console.error('[sign-in] error:', err)
    return c.json({ error: 'Login failed', detail: String(err) }, 500)
  }
})

// ─── Sign out ─────────────────────────────────────────────────────────────────

router.post('/sign-out', async (c) => {
  try {
    const cookie = c.req.header('Cookie') ?? ''
    const match  = cookie.match(/(?:^|;\s*)pp_session=([^;]+)/)
    const token  = match?.[1]

    if (token) {
      const db = createDb(c.env.DB)
      await db.delete(sessions).where(eq(sessions.token, token))
    }
  } catch (err) {
    console.error('[sign-out] error:', err)
  }

  return new Response(
    JSON.stringify({ success: true }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie':   sessionCookie('', true),
      },
    }
  )
})

// ─── Get session ──────────────────────────────────────────────────────────────

router.get('/session', async (c) => {
  try {
    const cookie = c.req.header('Cookie') ?? ''
    const match  = cookie.match(/(?:^|;\s*)pp_session=([^;]+)/)
    const token  = match?.[1]

    if (!token) return c.json({ session: null, user: null })

    const db  = createDb(c.env.DB)
    const now = Math.floor(Date.now() / 1000)

    const rows = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.token, token))
      .limit(1)

    const row = rows[0]
    if (!row || row.session.expiresAt < now)
      return c.json({ session: null, user: null })

    return c.json({
      session: { id: row.session.id, expiresAt: row.session.expiresAt },
      user:    { id: row.user.id, email: row.user.email, name: row.user.name, role: row.user.role },
    })
  } catch (err) {
    console.error('[session] error:', err)
    return c.json({ session: null, user: null })
  }
})

export default router
