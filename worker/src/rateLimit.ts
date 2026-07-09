/**
 * Rate limiter usando Workers KV.
 * Sin imports de drizzle ni de lib/tiers — todo inline para evitar
 * problemas de bundle en el edge de Cloudflare Workers.
 */
import type { Context, Next } from 'hono'
import type { Env } from '../lib/types'

const LIMITS = {
  anon:       { daily: 200,   window: 5,   windowMins: 15, dailyPastes: 5 },
  registered: { daily: 5000,  window: 30,  windowMins: 15, dailyPastes: 20 },
  pro:        { daily: 50000, window: 100, windowMins: 15, dailyPastes: 500 },
} as const

type Tier = 'anon' | 'registered' | 'pro'

async function inc(kv: KVNamespace, key: string, ttl: number): Promise<number> {
  try {
    const raw   = await kv.get(key)
    const count = raw ? parseInt(raw, 10) + 1 : 1
    await kv.put(key, String(count), { expirationTtl: ttl })
    return count
  } catch {
    return 0
  }
}

export async function rateLimitMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  try {
    const kv       = c.env.RATE_LIMIT_KV
    const tier     = (c.get('tier' as never) as Tier | undefined) ?? 'anon'
    const identity = (c.get('identity' as never) as string | undefined)
                  ?? c.req.header('CF-Connecting-IP')
                  ?? 'unknown'
    const limits   = LIMITS[tier]
    const day      = new Date().toISOString().slice(0, 10)

    const dailyCount = await inc(kv, `rl:day:${identity}:${day}`, 90000)
    if (dailyCount > limits.daily) {
      return c.json({ error: 'Daily request limit exceeded' }, 429)
    }
  } catch (err) {
    console.error('[rateLimit]', err)
  }

  return next()
}

/**
 * Rate limit específico para endpoints de autenticación.
 * Máx 10 intentos por IP por hora — bloquea brute force de contraseñas.
 */
export async function authRateLimit(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  try {
    const kv  = c.env.RATE_LIMIT_KV
    const ip  = c.req.header('CF-Connecting-IP') ?? 'unknown'
    const hour = new Date().toISOString().slice(0, 13) // YYYY-MM-DDTHH
    const key  = `rl:auth:${ip}:${hour}`

    const count = await inc(kv, key, 3700) // TTL 1h + margen
    if (count > 10) {
      return new Response(
        JSON.stringify({ error: 'Too many login attempts. Try again in an hour.' }),
        { status: 429, headers: {
          'Content-Type':  'application/json',
          'Retry-After':   '3600',
          'X-RateLimit-Limit': '10',
        }}
      )
    }
  } catch (err) {
    console.error('[authRateLimit]', err)
  }
  return next()
}

export async function pasteCreationRateLimit(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  try {
    const kv       = c.env.RATE_LIMIT_KV
    const tier     = (c.get('tier' as never) as Tier | undefined) ?? 'anon'
    const identity = (c.get('identity' as never) as string | undefined)
                  ?? c.req.header('CF-Connecting-IP')
                  ?? 'unknown'
    const limits   = LIMITS[tier]
    const day      = new Date().toISOString().slice(0, 10)
    const win      = Math.floor(Date.now() / (15 * 60 * 1000))

    const windowCount = await inc(kv, `rl:win:${identity}:${win}`, 1800)
    if (windowCount > limits.window) {
      return c.json({
        error: `Rate limit: max ${limits.window} pastes per ${limits.windowMins} minutes`,
      }, 429)
    }

    const dayCount = await inc(kv, `rl:pastes:${identity}:${day}`, 90000)
    if (dayCount > limits.dailyPastes) {
      return c.json({ error: `Daily paste limit exceeded (${limits.dailyPastes}/day)` }, 429)
    }
  } catch (err) {
    console.error('[pasteCreationRateLimit]', err)
  }

  return next()
}
