/**
 * Hashing de contraseñas con PBKDF2-HMAC-SHA256, usando exclusivamente
 * Web Crypto API (crypto.subtle), disponible de forma nativa en el
 * runtime de Cloudflare Workers. Sin dependencias externas.
 *
 * Formato de salida:
 *   pbkdf2-sha256$<iteraciones>$<salt en base64>$<hash en base64>
 *
 * Se mantiene compatibilidad hacia atrás con el formato antiguo
 * "salt:hashHex" (SHA-256 simple + salt) para no invalidar las
 * contraseñas/hashes ya almacenados en D1. Al hacer login con éxito
 * sobre un hash antiguo, el caller puede (opcionalmente) volver a
 * hashear la contraseña con el nuevo esquema — ver `needsRehash`.
 */

const ALGO = 'pbkdf2-sha256'
const DEFAULT_ITERATIONS = 100_000 // ajustar según el presupuesto de CPU del plan de Workers

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256, // 32 bytes de salida
  )
}

/** Genera un hash nuevo (formato PBKDF2) para guardar en base de datos. */
export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const derived = await pbkdf2(password, salt, iterations)
  return `${ALGO}$${iterations}$${toBase64(salt.buffer as ArrayBuffer)}$${toBase64(derived)}`
}

/** Verificación del formato legacy: `${salt}:${sha256Hex}` (salt en texto plano). */
async function verifyLegacySha256(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const data = new TextEncoder().encode(salt + password)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return timingSafeEqualHex(toHex(digest), hash)
}

/** Comparación en tiempo constante para strings hex/base64 de igual longitud esperada. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Verifica una contraseña contra un hash almacenado, soportando tanto
 * el formato nuevo (PBKDF2) como el antiguo (SHA-256 + salt) para no
 * romper las cuentas/pastes ya existentes.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) return false

  if (stored.startsWith(`${ALGO}$`)) {
    const [, iterationsStr, saltB64, hashB64] = stored.split('$')
    const iterations = Number(iterationsStr)
    if (!iterations || !saltB64 || !hashB64) return false
    const salt = fromBase64(saltB64)
    const derived = await pbkdf2(password, salt, iterations)
    return timingSafeEqualHex(toBase64(derived), hashB64)
  }

  // Formato legacy: "<salt>:<sha256Hex>"
  return verifyLegacySha256(password, stored)
}

/** Indica si un hash almacenado debería regenerarse (formato antiguo o iteraciones bajas). */
export function needsRehash(stored: string, iterations: number = DEFAULT_ITERATIONS): boolean {
  if (!stored.startsWith(`${ALGO}$`)) return true // formato legacy SHA-256
  const [, iterationsStr] = stored.split('$')
  return Number(iterationsStr) < iterations
}
