/**
 * Auth routes — implementación propia sin dependencias externas.
 * Usa Web Crypto API (disponible en Cloudflare Workers) para hash de passwords.
 * Sessions almacenadas en D1.
 *
 * POST /api/auth/sign-up/email  → registro
 * POST /api/auth/sign-in/email  → login
 * POST /api/auth/sign-out       → logout
 * GET  /api/auth/session        → sesión actual
 */
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Env } from '../lib/types'
import { createDb, users, sessions, accounts } from '../db'

const router = new Hono<{ Bindings: Env }>()

// ─── Helpers de crypto ────────────────────────────────────────────────────────

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

function sessionCookie(token: string, expires: Date, clear = false): string {
  const value   = clear ? '' : token
  const maxAge  = clear ? 0 : 60 * 60 * 24 * 30
  return `pp_session=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

// ─── Sign up ──────────────────────────────────────────────────────────────────

router.post('/sign-up/email', async (c) => {
  const body = await c.req.json<{ email: string; password: string; name?: string }>()

  if (!body.email || !body.password) {
    return c.json({ error: 'Email and password are required' }, 400)
  }
  if (body.password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }

  const db  = createDb(c.env.DB)
  const now = Math.floor(Date.now() / 1000)

  // Check if email already exists
  const existing = await db.select({ id: users.id })
    .from(users).where(eq(users.email, body.email.toLowerCase())).limit(1)
  if (existing[0]) {
    return c.json({ error: 'Email already registered' }, 409)
  }

  const userId       = nanoid()
  const passwordHash = await hashPassword(body.password)
  const token        = nanoid(32)
  const expiresAt    = now + 60 * 60 * 24 * 30  // 30 days

  // Create user
  await db.insert(users).values({
    id:        userId,
    email:     body.email.toLowerCase(),
    name:      body.name ?? null,
    role:      'registered',
    createdAt: now,
    updatedAt: now,
  })

  // Create account (stores password hash)
  await db.insert(accounts).values({
    id:         nanoid(),
    accountId:  userId,
    providerId: 'email',
    userId,
    password:   passwordHash,
    createdAt:  now,
    updatedAt:  now,
  })

  // Create session
  await db.insert(sessions).values({
    id:        nanoid(),
    userId,
    token,
    expiresAt,
    ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    userAgent: c.req.header('User-Agent') ?? null,
    createdAt: now,
    updatedAt: now,
  })

  return c.json(
    { user: { id: userId, email: body.email, name: body.name ?? null, role: 'registered' } },
    201,
    { 'Set-Cookie': sessionCookie(token, new Date(expiresAt * 1000)) }
  )
})

// ─── Sign in ──────────────────────────────────────────────────────────────────

router.post('/sign-in/email', async (c) => {
  const body = await c.req.json<{ email: string; password: string }>()

  if (!body.email || !body.password) {
    return c.json({ error: 'Email and password are required' }, 400)
  }

  const db  = createDb(c.env.DB)
  const now = Math.floor(Date.now() / 1000)

  // Get user
  const userRows = await db.select().from(users)
    .where(eq(users.email, body.email.toLowerCase())).limit(1)
  const user = userRows[0]
  if (!user) return c.json({ error: 'Invalid email or password' }, 401)

  // Get account (password hash)
  const accountRows = await db.select().from(accounts)
    .where(eq(accounts.userId, user.id)).limit(1)
  const account = accountRows[0]
  if (!account?.password) return c.json({ error: 'Invalid email or password' }, 401)

  const valid = await verifyPassword(body.password, account.password)
  if (!valid) return c.json({ error: 'Invalid email or password' }, 401)

  // Create new session
  const token     = nanoid(32)
  const expiresAt = now + 60 * 60 * 24 * 30

  await db.insert(sessions).values({
    id:        nanoid(),
    userId:    user.id,
    token,
    expiresAt,
    ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    userAgent: c.req.header('User-Agent') ?? null,
    createdAt: now,
    updatedAt: now,
  })

  return c.json(
    { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
    200,
    { 'Set-Cookie': sessionCookie(token, new Date(expiresAt * 1000)) }
  )
})

// ─── Sign out ─────────────────────────────────────────────────────────────────

router.post('/sign-out', async (c) => {
  const cookie = c.req.header('Cookie') ?? ''
  const match  = cookie.match(/(?:^|;\s*)pp_session=([^;]+)/)
  const token  = match?.[1]

  if (token) {
    const db = createDb(c.env.DB)
    await db.delete(sessions).where(eq(sessions.token, token))
  }

  return c.json(
    { success: true },
    200,
    { 'Set-Cookie': sessionCookie('', new Date(0), true) }
  )
})

// ─── Get session ──────────────────────────────────────────────────────────────

router.get('/session', async (c) => {
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
  if (!row || row.session.expiresAt < now) {
    return c.json({ session: null, user: null })
  }

  return c.json({
    session: { id: row.session.id, expiresAt: row.session.expiresAt },
    user:    { id: row.user.id, email: row.user.email, name: row.user.name, role: row.user.role },
  })
})

export default router
