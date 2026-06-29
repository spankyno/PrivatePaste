import { Hono } from 'hono'
import type { Env } from './lib/types'
import { rateLimitMiddleware } from './middleware/rateLimit'

const app = new Hono<{ Bindings: Env }>()
app.use('/api/*', rateLimitMiddleware)
app.get('/api/health', (c) => c.json({ ok: true, step: 'B' }))
app.get('*', async (c) => {
  try { return await c.env.ASSETS.fetch(c.req.raw) }
  catch { return c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url))) }
})
export default { fetch: app.fetch }
