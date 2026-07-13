/**
 * Line-wrap hook — recuerda si el editor de CodeMirror debe ajustar las
 * líneas largas al ancho de la ventana (wrap) o desplazarse en horizontal
 * (scroll). Persiste en localStorage, igual que useDarkMode, y es
 * compartido entre CreatePaste y EditPaste para que la preferencia sea
 * consistente en toda la app.
 */
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'pp-editor-wrap'

function getInitialWrap(): boolean {
  if (typeof window === 'undefined') return true
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'on')  return true
  if (stored === 'off') return false
  return true // por defecto, ajustar línea (más legible para texto/prosa)
}

export function useLineWrap() {
  const [wrap, setWrap] = useState(getInitialWrap)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, wrap ? 'on' : 'off')
  }, [wrap])

  return { wrap, toggle: () => setWrap(w => !w) }
}
