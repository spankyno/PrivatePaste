import { Hono } from 'hono'
import type { Env } from './lib/types'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }))

app.get('*', async (c) => {
  try {
    return await c.env.ASSETS.fetch(c.req.raw)
  } catch {
    return c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)))
  }
})

export default { fetch: app.fetch }
