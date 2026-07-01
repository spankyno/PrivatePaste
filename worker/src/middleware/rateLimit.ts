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

// ─── Rate limiting específico para autenticación ─────────────────────────────
// El límite global de rateLimitMiddleware (200 req/día para anónimos) es
// demasiado laxo para frenar fuerza bruta sobre login/registro: comparte
// cupo con el resto del tráfico y no tiene ventana corta. Este middleware
// añade dos capas independientes, ambas sobre la misma KV, sin dependencias
// nuevas:
//   1. Por IP: máx. AUTH_WINDOW_LIMIT intentos por AUTH_WINDOW_MINUTES.
//      Frena a un atacante que prueba muchas contraseñas/emails desde la
//      misma IP.
//   2. Por email objetivo: máx. AUTH_EMAIL_LIMIT intentos por la misma
//      ventana, independientemente de la IP de origen. Frena el credential
//      stuffing distribuido (rotación de IPs/proxies) contra una cuenta
//      concreta.
const AUTH_WINDOW_MINUTES = 15
const AUTH_WINDOW_MS      = AUTH_WINDOW_MINUTES * 60 * 1000
const AUTH_WINDOW_TTL     = AUTH_WINDOW_MINUTES * 60
const AUTH_IP_LIMIT       = 15
const AUTH_EMAIL_LIMIT    = 6

export async function authRateLimit(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  try {
    const kv  = c.env.RATE_LIMIT_KV
    const ip  = c.req.header('CF-Connecting-IP') ?? 'unknown'
    const win = Math.floor(Date.now() / AUTH_WINDOW_MS)

    const ipCount = await inc(kv, `rl:auth:ip:${ip}:${win}`, AUTH_WINDOW_TTL)
    if (ipCount > AUTH_IP_LIMIT) {
      return c.json({ error: 'Too many attempts. Please try again later.' }, 429)
    }

    // c.req.json() está cacheado por Hono, así que leerlo aquí no supone
    // un segundo parseo cuando el handler de la ruta también lo lea.
    let email: string | undefined
    try {
      const body = await c.req.json<{ email?: string }>()
      if (typeof body?.email === 'string') email = body.email.trim().toLowerCase()
    } catch {
      // Body ausente o no-JSON: se deja pasar, el handler de la ruta
      // devolverá el 400 correspondiente.
    }

    if (email) {
      const emailCount = await inc(kv, `rl:auth:email:${email}:${win}`, AUTH_WINDOW_TTL)
      if (emailCount > AUTH_EMAIL_LIMIT) {
        return c.json({ error: 'Too many attempts for this account. Please try again later.' }, 429)
      }
    }
  } catch (err) {
    console.error('[authRateLimit]', err)
  }

  return next()
}
