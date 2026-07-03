import { describe, it, expect } from 'vitest'
import {
  roleToTier, getProExpiresAt, isProExpired, PRO_DURATION_SECONDS,
  expiryToTimestamp, EXPIRY_OPTIONS, TIER_LIMITS,
} from '../src/lib/tiers'

describe('roleToTier', () => {
  it('null o undefined es anon', () => {
    expect(roleToTier(null)).toBe('anon')
    expect(roleToTier(undefined)).toBe('anon')
  })

  it("'pro' es tier pro", () => {
    expect(roleToTier('pro')).toBe('pro')
  })

  it("'admin' también es tier pro (mismos límites)", () => {
    expect(roleToTier('admin')).toBe('pro')
  })

  it("'registered' es tier registered", () => {
    expect(roleToTier('registered')).toBe('registered')
  })

  it('cualquier otro valor cae a registered (fail-safe, no a anon ni pro)', () => {
    expect(roleToTier('unexpected-role')).toBe('registered')
  })
})

describe('getProExpiresAt / isProExpired', () => {
  it('getProExpiresAt suma exactamente 365 días en segundos', () => {
    const since = 1_700_000_000
    expect(getProExpiresAt(since)).toBe(since + PRO_DURATION_SECONDS)
    expect(PRO_DURATION_SECONDS).toBe(365 * 86400)
  })

  it('isProExpired es true cuando "now" es posterior a la fecha de expiración', () => {
    const since = 1_700_000_000
    const justAfterExpiry = getProExpiresAt(since) + 1
    expect(isProExpired(since, justAfterExpiry)).toBe(true)
  })

  it('isProExpired es false cuando "now" es anterior a la fecha de expiración', () => {
    const since = 1_700_000_000
    const justBeforeExpiry = getProExpiresAt(since) - 1
    expect(isProExpired(since, justBeforeExpiry)).toBe(false)
  })

  it('isProExpired usa Date.now() por defecto si no se pasa "now"', () => {
    const oneYearAndADayAgo = Math.floor(Date.now() / 1000) - PRO_DURATION_SECONDS - 86400
    expect(isProExpired(oneYearAndADayAgo)).toBe(true)
  })
})

describe('expiryToTimestamp', () => {
  it("'never' devuelve null (sin caducidad)", () => {
    expect(expiryToTimestamp('never')).toBeNull()
  })

  it("un valor no reconocido devuelve null", () => {
    // @ts-expect-error -- probamos deliberadamente un valor fuera del enum
    expect(expiryToTimestamp('bogus')).toBeNull()
  })

  it("'1h' añade aproximadamente 3600 segundos a la hora actual", () => {
    const before = Math.floor(Date.now() / 1000)
    const result = expiryToTimestamp('1h')
    const after  = Math.floor(Date.now() / 1000)
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThanOrEqual(before + 3600)
    expect(result!).toBeLessThanOrEqual(after + 3600 + 1)
  })

  it("'30d' añade 30 días exactos (en segundos) a la hora actual", () => {
    const before = Math.floor(Date.now() / 1000)
    const result = expiryToTimestamp('30d')
    expect(result).not.toBeNull()
    expect(result! - before).toBeGreaterThanOrEqual(30 * 86400 - 1)
    expect(result! - before).toBeLessThanOrEqual(30 * 86400 + 1)
  })

  it('EXPIRY_OPTIONS contiene las seis opciones esperadas', () => {
    expect(EXPIRY_OPTIONS.map(o => o.value)).toEqual(['1h', '3d', '30d', '90d', '300d', 'never'])
  })
})

describe('TIER_LIMITS — invariantes entre tiers', () => {
  it('los límites crecen de anon a registered a pro (nunca al revés)', () => {
    expect(TIER_LIMITS.registered.maxActivePastes).toBeGreaterThan(TIER_LIMITS.anon.maxActivePastes)
    expect(TIER_LIMITS.pro.maxActivePastes).toBeGreaterThan(TIER_LIMITS.registered.maxActivePastes)

    expect(TIER_LIMITS.registered.maxPasteSizeBytes).toBeGreaterThan(TIER_LIMITS.anon.maxPasteSizeBytes)
    expect(TIER_LIMITS.pro.maxPasteSizeBytes).toBeGreaterThan(TIER_LIMITS.registered.maxPasteSizeBytes)
  })

  it('solo anon tiene deshabilitadas contraseña, carpetas y búsqueda', () => {
    expect(TIER_LIMITS.anon.canUsePassword).toBe(false)
    expect(TIER_LIMITS.anon.canUseFolders).toBe(false)
    expect(TIER_LIMITS.anon.canSearch).toBe(false)

    for (const tier of [TIER_LIMITS.registered, TIER_LIMITS.pro]) {
      expect(tier.canUsePassword).toBe(true)
      expect(tier.canUseFolders).toBe(true)
      expect(tier.canSearch).toBe(true)
    }
  })

  it('solo pro puede establecer pastes que nunca caduquen', () => {
    expect(TIER_LIMITS.anon.canSetNeverExpire).toBe(false)
    expect(TIER_LIMITS.registered.canSetNeverExpire).toBe(false)
    expect(TIER_LIMITS.pro.canSetNeverExpire).toBe(true)
  })
})
