import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { Env } from '../lib/types'
import { TIER_LIMITS, expiryToTimestamp } from '../lib/tiers'
import { requireAuth } from '../middleware/auth'
import { pasteCreationRateLimit } from '../middleware/rateLimit'

const router = new Hono<{ Bindings: Env }>()

function json(data: unknown, status = 200, headers: Record<string,string> = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...headers }
  })
}

async function hashPassword(password: string): Promise<string> {
  const salt = nanoid(16)
  const data = new TextEncoder().encode(salt + password)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const hex  = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('')
  return `${salt}:${hex}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const data    = new TextEncoder().encode(salt + password)
  const newHash = await crypto.subtle.digest('SHA-256', data)
  const hex     = Array.from(new Uint8Array(newHash)).map(b => b.toString(16).padStart(2,'0')).join('')
  return hex === hash
}

const CreateSchema = z.object({
  title:      z.string().max(255).default('Untitled'),
  content:    z.string().min(1),
  language:   z.string().max(50).default('plaintext'),
  visibility: z.enum(['public','private','password']).default('public'),
  password:   z.string().min(4).max(128).optional(),
  expiry:     z.enum(['1h','3d','30d','90d','300d','never']).default('3d'),
  folderId:   z.string().optional(),
})

// POST /api/pastes
router.post('/', pasteCreationRateLimit, async (c) => {
  try {
    const tier   = c.get('tier')
    const userId = c.get('userId')
    const limits = TIER_LIMITS[tier]
    const ip     = c.req.header('CF-Connecting-IP') ?? 'unknown'

    let body: z.infer<typeof CreateSchema>
    try { body = CreateSchema.parse(await c.req.json()) }
    catch (e) { return json({ error: 'Invalid request', details: String(e) }, 400) }

    const bytes = new TextEncoder().encode(body.content).length
    if (bytes > limits.maxPasteSizeBytes)
      return json({ error: `Content too large. Limit: ${Math.round(limits.maxPasteSizeBytes/1024)}KB` }, 413)

    if (body.visibility === 'private' && !userId)
      return json({ error: 'Private pastes require an account' }, 403)
    if (body.visibility === 'password' && !limits.canUsePassword)
      return json({ error: 'Password pastes require an account' }, 403)
    if (body.expiry === 'never' && !limits.canSetNeverExpire)
      return json({ error: 'Never-expiring pastes require Pro' }, 403)

    if (!userId) {
      const row = await c.env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM pastes WHERE ip_address = ? AND user_id IS NULL'
      ).bind(ip).first<{ cnt: number }>()
      if ((row?.cnt ?? 0) >= limits.maxActivePastes)
        return json({ error: `Anonymous paste limit reached (${limits.maxActivePastes})` }, 429)
    }

    let passwordHash: string | null = null
    if (body.visibility === 'password') {
      if (!body.password) return json({ error: 'Password required' }, 400)
      passwordHash = await hashPassword(body.password)
    }

    const id        = nanoid(8)
    const now       = Math.floor(Date.now() / 1000)
    const expiresAt = expiryToTimestamp(body.expiry as any)

    await c.env.DB.prepare(`
      INSERT INTO pastes
        (id, user_id, folder_id, title, content, language,
         visibility, password_hash, expires_at, views, is_archived, ip_address, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,0,0,?,?,?)
    `).bind(
      id, userId ?? null, body.folderId ?? null,
      body.title, body.content, body.language,
      body.visibility, passwordHash, expiresAt ?? null,
      userId ? null : ip, now, now
    ).run()

    return json({ id, url: `/p/${id}` }, 201)
  } catch (err) {
    console.error('[POST /pastes]', err)
    return json({ error: 'Failed to create paste', detail: String(err) }, 500)
  }
})

// GET /api/pastes (list own)
router.get('/', requireAuth, async (c) => {
  try {
    const userId   = c.get('userId')!
    const q        = c.req.query('q')
    const folderId = c.req.query('folderId')
    const page     = Math.max(1, parseInt(c.req.query('page') ?? '1'))
    const limit    = Math.min(parseInt(c.req.query('limit') ?? '20'), 100)
    const offset   = (page - 1) * limit

    let rows: any[]
    if (q) {
      const fts = await c.env.DB.prepare(
        `SELECT p.* FROM pastes p
         INNER JOIN pastes_fts f ON f.id = p.id
         WHERE f.pastes_fts MATCH ? AND p.user_id = ?
         ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
      ).bind(q, userId, limit, offset).all()
      rows = fts.results
    } else {
      const base = folderId
        ? await c.env.DB.prepare(
            'SELECT * FROM pastes WHERE user_id = ? AND folder_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
          ).bind(userId, folderId, limit, offset).all()
        : await c.env.DB.prepare(
            'SELECT * FROM pastes WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
          ).bind(userId, limit, offset).all()
      rows = base.results
    }

    const pastes = rows.map(({ password_hash, ip_address, ...p }) => ({
      ...p, hasPassword: !!password_hash
    }))
    return json({ pastes, page, limit })
  } catch (err) {
    console.error('[GET /pastes]', err)
    return json({ error: String(err) }, 500)
  }
})

