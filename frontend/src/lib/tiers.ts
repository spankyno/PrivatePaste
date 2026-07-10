/**
 * Copia local de los límites de tier para el frontend.
 */

export type Tier = 'anon' | 'registered' | 'pro'

export interface TierLimits {
  maxActivePastes:    number
  maxPasteSizeBytes:  number
  maxExpiryDays:      number
  canSetNeverExpire:  boolean
  maxPastesPerDay:    number
  rateWindowMinutes:  number
  rateWindowMaxReqs:  number
  maxRequestsPerDay:  number
  cleanupStrategy:    'aggressive' | 'normal' | 'archive'
  canUsePassword:     boolean
  canUseFolders:      boolean
  canSearch:          boolean
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
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
    maxRequestsPerDay: 5_000,
    cleanupStrategy:   'normal',
    canUsePassword:    true,
    canUseFolders:     true,
    canSearch:         true,
  },
  pro: {
    maxActivePastes:   10_000,
    maxPasteSizeBytes: 10 * 1024 * 1024,
    maxExpiryDays:     0,
    canSetNeverExpire: true,
    maxPastesPerDay:   500,
    rateWindowMinutes: 15,
    rateWindowMaxReqs: 100,
    maxRequestsPerDay: 50_000,
    cleanupStrategy:   'archive',
    canUsePassword:    true,
    canUseFolders:     true,
    canSearch:         true,
  },
}

export const EXPIRY_OPTIONS = [
  { label: '1 hour',   value: '1h',    days: 1/24 },
  { label: '3 days',   value: '3d',    days: 3    },
  { label: '30 days',  value: '30d',   days: 30   },
  { label: '90 days',  value: '90d',   days: 90   },
  { label: '300 days', value: '300d',  days: 300  },
  { label: 'Never',    value: 'never', days: 0    },
] as const

export type ExpiryValue = typeof EXPIRY_OPTIONS[number]['value']

export function expiryToTimestamp(value: ExpiryValue): number | null {
  const opt = EXPIRY_OPTIONS.find(o => o.value === value)
  if (!opt || opt.days === 0) return null
  return Math.floor(Date.now() / 1000) + Math.floor(opt.days * 86400)
}
