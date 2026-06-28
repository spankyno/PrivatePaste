/**
 * /api/folders routes — folder/project management.
 *
 * GET    /api/folders         List user's folders (tree)
 * POST   /api/folders         Create folder
 * PATCH  /api/folders/:id     Rename / recolor
 * DELETE /api/folders/:id     Delete (pastes move to root)
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { eq, and, isNull } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { createDb, folders, type NewFolder } from '../db'
import { requireAuth } from '../middleware/auth'
import { TIER_LIMITS } from '../lib/tiers'

const router = new Hono<{ Bindings: Env }>()
router.use('*', requireAuth)

const FolderSchema = z.object({
  name:     z.string().min(1).max(100),
  parentId: z.string().nullable().optional(),
  color:    z.string().regex(/^#[0-9a-f]{6}$/i).default('#6366f1'),
})

/** Slugify folder name */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

router.get('/', async (c) => {
  const userId = c.get('userId')!
  const db     = createDb(c.env.DB)
  const all    = await db.select().from(folders).where(eq(folders.userId, userId))
  return c.json({ folders: all })
})

router.post('/', async (c) => {
  const tier   = c.get('tier')
  const userId = c.get('userId')!
  const db     = createDb(c.env.DB)

  if (!TIER_LIMITS[tier].canUseFolders) {
    return c.json({ error: 'Folders require a registered account' }, 403)
  }

  let body: z.infer<typeof FolderSchema>
  try { body = FolderSchema.parse(await c.req.json()) }
  catch (e) { return c.json({ error: 'Invalid request', details: e }, 400) }

  const newFolder: NewFolder = {
    id:       nanoid(8),
    userId,
    parentId: body.parentId ?? null,
    name:     body.name,
    slug:     slugify(body.name),
    color:    body.color,
  }

  await db.insert(folders).values(newFolder)
  return c.json(newFolder, 201)
})

router.patch('/:id', async (c) => {
  const { id } = c.req.param()
  const userId = c.get('userId')!
  const db     = createDb(c.env.DB)

  const existing = await db.select().from(folders).where(and(eq(folders.id, id), eq(folders.userId, userId))).limit(1)
  if (!existing[0]) return c.json({ error: 'Folder not found' }, 404)

  const body = FolderSchema.partial().parse(await c.req.json())
  await db.update(folders).set({
    ...body,
    slug:      body.name ? slugify(body.name) : undefined,
    updatedAt: Math.floor(Date.now() / 1000),
  }).where(eq(folders.id, id))

  return c.json({ updated: true })
})

router.delete('/:id', async (c) => {
  const { id } = c.req.param()
  const userId = c.get('userId')!
  const db     = createDb(c.env.DB)

  const existing = await db.select().from(folders).where(and(eq(folders.id, id), eq(folders.userId, userId))).limit(1)
  if (!existing[0]) return c.json({ error: 'Folder not found' }, 404)

  await db.delete(folders).where(eq(folders.id, id))
  // Pastes automatically move to root via FK SET NULL
  return c.json({ deleted: true })
})

export default router
