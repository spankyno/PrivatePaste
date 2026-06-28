/**
 * /api/pastes routes — CRUD operations.
 *
 * POST   /api/pastes           Create paste
 * GET    /api/pastes           List own pastes (auth required)
 * GET    /api/pastes/:id       Get paste (public/password)
 * PATCH  /api/pastes/:id       Update paste (owner only)
 * DELETE /api/pastes/:id       Delete paste (owner only)
 * POST   /api/pastes/:id/unlock Unlock password-protected paste
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { eq, and, isNull, lt, or, like, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { createDb, pastes, type NewPaste } from '../db'
import { TIER_LIMITS, expiryToTimestamp, type ExpiryValue } from '../lib/tiers'
import { requireAuth } from '../middleware/auth'
import { pasteCreationRateLimit } from '../middleware/rateLimit'

const router = new Hono<{ Bindings: Env }>()

// ─── Validation schemas ───────────────────────────────────────────────────────

const CreatePasteSchema = z.object({
  title:      z.string().max(255).default('Untitled'),
  content:    z.string().min(1).max(10 * 1024 * 1024), // validated again with tier limits below
  language:   z.string().max(50).default('plaintext'),
  visibility: z.enum(['public', 'private', 'password']).default('public'),
  password:   z.string().min(4).max(128).optional(),
  expiry:     z.enum(['1h', '3d', '30d', '90d', '300d', 'never']).default('3d'),
  folderId:   z.string().optional(),
})

const UpdatePasteSchema = CreatePasteSchema.partial().omit({ content: true }).extend({
  title:    z.string().max(255).optional(),
  language: z.string().max(50).optional(),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Hash a password using Web Crypto API (SHA-256 + salt, no argon2 in edge) */
