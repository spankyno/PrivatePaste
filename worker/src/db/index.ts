/**
 * Creates a Drizzle ORM client bound to the D1 database instance.
 * Call once per request in the Hono context.
 */
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

export type DB = ReturnType<typeof createDb>

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema })
}

export * from './schema'
