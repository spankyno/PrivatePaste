/**
 * Auth middleware — D1 nativo, sin drizzle-orm.
 * Valida la cookie pp_session contra la tabla sessions,
 * e inyecta user + tier en el contexto de Hono.
 */
import type { Context, Next } from 'hono'
import type { Env } from '../lib/types'
import { roleToTier } from '../lib/tiers'

export interface AuthUser {
  id:    string
  email: string
  name:  string | null
  role:  'registered' | 'pro' | 'admin'
}

declare module 'hono' {
  interface ContextVariableMap {
    user?:    AuthUser
    userId?:  string
    tier:     'anon' | 'registered' | 'pro'
    identity: string
  }
}

function extractToken(c: Context): string | null {
  const auth = c.req.header('Authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  const cookie = c.req.header('Cookie') ?? ''
  const match  = cookie.match(/(?:^|;\s*)pp_session=([^;]+)/)
  return match?.[1] ?? null
}

export async function authMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  const ip    = c.req.header('CF-Connecting-IP') ?? 'unknown'
  const token = extractToken(c)

  if (!token) {
    c.set('tier', 'anon')
    c.set('identity', ip)
    return next()
  }

  try {
    const now = Math.floor(Date.now() / 1000)
    const row = await c.env.DB.prepare(`
      SELECT s.expires_at,
             u.id, u.email, u.name, u.role
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
      LIMIT 1
    `).bind(token).first<{
      expires_at: number
      id: string; email: string; name: string | null; role: string
    }>()

    if (!row || row.expires_at < now) {
      c.set('tier', 'anon')
      c.set('identity', ip)
      return next()
    }

    const user: AuthUser = {
      id:    row.id,
      email: row.email,
      name:  row.name,
      role:  row.role as AuthUser['role'],
    }

    c.set('user',     user)
    c.set('userId',   user.id)
    c.set('tier',     roleToTier(user.role))
    c.set('identity', user.id)
  } catch (err) {
    console.error('[authMiddleware]', err)
    c.set('tier', 'anon')
    c.set('identity', ip)
  }

  return next()
}

export async function requireAuth(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  if (!c.get('user')) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  return next()
}