async function hashPassword(password: string): Promise<string> {
  const salt = nanoid(16)
  const encoder = new TextEncoder()
  const data = encoder.encode(salt + password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return `${salt}:${hashHex}`
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, stored] = hash.split(':')
  if (!salt || !stored) return false
  const encoder = new TextEncoder()
  const data = encoder.encode(salt + password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return hashHex === stored
}

/** Strip sensitive fields from paste before returning to client */
function sanitizePaste(paste: typeof pastes.$inferSelect, includeContent = true) {
  const { passwordHash, ipAddress, ...safe } = paste
  return {
    ...safe,
    content: includeContent ? paste.content : undefined,
    hasPassword: !!passwordHash,
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** POST /api/pastes — create */
router.post('/', pasteCreationRateLimit, async (c) => {
  const tier    = c.get('tier')
  const userId  = c.get('userId')
  const limits  = TIER_LIMITS[tier]
  const ip      = c.req.header('CF-Connecting-IP') ?? 'unknown'

  // Parse + validate body
  let body: z.infer<typeof CreatePasteSchema>
  try {
    body = CreatePasteSchema.parse(await c.req.json())
  } catch (err) {
    return c.json({ error: 'Invalid request body', details: err }, 400)
  }

  // Enforce tier size limit
  const contentBytes = new TextEncoder().encode(body.content).length
  if (contentBytes > limits.maxPasteSizeBytes) {
    return c.json({
      error: `Content too large. Limit for your tier: ${Math.round(limits.maxPasteSizeBytes / 1024)} KB`,
    }, 413)
  }

  // Enforce tier features
  if (body.visibility === 'private' && !userId) {
    return c.json({ error: 'Private pastes require an account' }, 403)
  }
  if (body.visibility === 'password' && !limits.canUsePassword) {
    return c.json({ error: 'Password-protected pastes require an account' }, 403)
  }

  // Expiry enforcement
  const expiryOpt = body.expiry as ExpiryValue
  if (expiryOpt === 'never' && !limits.canSetNeverExpire) {
    return c.json({ error: 'Never-expiring pastes require a Pro account' }, 403)
  }

  // Count active pastes for anon (IP-based)
  const db = createDb(c.env.DB)
  if (!userId) {
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(pastes)
      .where(and(eq(pastes.ipAddress, ip), isNull(pastes.userId)))
    const count = countResult[0]?.count ?? 0
    if (count >= limits.maxActivePastes) {
      return c.json({ error: `Anonymous paste limit reached (${limits.maxActivePastes})` }, 429)
    }
  }

  // Hash password if needed
  let passwordHash: string | null = null
  if (body.visibility === 'password') {
    if (!body.password) return c.json({ error: 'Password required for password-protected pastes' }, 400)
    passwordHash = await hashPassword(body.password)
  }

  const id = nanoid(8)
  const expiresAt = expiryToTimestamp(expiryOpt)

  const newPaste: NewPaste = {
    id,
    userId:       userId ?? null,
    folderId:     body.folderId ?? null,
    title:        body.title,
    content:      body.content,
    language:     body.language,
    visibility:   body.visibility,
    passwordHash,
    expiresAt,
    ipAddress:    userId ? null : ip,  // only store IP for anon pastes
  }

  await db.insert(pastes).values(newPaste)

  return c.json({ id, url: `/p/${id}` }, 201)
})

/** GET /api/pastes — list own pastes */
router.get('/', requireAuth, async (c) => {
  const userId   = c.get('userId')!
  const db       = createDb(c.env.DB)
  const q        = c.req.query('q')
  const folderId = c.req.query('folderId')
  const page     = parseInt(c.req.query('page') ?? '1')
  const limit    = Math.min(parseInt(c.req.query('limit') ?? '20'), 100)
  const offset   = (page - 1) * limit

  let query = db
    .select()
    .from(pastes)
    .where(and(
      eq(pastes.userId, userId),
      folderId ? eq(pastes.folderId, folderId) : undefined,
    ))
    .orderBy(sql`${pastes.createdAt} DESC`)
    .limit(limit)
    .offset(offset)

  // FTS search if query provided
  if (q) {
    const ftsResults = await db.run(
      sql`SELECT id FROM pastes_fts WHERE pastes_fts MATCH ${q} AND rowid IN (
            SELECT rowid FROM pastes WHERE user_id = ${userId}
          ) ORDER BY rank LIMIT ${limit}`
    )
    const ids = (ftsResults.results as Array<{ id: string }>).map(r => r.id)
    if (ids.length === 0) return c.json({ pastes: [], total: 0, page, limit })

    const results = await db
      .select()
      .from(pastes)
      .where(and(eq(pastes.userId, userId), sql`${pastes.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`))

    return c.json({ pastes: results.map(p => sanitizePaste(p, false)), total: results.length, page, limit })
  }

  const results = await query
  return c.json({ pastes: results.map(p => sanitizePaste(p, false)), page, limit })
})

/** GET /api/pastes/:id — get single paste */
router.get('/:id', async (c) => {
  const { id } = c.req.param()
  const db      = createDb(c.env.DB)
  const userId  = c.get('userId')
  const now     = Math.floor(Date.now() / 1000)

  const result = await db.select().from(pastes).where(eq(pastes.id, id)).limit(1)
  const paste = result[0]

  if (!paste) return c.json({ error: 'Paste not found' }, 404)

  // Check expiry
  if (paste.expiresAt && paste.expiresAt < now) {
    return c.json({ error: 'Paste has expired' }, 410)
  }

  // Private paste — only owner
  if (paste.visibility === 'private' && paste.userId !== userId) {
    return c.json({ error: 'This paste is private' }, 403)
  }

  // Password paste — content not returned until unlocked
  if (paste.visibility === 'password' && paste.userId !== userId) {
    return c.json({ ...sanitizePaste(paste, false), locked: true })
  }

  // Increment view counter (non-blocking)
  c.executionCtx.waitUntil(
    db.update(pastes).set({ views: sql`${pastes.views} + 1` }).where(eq(pastes.id, id))
  )

  return c.json(sanitizePaste(paste, true))
})

/** POST /api/pastes/:id/unlock — verify password and return content */
router.post('/:id/unlock', async (c) => {
  const { id }      = c.req.param()
  const db          = createDb(c.env.DB)
  const { password } = await c.req.json<{ password: string }>()
  const now         = Math.floor(Date.now() / 1000)

  if (!password) return c.json({ error: 'Password required' }, 400)

  const result = await db.select().from(pastes).where(eq(pastes.id, id)).limit(1)
  const paste = result[0]

  if (!paste) return c.json({ error: 'Paste not found' }, 404)
  if (paste.expiresAt && paste.expiresAt < now) return c.json({ error: 'Paste has expired' }, 410)
  if (paste.visibility !== 'password') return c.json({ error: 'Paste is not password-protected' }, 400)
  if (!paste.passwordHash) return c.json({ error: 'Password not set' }, 500)

  const ok = await verifyPassword(password, paste.passwordHash)
  if (!ok) return c.json({ error: 'Incorrect password' }, 403)

  // Increment views
  c.executionCtx.waitUntil(
    db.update(pastes).set({ views: sql`${pastes.views} + 1` }).where(eq(pastes.id, id))
  )

  return c.json(sanitizePaste(paste, true))
})

/** DELETE /api/pastes/:id */
router.delete('/:id', requireAuth, async (c) => {
  const { id }  = c.req.param()
  const userId  = c.get('userId')!
  const db      = createDb(c.env.DB)

  const result = await db.select().from(pastes).where(and(eq(pastes.id, id), eq(pastes.userId, userId))).limit(1)
  if (!result[0]) return c.json({ error: 'Paste not found or not yours' }, 404)

  await db.delete(pastes).where(eq(pastes.id, id))
  return c.json({ deleted: true })
})

/** PATCH /api/pastes/:id */
router.patch('/:id', requireAuth, async (c) => {
  const { id }  = c.req.param()
  const userId  = c.get('userId')!
  const db      = createDb(c.env.DB)

  const result = await db.select().from(pastes).where(and(eq(pastes.id, id), eq(pastes.userId, userId))).limit(1)
  if (!result[0]) return c.json({ error: 'Paste not found or not yours' }, 404)

  let body: z.infer<typeof UpdatePasteSchema>
  try {
    body = UpdatePasteSchema.parse(await c.req.json())
  } catch (err) {
    return c.json({ error: 'Invalid request body', details: err }, 400)
  }

  await db
    .update(pastes)
    .set({ ...body, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(pastes.id, id))

  return c.json({ updated: true })
})

export default router
