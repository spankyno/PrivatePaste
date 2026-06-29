/**
 * Auth — better-auth con adaptador D1 nativo.
 * Los nombres de tabla se mapean explícitamente para coincidir
 * con el schema SQL que creamos en D1.
 */
import { betterAuth } from 'better-auth'
import type { Env } from '../lib/types'

export function createAuth(env: Env) {
  return betterAuth({
    secret: env.AUTH_SECRET,

    baseURL: env.ENVIRONMENT === 'production'
      ? 'https://privatepaste-production.kbo1.workers.dev'
      : 'http://localhost:8787',

    database: {
      type: 'sqlite',
      db:   env.DB,
    },

    // Mapear nombres de tabla a los que creamos en la migración SQL
    // better-auth usa singular por defecto (user, session, account)
    // nosotros creamos plural (users, sessions, accounts)
    user: {
      modelName: 'users',
    },
    session: {
      modelName:  'sessions',
      cookieName: 'pp_session',
      expiresIn:  60 * 60 * 24 * 30,  // 30 días
      updateAge:  60 * 60 * 24,
    },
    account: {
      modelName: 'accounts',
    },
    verification: {
      modelName: 'verifications',
    },

    emailAndPassword: {
      enabled:                  true,
      requireEmailVerification: false,
      minPasswordLength:        8,
    },

    trustedOrigins: ['*'],
  })
}
