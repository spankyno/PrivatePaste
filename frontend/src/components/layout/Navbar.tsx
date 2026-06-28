import { Link, useNavigate } from 'react-router-dom'
import { Moon, Sun, Plus, LogIn, LogOut, User, ChevronDown, FileCode2 } from 'lucide-react'
import { useState } from 'react'
import { useDarkMode } from '@/hooks/useDarkMode'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import clsx from 'clsx'

export function Navbar() {
  const { dark, toggle }    = useDarkMode()
  const { user, tier, refetch } = useAuth()
  const navigate              = useNavigate()
  const [menuOpen, setMenu]   = useState(false)

  const handleSignOut = async () => {
    await api.signOut()
    await refetch()
    navigate('/')
    setMenu(false)
  }

  const tierBadge = tier === 'pro'
    ? <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Pro</span>
    : tier === 'registered'
    ? <span className="badge bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">Free</span>
    : null

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-sm">
      <nav className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-4">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 font-semibold text-[var(--text)] hover:opacity-80 transition-opacity mr-2">
          <FileCode2 className="w-5 h-5 text-brand-600 dark:text-brand-400" />
          <span className="hidden sm:inline">PrivatePaste</span>
        </Link>

        {/* New paste button */}
        <Link to="/" className="btn-primary text-xs sm:text-sm py-1.5 px-3">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New paste</span>
        </Link>

        <div className="flex-1" />

        {/* Theme toggle */}
        <button
          onClick={toggle}
          className="btn-ghost p-2 rounded-lg"
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Auth */}
        {user ? (
          <div className="relative">
            <button
              onClick={() => setMenu(o => !o)}
              className="flex items-center gap-2 btn-ghost py-1.5 px-2 rounded-lg"
            >
              <div className="w-7 h-7 rounded-full bg-brand-600 dark:bg-brand-500 flex items-center justify-center text-white text-xs font-semibold">
                {(user.name?.[0] ?? user.email[0])?.toUpperCase()}
              </div>
              <span className="hidden md:inline text-sm text-[var(--text-muted)] max-w-[120px] truncate">
                {user.name ?? user.email}
              </span>
              {tierBadge}
              <ChevronDown className={clsx('w-3 h-3 text-[var(--text-faint)] transition-transform', menuOpen && 'rotate-180')} />
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-52 card shadow-lg z-50 py-1 animate-fade-in"
                onMouseLeave={() => setMenu(false)}
              >
                <Link
                  to="/dashboard"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-tertiary)] transition-colors"
                  onClick={() => setMenu(false)}
                >
                  <User className="w-4 h-4 text-[var(--text-muted)]" />
                  My pastes
                </Link>
                <hr className="border-[var(--border)] my-1" />
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link to="/auth" className="btn-secondary text-xs sm:text-sm py-1.5 px-3">
            <LogIn className="w-4 h-4" />
            <span>Sign in</span>
          </Link>
        )}
      </nav>
    </header>
  )
}
