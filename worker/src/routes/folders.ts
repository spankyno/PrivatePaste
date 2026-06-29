import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import type { Env } from '../lib/types'
import { requireAuth } from '../middleware/auth'
import { TIER_LIMITS } from '../lib/tiers'

const router = new Hono<{ Bindings: Env }>()
router.use('*', requireAuth)

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
}

router.get('/', async (c) => {
  const userId = c.get('userId')!
  const rows   = await c.env.DB.prepare(
    'SELECT * FROM folders WHERE user_id = ? ORDER BY name'
  ).bind(userId).all()
  return c.json({ folders: rows.results })
})

router.post('/', async (c) => {
  const tier   = c.get('tier')
  const userId = c.get('userId')!
  if (!TIER_LIMITS[tier].canUseFolders)
    return c.json({ error: 'Folders require a registered account' }, 403)

  const body = await c.req.json<{ name: string; parentId?: string; color?: string }>()
  if (!body.name) return c.json({ error: 'Name required' }, 400)

  const now = Math.floor(Date.now() / 1000)
  const id  = nanoid(8)
  await c.env.DB.prepare(`
    INSERT INTO folders (id, user_id, parent_id, name, slug, color, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).bind(id, userId, body.parentId ?? null, body.name, slugify(body.name),
          body.color ?? '#6366f1', now, now).run()

  return c.json({ id, name: body.name, slug: slugify(body.name) }, 201)
})

router.delete('/:id', async (c) => {
  const { id } = c.req.param()
  const userId = c.get('userId')!
  const row    = await c.env.DB.prepare(
    'SELECT id FROM folders WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first()
  if (!row) return c.json({ error: 'Not found' }, 404)
  await c.env.DB.prepare('DELETE FROM folders WHERE id = ?').bind(id).run()
  return c.json({ deleted: true })
})

export default router
