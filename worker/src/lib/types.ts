/**
 * Cloudflare Worker environment bindings.
 */
export interface Env {
  DB: D1Database
  RATE_LIMIT_KV: KVNamespace
  ASSETS: Fetcher
  ENVIRONMENT: 'development' | 'production'
  AUTH_SECRET: string
  TURNSTILE_SECRET_KEY: string
  RESEND_API_KEY: string
  EMAIL_FROM: string
}
