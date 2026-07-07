/**
 * /api/pastes routes — D1 nativo, sin drizzle-orm.
 */
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { Env } from '../lib/types'
import { TIER_LIMITS, expiryToTimestamp } from '../lib/tiers'
import { requireAuth } from '../middleware/auth'
import { pasteCreationRateLimit } from '../middleware/rateLimit'

const router = new Hono<{ Bindings: Env }>()

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...headers }
  })
}

function errJson(c: { env: { ENVIRONMENT: string } }, msg: string, err: unknown, status = 500) {
  console.error(`[pastes] ${msg}`, err)
  const isProd = c.env.ENVIRONMENT === 'production'
  return json({ error: msg, ...(isProd ? {} : { detail: String(err) }) }, status)
}

/** Fix 4: Anonimiza IP para cumplimiento GDPR.
 *  IPv4: 192.168.1.100 → 192.168.1.0
 *  IPv6: 2001:db8:85a3::1 → 2001:db8:85a3:0::
 */
function anonymizeIp(ip: string): string {
  if (ip === 'unknown') return ip
  if (ip.includes('.')) {
    // IPv4 — borrar último octeto
    const parts = ip.split('.')
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`
  } else if (ip.includes(':')) {
    // IPv6 — mantener primeros 4 grupos
    const parts = ip.split(':')
    return parts.slice(0, 4).join(':') + '::0'
  }
  return ip
}

// Convierte una fila de D1 (snake_case) al shape que espera el frontend (camelCase)
function toCamelPaste(row: any) {
  return {
    id:          row.id,
    userId:      row.user_id ?? null,
    folderId:    row.folder_id ?? null,
    title:       row.title,
    content:     row.content,
    language:    row.language,
    visibility:  row.visibility,
    expiresAt:   row.expires_at ?? null,
    views:       row.views ?? 0,
    isArchived:  !!row.is_archived,
    hasPassword: !!row.password_hash,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  }
}

// ─── Crypto helpers — PBKDF2 (100k iter) + timing-safe compare ──────────────

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  const ua = new TextEncoder().encode(a)
  const ub = new TextEncoder().encode(b)
  if (ua.length !== ub.length) return false
  let diff = 0
  for (let i = 0; i < ua.length; i++) diff |= (ua[i] ?? 0) ^ (ub[i] ?? 0)
  return diff === 0
}

async function hashPassword(password: string): Promise<string> {
  const salt    = crypto.getRandomValues(new Uint8Array(16))
  const saltHex = toHex(salt.buffer)
  const keyMat  = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits    = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, keyMat, 256)
  return `pbkdf2:${saltHex}:${toHex(bits)}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('pbkdf2:')) {
    const parts   = stored.split(':')
    const saltHex = parts[1] ?? ''
    const hashHex = parts[2] ?? ''
    const saltBuf = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
    const keyMat  = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
    const bits    = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBuf, iterations: 100_000, hash: 'SHA-256' }, keyMat, 256)
    return timingSafeEqual(toHex(bits), hashHex)
  }
  // Soporte retrocompatible con hashes SHA-256 antiguos (formato salt:hex)
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const data    = new TextEncoder().encode(salt + password)
  const newHash = await crypto.subtle.digest('SHA-256', data)
  return timingSafeEqual(toHex(newHash), hash)
}

const CreateSchema = z.object({
  title:      z.string().max(255).default('Untitled'),
  content:    z.string().min(1),
  language:   z.string().max(50).default('plaintext'),
  visibility: z.enum(['public', 'private', 'password']).default('public'),
  password:   z.string().min(4).max(128).optional(),
  expiry:     z.enum(['1h', '3d', '30d', '90d', '300d', 'never']).default('3d'),
  folderId:   z.string().optional(),
})

// POST /api/pastes
router.post('/', pasteCreationRateLimit, async (c) => {
  try {
    const tier   = c.get('tier')
    const userId = c.get('userId')
    const limits = TIER_LIMITS[tier]
    const rawIp  = c.req.header('CF-Connecting-IP') ?? 'unknown'
    // Fix 4: anonimizar IP — solo primeros 3 octetos (GDPR)
    const ip     = anonymizeIp(rawIp)

    let body: z.infer<typeof CreateSchema>
    try { body = CreateSchema.parse(await c.req.json()) }
    catch (e) { return json({ error: 'Invalid request', details: String(e) }, 400) }

    const bytes = new TextEncoder().encode(body.content).length
    if (bytes > limits.maxPasteSizeBytes)
      return json({ error: `Content too large. Limit: ${Math.round(limits.maxPasteSizeBytes / 1024)}KB` }, 413)

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
    return errJson(c, 'Failed to create paste', err)
  }
})

