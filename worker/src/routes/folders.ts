/**
 * /api/folders routes — folder/project management. D1 nativo.
 */
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import type { Env } from '../lib/types'
import { requireAuth } from '../middleware/auth'
import { TIER_LIMITS } from '../lib/tiers'
import { errorResponse } from '../lib/http'

const router = new Hono<{ Bindings: Env }>()
router.use('*', requireAuth)

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  })
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function toCamel(row: any) {
  return {
    id:        row.id,
    userId:    row.user_id,
    parentId:  row.parent_id ?? null,
    name:      row.name,
    slug:      row.slug,
    color:     row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// GET /api/folders
router.get('/', async (c) => {
  try {
    const userId = c.get('userId')!
    const rows = await c.env.DB.prepare(
      'SELECT * FROM folders WHERE user_id = ? ORDER BY name'
    ).bind(userId).all()
    return json({ folders: rows.results.map(toCamel) })
  } catch (err) {
    return errorResponse(c, 'Failed to list folders', err)
  }
})

// POST /api/folders
router.post('/', async (c) => {
  try {
    const tier   = c.get('tier')
    const userId = c.get('userId')!

    if (!TIER_LIMITS[tier].canUseFolders)
      return json({ error: 'Folders require a registered account' }, 403)

    const body = await c.req.json<{ name: string; parentId?: string; color?: string }>()
    if (!body.name?.trim())
      return json({ error: 'Folder name is required' }, 400)

    const now   = Math.floor(Date.now() / 1000)
    const id    = nanoid(8)
    const slug  = slugify(body.name)
    const color = body.color ?? '#6366f1'

    await c.env.DB.prepare(`
      INSERT INTO folders (id, user_id, parent_id, name, slug, color, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).bind(id, userId, body.parentId ?? null, body.name.trim(), slug, color, now, now).run()

    return json({ id, userId, parentId: body.parentId ?? null, name: body.name.trim(), slug, color, createdAt: now, updatedAt: now }, 201)
  } catch (err) {
    return errorResponse(c, 'Failed to create folder', err)
  }
})

// PATCH /api/folders/:id
router.patch('/:id', async (c) => {
  try {
    const { id }  = c.req.param()
    const userId  = c.get('userId')!

    const existing = await c.env.DB.prepare(
      'SELECT id FROM folders WHERE id = ? AND user_id = ?'
    ).bind(id, userId).first()
    if (!existing) return json({ error: 'Folder not found' }, 404)

    const body = await c.req.json<{ name?: string; color?: string }>()
    const now  = Math.floor(Date.now() / 1000)

    if (body.name) {
      await c.env.DB.prepare(
        'UPDATE folders SET name = ?, slug = ?, updated_at = ? WHERE id = ?'
      ).bind(body.name.trim(), slugify(body.name), now, id).run()
    }
    if (body.color) {
      await c.env.DB.prepare(
        'UPDATE folders SET color = ?, updated_at = ? WHERE id = ?'
      ).bind(body.color, now, id).run()
    }

    return json({ updated: true })
  } catch (err) {
    return errorResponse(c, 'Failed to update folder', err)
  }
})

// DELETE /api/folders/:id
router.delete('/:id', async (c) => {
  try {
    const { id }  = c.req.param()
    const userId  = c.get('userId')!

    const existing = await c.env.DB.prepare(
      'SELECT id FROM folders WHERE id = ? AND user_id = ?'
    ).bind(id, userId).first()
    if (!existing) return json({ error: 'Folder not found' }, 404)

    await c.env.DB.prepare('UPDATE pastes SET folder_id = NULL WHERE folder_id = ?').bind(id).run()
    await c.env.DB.prepare('DELETE FROM folders WHERE id = ?').bind(id).run()

    return json({ deleted: true })
  } catch (err) {
    return errorResponse(c, 'Failed to delete folder', err)
  }
})

export default router
