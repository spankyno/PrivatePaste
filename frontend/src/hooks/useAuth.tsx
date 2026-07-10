/**
 * Auth context — provides current user + tier to the whole React tree.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type ApiUser } from '@/lib/api'

type Tier = 'anon' | 'registered' | 'pro'

interface AuthState {
  user:     ApiUser | null
  tier:     Tier
  loading:  boolean
  refetch:  () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user:    null,
  tier:    'anon',
  loading: true,
  refetch: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<ApiUser | null>(null)
  const [tier,    setTier]    = useState<Tier>('anon')
  const [loading, setLoading] = useState(true)

  const fetchSession = async () => {
    try {
      const data = await api.me()
      setUser(data.user)
      setTier(data.tier)
    } catch {
      setUser(null)
      setTier('anon')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSession() }, [])

  return (
    <AuthContext.Provider value={{ user, tier, loading, refetch: fetchSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
