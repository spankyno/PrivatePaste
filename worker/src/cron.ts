/**
 * Cron handler — called by Cloudflare Workers scheduled trigger.
 *
 * Strategies by tier:
 *   anon       → aggressive: delete immediately on expiry, also nuke >7d inactive
 *   registered → normal: delete expired pastes
 *   pro        → archive: set is_archived=true instead of deleting
 *
 * Runs every hour (configured in wrangler.toml).
 */
import { lt, isNotNull, eq, and, or, sql } from 'drizzle-orm'
import { createDb, pastes, users } from './db'
import type { Env } from './lib/types'

export async function handleScheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  ctx.waitUntil(runCleanup(env))
}

async function runCleanup(env: Env): Promise<void> {
  const db  = createDb(env.DB)
  const now = Math.floor(Date.now() / 1000)

  console.log(`[cleanup] Starting at ${new Date().toISOString()}`)

  // ── 1. Delete expired pastes for anon + registered users ─────────────────
  const deleted = await db
    .delete(pastes)
    .where(and(
      isNotNull(pastes.expiresAt),
      lt(pastes.expiresAt, now),
      // Find pastes whose owner is NOT pro (or anon — user_id is null)
      sql`(
        ${pastes.userId} IS NULL
        OR ${pastes.userId} IN (
          SELECT id FROM users WHERE role != 'pro' AND role != 'admin'
        )
      )`,
    ))
    .returning({ id: pastes.id })

  console.log(`[cleanup] Deleted ${deleted.length} expired pastes (anon + registered)`)

  // ── 2. Archive expired pastes for pro users ───────────────────────────────
  const archived = await db
    .update(pastes)
    .set({ isArchived: true, updatedAt: now })
    .where(and(
      isNotNull(pastes.expiresAt),
      lt(pastes.expiresAt, now),
      eq(pastes.isArchived, false),
      sql`${pastes.userId} IN (SELECT id FROM users WHERE role IN ('pro', 'admin'))`,
    ))
    .returning({ id: pastes.id })

  console.log(`[cleanup] Archived ${archived.length} expired pastes (pro users)`)

  // ── 3. Aggressive cleanup: anon pastes inactive for > 7 days ─────────────
  const sevenDaysAgo = now - 7 * 86_400
  const aggressive = await db
    .delete(pastes)
    .where(and(
      sql`${pastes.userId} IS NULL`,
      lt(pastes.createdAt, sevenDaysAgo),
    ))
    .returning({ id: pastes.id })

  console.log(`[cleanup] Aggressive: deleted ${aggressive.length} old anon pastes`)
  console.log(`[cleanup] Done`)
}
