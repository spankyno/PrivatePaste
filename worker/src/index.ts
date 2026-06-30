import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { logger } from 'hono/logger'
import type { Env } from './lib/types'
import { authMiddleware } from './middleware/auth'
import { rateLimitMiddleware } from './middleware/rateLimit'
import authRouter from './routes/auth'
import pastesRouter from './routes/pastes'
import foldersRouter from './routes/folders'
import { handleScheduled } from './cron'

const app = new Hono<{ Bindings: Env }>()

app.use('*', secureHeaders())
app.use('*', cors({
  origin: ['http://localhost:5173', 'https://privatepaste-production.kbo1.workers.dev'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))
app.use('/api/*', logger())
app.use('/api/*', authMiddleware)
app.use('/api/*', rateLimitMiddleware)

app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }))
app.route('/api/auth',    authRouter)
app.route('/api/pastes',  pastesRouter)
app.route('/api/folders', foldersRouter)

app.get('/api/me', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ user: null, tier: 'anon' })
  return c.json({ user, tier: c.get('tier') })
})

app.get('/raw/:id', async (c) => {
  const { id } = c.req.param()
  const now    = Math.floor(Date.now() / 1000)
  const paste  = await c.env.DB.prepare(
    'SELECT * FROM pastes WHERE id = ?'
  ).bind(id).first<any>()

  if (!paste)                                     return c.text('Not found', 404)
  if (paste.expires_at && paste.expires_at < now) return c.text('Paste expired', 410)
  if (paste.visibility === 'private' && paste.user_id !== c.get('userId'))
                                                  return c.text('Private paste', 403)
  if (paste.visibility === 'password' && paste.user_id !== c.get('userId'))
                                                  return c.text('Password required', 403)

  c.executionCtx.waitUntil(
    c.env.DB.prepare('UPDATE pastes SET views = views + 1 WHERE id = ?').bind(id).run()
  )
  return c.text(paste.content, 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
  })
})

app.get('*', async (c) => {
  try { return await c.env.ASSETS.fetch(c.req.raw) }
  catch { return c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url))) }
})

export default { fetch: app.fetch, scheduled: handleScheduled }
