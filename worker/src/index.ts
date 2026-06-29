/**
 * Tier limits — sintaxis simple compatible con Cloudflare Workers bundle.
 */

export type Tier = 'anon' | 'registered' | 'pro'

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

export const EXPIRY_OPTIONS = [
  { label: '1 hour',   value: '1h',    days: 1/24 },
  { label: '3 days',   value: '3d',    days: 3    },
  { label: '30 days',  value: '30d',   days: 30   },
  { label: '90 days',  value: '90d',   days: 90   },
  { label: '300 days', value: '300d',  days: 300  },
  { label: 'Never',    value: 'never', days: 0    },
]

export function expiryToTimestamp(value: string): number | null {
  const opt = EXPIRY_OPTIONS.find(o => o.value === value)
  if (!opt || opt.days === 0) return null
  return Math.floor(Date.now() / 1000) + Math.floor(opt.days * 86400)
}
