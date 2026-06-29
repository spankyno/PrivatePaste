/**
 * PrivatePaste — Cloudflare Worker entry point.
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { logger } from 'hono/logger'
import type { Env } from './lib/types'
import { authMiddleware } from './middleware/auth'
import { rateLimitMiddleware } from './middleware/rateLimit'
import { createAuth } from './routes/auth'
import pastesRouter from './routes/pastes'
import foldersRouter from './routes/folders'
import { handleScheduled } from './cron'
import { createDb, pastes } from './db'
import { eq, sql } from 'drizzle-orm'

const app = new Hono<{ Bindings: Env }>()

// ─── Global middleware ────────────────────────────────────────────────────────

app.use('*', secureHeaders())
app.use('*', cors({
  origin: ['http://localhost:5173', 'https://privatepaste.YOUR_SUBDOMAIN.workers.dev'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))
app.use('/api/*', logger())
app.use('/api/*', authMiddleware)
app.use('/api/*', rateLimitMiddleware)

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }))

// ─── Auth — better-auth maneja todas las rutas /api/auth/* ───────────────────
// Se monta como handler directo, no como sub-router de Hono
app.all('/api/auth/*', async (c) => {
  const auth = createAuth(c.env)
  return auth.handler(c.req.raw)
})

// ─── API routes ───────────────────────────────────────────────────────────────
app.route('/api/pastes',  pastesRouter)
app.route('/api/folders', foldersRouter)

// ─── /api/me — sesión actual ──────────────────────────────────────────────────
app.get('/api/me', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ user: null, tier: 'anon' })
  return c.json({ user, tier: c.get('tier') })
})

// ─── Raw paste endpoint ───────────────────────────────────────────────────────
app.get('/raw/:id', async (c) => {
  const { id } = c.req.param()
  const db      = createDb(c.env.DB)
  const now     = Math.floor(Date.now() / 1000)

  const result = await db.select().from(pastes).where(eq(pastes.id, id)).limit(1)
  const paste  = result[0]

  if (!paste)                                   return c.text('Not found', 404)
  if (paste.expiresAt && paste.expiresAt < now) return c.text('Paste expired', 410)
  if (paste.visibility === 'private' && paste.userId !== c.get('userId'))
                                                return c.text('Private paste', 403)
  if (paste.visibility === 'password' && paste.userId !== c.get('userId'))
                                                return c.text('Password required — visit the paste URL to unlock', 403)

  c.executionCtx.waitUntil(
    db.update(pastes).set({ views: sql`${pastes.views} + 1` }).where(eq(pastes.id, id))
  )

  return c.text(paste.content, 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
  })
})

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', async (c) => {
  try {
    return await c.env.ASSETS.fetch(c.req.raw)
  } catch {
    return c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)))
  }
})

// ─── Export ───────────────────────────────────────────────────────────────────
export default {
  fetch:     app.fetch,
  scheduled: handleScheduled,
}
