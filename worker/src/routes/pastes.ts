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
import { hashPassword, verifyPassword, needsRehash } from '../lib/password'
import { errorResponse } from '../lib/http'

const router = new Hono<{ Bindings: Env }>()

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...headers }
  })
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

// hashPassword/verifyPassword ahora viven en ../lib/password.ts (PBKDF2-SHA256)

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
    const ip     = c.req.header('CF-Connecting-IP') ?? 'unknown'

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
    const expiresAt = expiryToTimestamp(body.expiry)

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
    return errorResponse(c, 'Failed to create paste', err)
  }
})

// GET /api/pastes (list own)
router.get('/', requireAuth, async (c) => {
  try {
    const userId    = c.get('userId')!
    const q         = c.req.query('q')
    const folderId  = c.req.query('folderId')
    const page      = Math.max(1, parseInt(c.req.query('page') ?? '1'))
    const limit     = Math.min(parseInt(c.req.query('limit') ?? '20'), 100)
    const offset    = (page - 1) * limit
    const now       = Math.floor(Date.now() / 1000)

    // Por defecto solo se listan los pastes activos. Los pastes PRO
    // caducados se archivan (is_archived=1) en vez de borrarse, pero no
    // deben aparecer en el listado principal — quedan disponibles aparte
    // con ?archived=1 (el dueño puede seguir accediendo a su contenido).
    //
    // El cron que fija is_archived=1 solo corre una vez por hora, así que
    // un paste puede llevar caducado un rato con is_archived aún en 0.
    // Para no esperar a esa próxima pasada, la caducidad se comprueba
    // también aquí en el momento de leer (misma idea que el downgrade
    // perezoso de cuentas PRO): un paste cuenta como "archivado" en
    // cuanto expires_at queda en el pasado, no solo cuando el cron lo
    // marca físicamente.
    const showArchived = c.req.query('archived') === '1'
    const statusFilter = showArchived
      ? '(p.is_archived = 1 OR (p.expires_at IS NOT NULL AND p.expires_at <= ?))'
      : '(p.is_archived = 0 AND (p.expires_at IS NULL OR p.expires_at > ?))'

    // Se pide una fila de más (limit + 1) para saber si hay más resultados
    // sin necesidad de un segundo COUNT(*); se recorta a `limit` después.
    const fetchLimit = limit + 1

    let rows: any[]
    if (q) {
      const fts = await c.env.DB.prepare(
        `SELECT p.* FROM pastes p
         INNER JOIN pastes_fts f ON f.id = p.id
         WHERE f.pastes_fts MATCH ? AND p.user_id = ? AND ${statusFilter}
         ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
      ).bind(q, userId, now, fetchLimit, offset).all()
      rows = fts.results
    } else {
      const result = folderId
        ? await c.env.DB.prepare(
            `SELECT p.* FROM pastes p WHERE p.user_id = ? AND p.folder_id = ? AND ${statusFilter}
             ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
          ).bind(userId, folderId, now, fetchLimit, offset).all()
        : await c.env.DB.prepare(
            `SELECT p.* FROM pastes p WHERE p.user_id = ? AND ${statusFilter}
             ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
          ).bind(userId, now, fetchLimit, offset).all()
      rows = result.results
    }

    const hasMore = rows.length > limit
    if (hasMore) rows = rows.slice(0, limit)

    return json({ pastes: rows.map(toCamelPaste), page, limit, hasMore })
  } catch (err) {
    return errorResponse(c, 'Failed to list pastes', err)
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

    const isOwner   = !!userId && paste.user_id === userId
    const isExpired = paste.expires_at && paste.expires_at < now

    // Un paste caducado (archivado para cuentas PRO/admin) deja de ser
    // públicamente accesible, pero el dueño puede seguir consultando su
    // contenido — solo se bloquea a terceros.
    if (isExpired && !isOwner) return json({ error: 'Paste has expired' }, 410)
    if (paste.visibility === 'private' && !isOwner)
      return json({ error: 'This paste is private' }, 403)
    if (paste.visibility === 'password' && !isOwner) {
      const safe = toCamelPaste(paste)
      return json({ ...safe, content: undefined, locked: true })
    }

    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE pastes SET views = views + 1 WHERE id = ?').bind(id).run()
    )
    return json(toCamelPaste(paste))
  } catch (err) {
    return errorResponse(c, 'Failed to retrieve paste', err)
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

    // Migración transparente del hash legacy (SHA-256) a PBKDF2
    if (needsRehash(paste.password_hash)) {
      c.executionCtx.waitUntil(
        c.env.DB.prepare('UPDATE pastes SET password_hash = ? WHERE id = ?')
          .bind(await hashPassword(password), id).run()
      )
    }

    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE pastes SET views = views + 1 WHERE id = ?').bind(id).run()
    )
    return json(toCamelPaste(paste))
  } catch (err) {
    return errorResponse(c, 'Failed to unlock paste', err)
  }
})

// PATCH /api/pastes/:id
router.patch('/:id', requireAuth, async (c) => {
  try {
    const { id }  = c.req.param()
    const userId  = c.get('userId')!
    const tier    = c.get('tier')
    const limits  = TIER_LIMITS[tier]

    const existing = await c.env.DB.prepare(
      'SELECT id FROM pastes WHERE id = ? AND user_id = ?'
    ).bind(id, userId).first()
    if (!existing) return json({ error: 'Not found or not yours' }, 404)

    const body = await c.req.json<{
      title?: string
      folderId?: string | null
      content?: string
      language?: string
      visibility?: 'public' | 'private' | 'password'
      password?: string
      expiry?: '1h' | '3d' | '30d' | '90d' | '300d' | 'never'
    }>()
    const now  = Math.floor(Date.now() / 1000)

    if (body.content !== undefined) {
      if (!body.content.trim())
        return json({ error: 'Content cannot be empty' }, 400)
      const bytes = new TextEncoder().encode(body.content).length
      if (bytes > limits.maxPasteSizeBytes)
        return json({ error: `Content too large. Limit: ${Math.round(limits.maxPasteSizeBytes / 1024)}KB` }, 413)
      await c.env.DB.prepare('UPDATE pastes SET content = ?, updated_at = ? WHERE id = ?')
        .bind(body.content, now, id).run()
    }
    if (body.language !== undefined) {
      await c.env.DB.prepare('UPDATE pastes SET language = ?, updated_at = ? WHERE id = ?')
        .bind(body.language, now, id).run()
    }
    if (body.title !== undefined) {
      await c.env.DB.prepare('UPDATE pastes SET title = ?, updated_at = ? WHERE id = ?')
        .bind(body.title, now, id).run()
    }
    if (body.folderId !== undefined) {
      await c.env.DB.prepare('UPDATE pastes SET folder_id = ?, updated_at = ? WHERE id = ?')
        .bind(body.folderId, now, id).run()
    }
    if (body.visibility !== undefined) {
      if (!['public', 'private', 'password'].includes(body.visibility)) {
        return json({ error: 'Invalid visibility' }, 400)
      }
      if (body.visibility === 'password' && !limits.canUsePassword) {
        return json({ error: 'Password protected pastes are not supported for your tier' }, 403)
      }
      if (body.password !== undefined && (body.password.length < 4 || body.password.length > 128)) {
        return json({ error: 'Password must be between 4 and 128 characters' }, 400)
      }

      let passwordHash: string | null = null
      if (body.visibility === 'password') {
        if (body.password) {
          passwordHash = await hashPassword(body.password)
        } else {
          const current = await c.env.DB.prepare(
            'SELECT password_hash FROM pastes WHERE id = ?'
          ).bind(id).first<{ password_hash: string | null }>()
          if (!current?.password_hash) {
            return json({ error: 'Password required when setting visibility to password' }, 400)
          }
          passwordHash = current.password_hash
        }
      }

      await c.env.DB.prepare('UPDATE pastes SET visibility = ?, password_hash = ?, updated_at = ? WHERE id = ?')
        .bind(body.visibility, passwordHash, now, id).run()
    } else if (body.password !== undefined) {
      if (body.password.length < 4 || body.password.length > 128) {
        return json({ error: 'Password must be between 4 and 128 characters' }, 400)
      }
      const current = await c.env.DB.prepare(
        'SELECT visibility FROM pastes WHERE id = ?'
      ).bind(id).first<{ visibility: string }>()
      if (current?.visibility !== 'password') {
        return json({ error: 'Cannot set password on non-password protected paste' }, 400)
      }
      const passwordHash = await hashPassword(body.password)
      await c.env.DB.prepare('UPDATE pastes SET password_hash = ?, updated_at = ? WHERE id = ?')
        .bind(passwordHash, now, id).run()
    }
    if (body.expiry !== undefined) {
      if (!['1h', '3d', '30d', '90d', '300d', 'never'].includes(body.expiry)) {
        return json({ error: 'Invalid expiry value' }, 400)
      }
      if (body.expiry === 'never' && !limits.canSetNeverExpire) {
        return json({ error: 'Never-expiring pastes require Pro' }, 403)
      }
      const expiresAt = expiryToTimestamp(body.expiry)
      await c.env.DB.prepare('UPDATE pastes SET expires_at = ?, updated_at = ? WHERE id = ?')
        .bind(expiresAt ?? null, now, id).run()
    }

    const updated = await c.env.DB.prepare('SELECT * FROM pastes WHERE id = ?').bind(id).first<any>()
    return json(toCamelPaste(updated))
  } catch (err) {
    return errorResponse(c, 'Failed to update paste', err)
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
    return errorResponse(c, 'Failed to delete paste', err)
  }
})

export default router
