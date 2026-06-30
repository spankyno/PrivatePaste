/**
 * Auth page — sign in / sign up with email + password.
 */
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Loader2, FileCode2 } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'

type Mode = 'signin' | 'signup'

export function AuthPage() {
  const navigate    = useNavigate()
  const { refetch } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [name,     setName]     = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (mode === 'signup') {
        await api.signUp(email, password, name || undefined)
      } else {
        await api.signIn(email, password)
      }
      await refetch()
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-[var(--text)]">
            <FileCode2 className="w-8 h-8 text-brand-600 dark:text-brand-400" />
            <span className="text-xl font-semibold">PrivatePaste</span>
          </Link>
        </div>

        <div className="card p-6 shadow-sm animate-slide-up">
          {/* Tab switcher */}
          <div className="flex rounded-lg bg-[var(--bg-tertiary)] p-1 mb-6">
            {(['signin', 'signup'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null) }}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
                  mode === m
                    ? 'bg-[var(--bg)] text-[var(--text)] shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === 'signup' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[var(--text-muted)]">Name (optional)</label>
                <input
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="input"
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--text-muted)]">Email</label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                className="input"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--text-muted)]">Password</label>
              <input
                type="password"
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={mode === 'signup' ? 8 : undefined}
                className="input"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary justify-center py-2.5 mt-1"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading
                ? (mode === 'signin' ? 'Signing in…' : 'Creating account…')
                : (mode === 'signin' ? 'Sign in' : 'Create account')}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[var(--text-faint)] mt-4">
          No credit card required · Free tier includes 100 pastes
        </p>
      </div>
    </div>
  )
}