// GET /api/pastes/:id
router.get('/:id', async (c) => {
  try {
    const { id } = c.req.param()
    const now    = Math.floor(Date.now() / 1000)
    const userId = c.get('userId')

    const paste = await c.env.DB.prepare(
      'SELECT * FROM pastes WHERE id = ?'
    ).bind(id).first<any>()

    if (!paste) return json({ error: 'Paste not found' }, 404)
    if (paste.expires_at && paste.expires_at < now) return json({ error: 'Paste has expired' }, 410)
    if (paste.visibility === 'private' && paste.user_id !== userId)
      return json({ error: 'This paste is private' }, 403)
    if (paste.visibility === 'password' && paste.user_id !== userId) {
      const { password_hash, ip_address, content, ...safe } = paste
      return json({ ...safe, hasPassword: true, locked: true })
    }

    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE pastes SET views = views + 1 WHERE id = ?').bind(id).run()
    )
    const { password_hash, ip_address, ...safe } = paste
    return json({ ...safe, hasPassword: !!password_hash })
  } catch (err) {
    console.error('[GET /pastes/:id]', err)
    return json({ error: String(err) }, 500)
  }
})

// POST /api/pastes/:id/unlock
router.post('/:id/unlock', async (c) => {
  try {
    const { id }      = c.req.param()
    const { password } = await c.req.json<{ password: string }>()
    const now         = Math.floor(Date.now() / 1000)

    const paste = await c.env.DB.prepare('SELECT * FROM pastes WHERE id = ?').bind(id).first<any>()
    if (!paste)                                     return json({ error: 'Not found' }, 404)
    if (paste.expires_at && paste.expires_at < now) return json({ error: 'Expired' }, 410)
    if (paste.visibility !== 'password')            return json({ error: 'Not password protected' }, 400)
    if (!paste.password_hash)                       return json({ error: 'No password set' }, 500)

    const ok = await verifyPassword(password, paste.password_hash)
    if (!ok) return json({ error: 'Incorrect password' }, 403)

    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE pastes SET views = views + 1 WHERE id = ?').bind(id).run()
    )
    const { password_hash, ip_address, ...safe } = paste
    return json({ ...safe, hasPassword: true })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

// DELETE /api/pastes/:id
router.delete('/:id', requireAuth, async (c) => {
  try {
    const { id }  = c.req.param()
    const userId  = c.get('userId')!
    const paste   = await c.env.DB.prepare(
      'SELECT id FROM pastes WHERE id = ? AND user_id = ?'
    ).bind(id, userId).first()
    if (!paste) return json({ error: 'Not found or not yours' }, 404)
    await c.env.DB.prepare('DELETE FROM pastes WHERE id = ?').bind(id).run()
    return json({ deleted: true })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

export default router
