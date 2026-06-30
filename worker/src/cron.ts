import type { Env } from './lib/types'

export async function handleScheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  ctx.waitUntil(runCleanup(env))
}

async function runCleanup(env: Env) {
  const now          = Math.floor(Date.now() / 1000)
  const sevenDaysAgo = now - 7 * 86400

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
