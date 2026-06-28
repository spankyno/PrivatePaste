/**
 * Cloudflare Worker environment bindings.
 * Must match wrangler.toml [vars] and bindings.
 */
export interface Env {
  // D1 database
  DB: D1Database

  // KV namespace for rate limiting
  RATE_LIMIT_KV: KVNamespace

  // Static assets (for SPA fallback)
  ASSETS: Fetcher

  // Environment
  ENVIRONMENT: 'development' | 'production'

  // Auth secret (set via `wrangler secret put AUTH_SECRET`)
  AUTH_SECRET: string
}
