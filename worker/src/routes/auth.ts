/**
 * Auth routes — delegated to better-auth.
 *
 * better-auth handles:
 *   POST /api/auth/sign-up/email
 *   POST /api/auth/sign-in/email
 *   POST /api/auth/sign-out
 *   GET  /api/auth/session
 *   GET  /api/auth/callback/:provider  (GitHub OAuth)
 *
 * We configure it here and mount it under /api/auth/*.
 */
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { Hono } from 'hono'
import { createDb, users, sessions, accounts, verifications } from '../db'
import type { Env } from '../lib/types'

export function createAuth(env: Env) {
  const db = createDb(env.DB)

  return betterAuth({
    secret: env.AUTH_SECRET,
    baseURL: env.ENVIRONMENT === 'production'
      ? 'https://your-domain.workers.dev'  // replace with actual domain
      : 'http://localhost:8787',

    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: { users, sessions, accounts, verifications },
    }),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,   // set true and add email plugin for production
      minPasswordLength: 8,
    },

    // Optional: GitHub OAuth (requires GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET secrets)
    // socialProviders: {
    //   github: {
    //     clientId:     env.GITHUB_CLIENT_ID,
    //     clientSecret: env.GITHUB_CLIENT_SECRET,
    //   },
    // },

    session: {
      cookieName:    'pp_session',
      expiresIn:     60 * 60 * 24 * 30,   // 30 days
      updateAge:     60 * 60 * 24,         // refresh if older than 1 day
    },

    // Trust proxy headers from Cloudflare
    trustedOrigins: ['*'],
  })
}

/** Mount better-auth handler under /api/auth/* */
export function authRouter(env: Env) {
  const auth   = createAuth(env)
  const router = new Hono<{ Bindings: Env }>()

  router.all('/*', async (c) => {
    // Convert Hono request to Web Fetch API Request
    const response = await auth.handler(c.req.raw)
    return response
  })

  return router
}
