import type { Env } from './lib/types'
import { PRO_DURATION_SECONDS } from './lib/tiers'

export async function handleScheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  ctx.waitUntil(runCleanup(env))
}

async function runCleanup(env: Env) {
  const now          = Math.floor(Date.now() / 1000)
  const sevenDaysAgo = now - 7 * 86400
  const proCutoff    = now - PRO_DURATION_SECONDS

  // Downgrade de cuentas PRO caducadas (1 año desde updated_at, que se
  // actualiza manualmente al recibir el pago) a 'registered'. No afecta
  // a 'admin'. Se ejecuta cada hora (mismo trigger cron que la limpieza
  // de pastes), así que el desfase máximo entre la caducidad real y el
  // downgrade efectivo es de ~1h.
  const downgraded = await env.DB.prepare(`
    UPDATE users SET role = 'registered', updated_at = ?
    WHERE role = 'pro' AND updated_at < ?
  `).bind(now, proCutoff).run()
  console.log(`[cron] downgraded ${downgraded.meta.changes} expired PRO accounts`)

  const deleted = await env.DB.prepare(`
    DELETE FROM pastes
    WHERE expires_at IS NOT NULL
      AND expires_at < ?
      AND (user_id IS NULL OR user_id IN (
        SELECT id FROM users WHERE role NOT IN ('pro','admin')
      ))
  `).bind(now).run()
  console.log(`[cron] deleted ${deleted.meta.changes} expired pastes`)

  const archived = await env.DB.prepare(`
    UPDATE pastes SET is_archived = 1, updated_at = ?
    WHERE expires_at IS NOT NULL
      AND expires_at < ?
      AND is_archived = 0
      AND user_id IN (SELECT id FROM users WHERE role IN ('pro','admin'))
  `).bind(now, now).run()
  console.log(`[cron] archived ${archived.meta.changes} pro pastes`)

  const aggressive = await env.DB.prepare(`
    DELETE FROM pastes WHERE user_id IS NULL AND created_at < ?
  `).bind(sevenDaysAgo).run()
  console.log(`[cron] aggressive: deleted ${aggressive.meta.changes} old anon pastes`)
}
