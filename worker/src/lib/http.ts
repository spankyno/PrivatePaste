import type { Context } from 'hono'
import type { Env } from './types'

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/**
 * Respuesta de error estandarizada.
 *
 * El mensaje interno (excepción, stack, mensaje de SQLite/D1, etc.) SIEMPRE
 * se registra vía console.error para poder inspeccionarlo con
 * `wrangler tail` / Workers Logs, pero solo se devuelve al cliente cuando
 * `ENVIRONMENT !== 'production'`. En producción el cliente únicamente ve
 * `publicMessage`, evitando exponer detalles de implementación (queries,
 * rutas de archivo, nombres de columnas, etc.) que faciliten un ataque.
 */
export function errorResponse(
  c: Context<{ Bindings: Env }>,
  publicMessage: string,
  err: unknown,
  status = 500,
) {
  console.error(`[${c.req.method} ${c.req.path}]`, err)

  const isProd = c.env.ENVIRONMENT === 'production'
  return jsonResponse(
    {
      error: publicMessage,
      ...(isProd ? {} : { detail: err instanceof Error ? err.message : String(err) }),
    },
    status,
  )
}
