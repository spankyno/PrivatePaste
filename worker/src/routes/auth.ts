/**
 * Auth — better-auth con adaptador D1 nativo.
 * Solo exporta createAuth(). El montaje en /api/auth/* está en index.ts.
 */
import { betterAuth } from 'better-auth'
import type { Env } from '../lib/types'

export function createAuth(env: Env) {
  return betterAuth({
    secret: env.AUTH_SECRET,

    baseURL: env.ENVIRONMENT === 'production'
      ? 'https://privatepaste.YOUR_SUBDOMAIN.workers.dev'
      : 'http://localhost:8787',

    database: {
      type: 'sqlite',
      db:   env.DB,
    },

    emailAndPassword: {
      enabled:                  true,
      requireEmailVerification: false,
      minPasswordLength:        8,
    },

    session: {
      cookieName: 'pp_session',
      expiresIn:  60 * 60 * 24 * 30,
      updateAge:  60 * 60 * 24,
    },

    trustedOrigins: ['*'],
  })
}
