/**
 * KV-backed rate limiter for PrivatePaste.
 *
 * Uses sliding window counters stored in Workers KV.
 * Two counters per identity:
 *   - daily total requests
 *   - rolling window for paste creation
 */
import type { Context, Next } from 'hono'
import type { Env } from '../lib/types'
import { TIER_LIMITS, roleToTier, type Tier } from '../lib/tiers'

interface RateLimitCtx {
  tier: Tier
  identity: string   // userId or ip address
}

/** Build KV keys for an identity */
function keys(identity: string) {
  const day = new Date().toISOString().slice(0, 10)    // YYYY-MM-DD
  const window15 = Math.floor(Date.now() / (15 * 60 * 1000))
  return {
    dailyTotal:  `rl:day:${identity}:${day}`,
    createWindow:`rl:win:${identity}:${window15}`,
  }
}

/** Increment a KV counter atomically (best-effort; KV isn't fully atomic) */
async function increment(kv: KVNamespace, key: string, ttlSeconds: number): Promise<number> {
  const raw = await kv.get(key)
  const count = raw ? parseInt(raw, 10) + 1 : 1
  await kv.put(key, String(count), { expirationTtl: ttlSeconds })
  return count
}

/** Generic rate limit check — returns 429 or passes through */
export async function rateLimitMiddleware(
  c: Context<{ Bindings: Env; Variables: { tier: Tier; userId?: string } }>,
  next: Next,
) {
  const kv = c.env.RATE_LIMIT_KV
  const tier = c.get('tier') ?? 'anon'
  const userId = c.get('userId')
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? 'unknown'
  const identity = userId ?? ip
  const limits = TIER_LIMITS[tier]
  const k = keys(identity)

  // Check daily total
  const dailyCount = await increment(kv, k.dailyTotal, 86_400 + 3600)
  if (dailyCount > limits.maxRequestsPerDay) {
    return c.json({ error: 'Daily request limit exceeded', tier, limit: limits.maxRequestsPerDay }, 429)
  }

  c.set('identity' as never, identity)
  await next()
}

/** Extra check specifically for POST /pastes — sliding window + daily paste count */
export async function pasteCreationRateLimit(
  c: Context<{ Bindings: Env; Variables: { tier: Tier; userId?: string; identity?: string } }>,
  next: Next,
) {
  const kv = c.env.RATE_LIMIT_KV
  const tier = c.get('tier') ?? 'anon'
  const identity = (c.get('identity' as never) as string) ?? 'unknown'
  const limits = TIER_LIMITS[tier]
  const k = keys(identity)

  // Sliding window check
  const windowCount = await increment(kv, k.createWindow, limits.rateWindowMinutes * 60 + 60)
  if (windowCount > limits.rateWindowMaxReqs) {
    return c.json({
      error: `Rate limit: max ${limits.rateWindowMaxReqs} pastes per ${limits.rateWindowMinutes} minutes`,
      tier,
      retryAfter: limits.rateWindowMinutes * 60,
    }, 429)
  }

  // Daily paste creation check
  const dayPasteKey = `rl:pastes:${identity}:${new Date().toISOString().slice(0, 10)}`
  const dayPasteCount = await increment(kv, dayPasteKey, 86_400 + 3600)
  if (dayPasteCount > limits.maxPastesPerDay) {
    return c.json({
      error: `Daily paste creation limit exceeded (${limits.maxPastesPerDay}/day)`,
      tier,
    }, 429)
  }

  await next()
}
