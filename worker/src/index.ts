import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { logger } from 'hono/logger'
import type { Env } from './lib/types'
import { authMiddleware } from './middleware/auth'
import { rateLimitMiddleware } from './middleware/rateLimit'
import authRouter from './routes/auth'

// pastes, folders, cron y db comentados temporalmente
// para aislar qué import rompe el bundle

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

app.route('/api/auth', authRouter)

app.get('/api/me', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ user: null, tier: 'anon' })
  return c.json({ user, tier: c.get('tier') })
})

// SPA fallback
app.get('*', async (c) => {
  try {
    return await c.env.ASSETS.fetch(c.req.raw)
  } catch {
    return c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)))
  }
})

export default {
  fetch: app.fetch,
  // scheduled comentado también para aislar
}
