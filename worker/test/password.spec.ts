import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, needsRehash } from '../src/lib/password'

/** Replica el algoritmo legacy (SHA-256 + salt) que hashPassword sustituyó,
 *  para poder probar la compatibilidad hacia atrás. */
async function legacyHash(password: string, salt = 'testsalt1234567'): Promise<string> {
  const data   = new TextEncoder().encode(salt + password)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const hex    = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${salt}:${hex}`
}

describe('hashPassword / verifyPassword (PBKDF2)', () => {
  it('genera un hash con el formato esperado pbkdf2-sha256$iteraciones$salt$hash', async () => {
    const hash = await hashPassword('correcthorsebatterystaple')
    const parts = hash.split('$')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('pbkdf2-sha256')
    expect(Number(parts[1])).toBeGreaterThan(0)
  })

  it('la misma contraseña genera hashes distintos (salt aleatorio)', async () => {
    const a = await hashPassword('samepassword')
    const b = await hashPassword('samepassword')
    expect(a).not.toBe(b)
  })

  it('verifica correctamente la contraseña correcta', async () => {
    const hash = await hashPassword('correcthorsebatterystaple')
    await expect(verifyPassword('correcthorsebatterystaple', hash)).resolves.toBe(true)
  })

  it('rechaza una contraseña incorrecta', async () => {
    const hash = await hashPassword('correcthorsebatterystaple')
    await expect(verifyPassword('wrongpassword', hash)).resolves.toBe(false)
  })

  it('acepta un número de iteraciones distinto al por defecto', async () => {
    const hash = await hashPassword('mypassword', 50_000)
    expect(hash.split('$')[1]).toBe('50000')
    await expect(verifyPassword('mypassword', hash)).resolves.toBe(true)
  })
})

describe('verifyPassword — compatibilidad con el formato legacy (SHA-256 + salt)', () => {
  it('verifica correctamente un hash legacy con la contraseña correcta', async () => {
    const legacy = await legacyHash('oldpassword')
    await expect(verifyPassword('oldpassword', legacy)).resolves.toBe(true)
  })

  it('rechaza un hash legacy con la contraseña incorrecta', async () => {
    const legacy = await legacyHash('oldpassword')
    await expect(verifyPassword('wrongpassword', legacy)).resolves.toBe(false)
  })
})

describe('verifyPassword — entradas inválidas', () => {
  it('devuelve false si el hash almacenado está vacío', async () => {
    await expect(verifyPassword('anything', '')).resolves.toBe(false)
  })

  it('devuelve false para un formato legacy malformado (sin ":")', async () => {
    await expect(verifyPassword('anything', 'nocolonhere')).resolves.toBe(false)
  })

  it('devuelve false para un formato pbkdf2 con campos incompletos', async () => {
    await expect(verifyPassword('anything', 'pbkdf2-sha256$100000')).resolves.toBe(false)
  })
})

describe('needsRehash', () => {
  it('devuelve true para un hash en formato legacy', async () => {
    const legacy = await legacyHash('oldpassword')
    expect(needsRehash(legacy)).toBe(true)
  })

  it('devuelve false para un hash PBKDF2 recién generado con las iteraciones por defecto', async () => {
    const hash = await hashPassword('mypassword')
    expect(needsRehash(hash)).toBe(false)
  })

  it('devuelve true si las iteraciones almacenadas son menores que las solicitadas', async () => {
    const hash = await hashPassword('mypassword', 10_000)
    expect(needsRehash(hash, 100_000)).toBe(true)
  })
})
