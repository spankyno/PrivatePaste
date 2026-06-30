/**
 * Dark mode hook — reads system preference, persists to localStorage,
 * and syncs with <html class="dark">.
 */
import { useEffect, useState } from 'react'

function getInitialDark(): boolean {
  if (typeof window === 'undefined') return false
  const stored = localStorage.getItem('pp-theme')
  if (stored === 'dark') return true
  if (stored === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function useDarkMode() {
  const [dark, setDark] = useState(getInitialDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('pp-theme', dark ? 'dark' : 'light')
  }, [dark])

  return { dark, toggle: () => setDark(d => !d) }
}
