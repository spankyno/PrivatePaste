/**
 * Tier-based limits for PrivatePaste.
 * Single source of truth — used by middleware and frontend.
 */

export type Tier = 'anon' | 'registered' | 'pro'

export interface TierLimits {
  maxActivePastes:      number    // max concurrent active pastes
  maxPasteSizeBytes:    number    // max content size per paste
  maxExpiryDays:        number    // max expiry in days (0 = never allowed for non-pro)
  canSetNeverExpire:    boolean
  maxPastesPerDay:      number    // daily creation limit
  rateWindowMinutes:    number    // rolling window for API rate limit
  rateWindowMaxReqs:    number    // max POST /pastes in that window
  maxRequestsPerDay:    number    // total daily request budget
  cleanupStrategy:      'aggressive' | 'normal' | 'archive'
  canUsePassword:       boolean
  canUseFolders:        boolean
  canSearch:            boolean
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  anon: {
    maxActivePastes:   10,
    maxPasteSizeBytes: 512 * 1024,   // 512 KB
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
    maxPasteSizeBytes: 2 * 1024 * 1024,   // 2 MB
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
    maxPasteSizeBytes: 10 * 1024 * 1024,  // 10 MB
    maxExpiryDays:     0,                 // unlimited
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

/** Map user role to tier */
export function roleToTier(role: 'registered' | 'pro' | 'admin' | null | undefined): Tier {
  if (!role) return 'anon'
  if (role === 'pro' || role === 'admin') return 'pro'
  return 'registered'
}

/** Default expiry options per tier */
export const EXPIRY_OPTIONS = [
  { label: '1 hour',    value: '1h',   days: 1/24 },
  { label: '3 days',    value: '3d',   days: 3 },
  { label: '30 days',   value: '30d',  days: 30 },
  { label: '90 days',   value: '90d',  days: 90 },
  { label: '300 days',  value: '300d', days: 300 },
  { label: 'Never',     value: 'never',days: 0 },   // pro only
] as const

export type ExpiryValue = typeof EXPIRY_OPTIONS[number]['value']

/** Convert expiry value to unix timestamp (seconds), or null for never */
export function expiryToTimestamp(value: ExpiryValue): number | null {
  const opt = EXPIRY_OPTIONS.find(o => o.value === value)
  if (!opt || opt.days === 0) return null
  return Math.floor(Date.now() / 1000) + Math.floor(opt.days * 86400)
}
