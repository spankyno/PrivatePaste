/**
 * Tier limits — sintaxis simple compatible con el bundler de Cloudflare Workers.
 */

export type Tier = 'anon' | 'registered' | 'pro'

// Duración de la cuenta PRO: 1 año (365 días) desde users.updated_at.
// updated_at se actualiza manualmente al recibir el pago (marca el inicio
// del periodo PRO); no se persiste una columna aparte de expiración
// porque es un cálculo determinista a partir de ese timestamp.
export const PRO_DURATION_SECONDS = 365 * 86400

/** Timestamp unix en el que expira el PRO de una cuenta cuyo periodo empezó en `since`. */
export function getProExpiresAt(since: number): number {
  return since + PRO_DURATION_SECONDS
}

/** true si una cuenta con role='pro' cuyo periodo empezó en `since` ya debería haber caducado. */
export function isProExpired(since: number, now: number = Math.floor(Date.now() / 1000)): boolean {
  return getProExpiresAt(since) < now
}

export const TIER_LIMITS = {
  anon: {
    maxActivePastes:   10,
    maxPasteSizeBytes: 512 * 1024,
    maxExpiryDays:     3,
    canSetNeverExpire: false,
    maxPastesPerDay:   5,
    rateWindowMinutes: 15,
    rateWindowMaxReqs: 5,
    maxRequestsPerDay: 200,
    cleanupStrategy:   'aggressive',
    canUsePassword:    false,
    canUseFolders:     false,
    canSearch:         false,
  },
  registered: {
    maxActivePastes:   100,
    maxPasteSizeBytes: 2 * 1024 * 1024,
    maxExpiryDays:     90,
    canSetNeverExpire: false,
    maxPastesPerDay:   20,
    rateWindowMinutes: 15,
    rateWindowMaxReqs: 30,
    maxRequestsPerDay: 5000,
    cleanupStrategy:   'normal',
    canUsePassword:    true,
    canUseFolders:     true,
    canSearch:         true,
  },
  pro: {
    maxActivePastes:   10000,
    maxPasteSizeBytes: 10 * 1024 * 1024,
    maxExpiryDays:     0,
    canSetNeverExpire: true,
    maxPastesPerDay:   500,
    rateWindowMinutes: 15,
    rateWindowMaxReqs: 100,
    maxRequestsPerDay: 50000,
    cleanupStrategy:   'archive',
    canUsePassword:    true,
    canUseFolders:     true,
    canSearch:         true,
  },
}

export function roleToTier(role: string | null | undefined): Tier {
  if (!role) return 'anon'
  if (role === 'pro' || role === 'admin') return 'pro'
  return 'registered'
}

export type ExpiryValue = '1h' | '3d' | '30d' | '90d' | '300d' | 'never'

export const EXPIRY_OPTIONS: { label: string; value: ExpiryValue; days: number }[] = [
  { label: '1 hour',   value: '1h',    days: 1 / 24 },
  { label: '3 days',   value: '3d',    days: 3 },
  { label: '30 days',  value: '30d',   days: 30 },
  { label: '90 days',  value: '90d',   days: 90 },
  { label: '300 days', value: '300d',  days: 300 },
  { label: 'Never',    value: 'never', days: 0 },
]

export function expiryToTimestamp(value: ExpiryValue): number | null {
  const opt = EXPIRY_OPTIONS.find(o => o.value === value)
  if (!opt || opt.days === 0) return null
  return Math.floor(Date.now() / 1000) + Math.floor(opt.days * 86400)
}
