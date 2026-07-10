import path from 'node:path'
import { readD1Migrations, cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  // Las migraciones reales del proyecto (misma carpeta que usa D1 en
  // producción) se aplican sobre una base de datos D1 efímera y aislada
  // por fichero de test — no toca nunca la base de datos real.
  const migrationsPath = path.join(__dirname, '..', 'migrations')
  const migrations = await readD1Migrations(migrationsPath)

  return {
    plugins: [
      cloudflareTest({
        // Entry point del Worker. Se define explícitamente en vez de usar
        // wrangler.configPath para no depender de recursos que solo tienen
        // sentido en producción (el binding [assets] apunta a
        // frontend/dist, que puede no existir en un checkout limpio antes
        // de compilar el frontend, y los IDs reales de D1/KV).
        main: './src/index.ts',
        miniflare: {
          compatibilityDate: '2024-12-01',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['DB'],
          kvNamespaces: ['RATE_LIMIT_KV'],
          bindings: {
            ENVIRONMENT: 'development',
            AUTH_SECRET: 'test-secret-not-real',
            // Clave de prueba oficial de Turnstile — los tests mockean
            // igualmente la llamada de red, pero se deja un valor válido
            // por si algún test decide no mockearla.
            TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
            // Solo usado por test/apply-migrations.ts, no existe en producción.
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  }
})
