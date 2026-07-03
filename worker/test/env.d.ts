import type { D1Migration } from '@cloudflare/vitest-pool-workers/config'
import type { Env } from '../src/lib/types'

declare module 'cloudflare:test' {
  // ProvidedEnv controla el tipo de `import('cloudflare:test').env`
  interface ProvidedEnv extends Env {
    // Solo existe en tests, ver vitest.config.ts + test/apply-migrations.ts
    TEST_MIGRATIONS: D1Migration[]
  }
}
