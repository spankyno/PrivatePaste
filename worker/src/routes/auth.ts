/**
 * Auth routes — better-auth con adaptador D1 nativo.
 * Usa el adaptador oficial de better-auth para Cloudflare D1
 * en lugar del adaptador Drizzle, evitando problemas de bundle en el edge.
 */
import { betterAuth } from 'better-auth'
import { Hono } from 'hono'
import type { Env } from '../lib/types'

export function createAuth(env: Env) {
  return betterAuth({
    secret: env.AUTH_SECRET,

    baseURL: env.ENVIRONMENT === 'production'
      ? 'https://privatepaste.YOUR_SUBDOMAIN.workers.dev'  // ⚠ cambia por tu URL real tras el primer deploy
      : 'http://localhost:8787',

    // Adaptador D1 nativo — sin drizzle-orm
    database: {
      type: 'sqlite',
      db:   env.DB,
    },

    emailAndPassword: {
      enabled:                    true,
      requireEmailVerification:   false,
      minPasswordLength:          8,
    },

    session: {
      cookieName: 'pp_session',
      expiresIn:  60 * 60 * 24 * 30,  // 30 días
      updateAge:  60 * 60 * 24,        // refrescar si >1 día
    },

    trustedOrigins: ['*'],
  })
}

/** Monta better-auth bajo /api/auth/* */
export function authRouter(env: Env) {
  const auth   = createAuth(env)
  const router = new Hono<{ Bindings: Env }>()

  router.all('/*', async (c) => {
    return auth.handler(c.req.raw)
  })

  return router
}
