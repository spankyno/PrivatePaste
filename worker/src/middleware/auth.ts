/**
 * Auth middleware for PrivatePaste.
 *
 * Reads the session cookie set by better-auth, validates against D1,
 * and injects user + tier into Hono context variables.
 * Requests without a valid session proceed as 'anon'.
 */
import type { Context, Next } from 'hono'
import type { Env } from '../lib/types'
import { roleToTier, type Tier } from '../lib/tiers'
import { createDb } from '../db'
import { sessions, users } from '../db/schema'
import { eq, gt } from 'drizzle-orm'

export interface AuthUser {
  id:    string
  email: string
  name:  string | null
  role:  'registered' | 'pro' | 'admin'
}

declare module 'hono' {
  interface ContextVariableMap {
    user?:     AuthUser
    userId?:   string
    tier:      Tier
    identity:  string
  }
}

/** Extract session token from cookie or Authorization header */
function extractToken(c: Context): string | null {
  // Try Authorization: Bearer <token>
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }
  // Try session cookie
  const cookie = c.req.header('Cookie') ?? ''
  const match = cookie.match(/(?:^|;\s*)pp_session=([^;]+)/)
  return match?.[1] ?? null
}

export async function authMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  const token = extractToken(c)
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'

  if (!token) {
    c.set('tier', 'anon')
    c.set('identity', ip)
    return next()
  }

  try {
    const db = createDb(c.env.DB)
    const now = Math.floor(Date.now() / 1000)

    // Join session → user in one query
    const result = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.token, token))
      .limit(1)

    const row = result[0]
    if (!row || row.session.expiresAt < now) {
      // Expired or invalid session — treat as anon
      c.set('tier', 'anon')
      c.set('identity', ip)
      return next()
    }

    const authUser: AuthUser = {
      id:    row.user.id,
      email: row.user.email,
      name:  row.user.name,
      role:  row.user.role,
    }

    c.set('user', authUser)
    c.set('userId', authUser.id)
    c.set('tier', roleToTier(authUser.role))
    c.set('identity', authUser.id)
  } catch (err) {
    // Non-fatal — degrade to anon
    console.error('Auth middleware error:', err)
    c.set('tier', 'anon')
    c.set('identity', ip)
  }

  return next()
}

/** Guard: require authenticated user, else 401 */
export async function requireAuth(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  return next()
}