// GET /api/pastes (list own)
router.get('/', requireAuth, async (c) => {
  try {
    const userId   = c.get('userId')!
    const rawQ     = c.req.query('q')
    const folderId = c.req.query('folderId')
    const page     = Math.max(1, parseInt(c.req.query('page') ?? '1'))
    const limit    = Math.min(parseInt(c.req.query('limit') ?? '20'), 100)

    // Fix 5: sanitizar query FTS5 — eliminar operadores especiales que causan 500
    const q = rawQ
      ? rawQ.trim().replace(/["'()*^:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
      : undefined

    if (rawQ !== undefined && !q) {
      // La query quedó vacía tras sanitizar — devolver vacío sin consultar
      return json({ pastes: [], page, limit })
    }
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
      const result = folderId
        ? await c.env.DB.prepare(
            'SELECT * FROM pastes WHERE user_id = ? AND folder_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
          ).bind(userId, folderId, limit, offset).all()
        : await c.env.DB.prepare(
            'SELECT * FROM pastes WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
          ).bind(userId, limit, offset).all()
      rows = result.results
    }

    return json({ pastes: rows.map(toCamelPaste), page, limit })
  } catch (err) {
    console.error('[GET /pastes]', err)
    return errJson(c, 'Internal error', err)
  }
})

// GET /api/pastes/:id
router.get('/:id', async (c) => {
  try {
    const { id } = c.req.param()
    const now    = Math.floor(Date.now() / 1000)
    const userId = c.get('userId')

    const paste = await c.env.DB.prepare('SELECT * FROM pastes WHERE id = ?').bind(id).first<any>()

    if (!paste) return json({ error: 'Paste not found' }, 404)
    if (paste.expires_at && paste.expires_at < now) return json({ error: 'Paste has expired' }, 410)
    if (paste.visibility === 'private' && paste.user_id !== userId)
      return json({ error: 'This paste is private' }, 403)
    if (paste.visibility === 'password' && paste.user_id !== userId) {
      const safe = toCamelPaste(paste)
      return json({ ...safe, content: undefined, locked: true })
    }

    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE pastes SET views = views + 1 WHERE id = ?').bind(id).run()
    )
    return json(toCamelPaste(paste))
  } catch (err) {
    console.error('[GET /pastes/:id]', err)
    return errJson(c, 'Internal error', err)
  }
})

// POST /api/pastes/:id/unlock
router.post('/:id/unlock', async (c) => {
  try {
    const { id }       = c.req.param()
    const { password } = await c.req.json<{ password: string }>()
    const now          = Math.floor(Date.now() / 1000)

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
    return json(toCamelPaste(paste))
  } catch (err) {
    return errJson(c, 'Internal error', err)
  }
})

// PATCH /api/pastes/:id
router.patch('/:id', requireAuth, async (c) => {
  try {
    const { id }  = c.req.param()
    const userId  = c.get('userId')!

    const existing = await c.env.DB.prepare(
      'SELECT id FROM pastes WHERE id = ? AND user_id = ?'
    ).bind(id, userId).first()
    if (!existing) return json({ error: 'Not found or not yours' }, 404)

    const body = await c.req.json<{ title?: string; folderId?: string | null }>()
    const now  = Math.floor(Date.now() / 1000)

    if (body.title !== undefined) {
      await c.env.DB.prepare('UPDATE pastes SET title = ?, updated_at = ? WHERE id = ?')
        .bind(body.title, now, id).run()
    }
    if (body.folderId !== undefined) {
      await c.env.DB.prepare('UPDATE pastes SET folder_id = ?, updated_at = ? WHERE id = ?')
        .bind(body.folderId, now, id).run()
    }

    return json({ updated: true })
  } catch (err) {
    console.error('[PATCH /pastes/:id]', err)
    return errJson(c, 'Internal error', err)
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
    return errJson(c, 'Internal error', err)
  }
})

export default router
