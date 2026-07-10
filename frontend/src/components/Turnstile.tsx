/**
 * Widget de Cloudflare Turnstile (anti-bot). Carga el script oficial de
 * forma perezosa (solo cuando este componente se monta, no en toda la
 * app) y expone el token verificado vía `onVerify`.
 */
import { useEffect, useRef, useId } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: Record<string, unknown>) => string
      remove: (widgetId: string) => void
      reset:  (widgetId: string) => void
    }
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
let scriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload  = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Turnstile'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

interface TurnstileWidgetProps {
  onVerify: (token: string) => void
  onExpire?: () => void
}

export function TurnstileWidget({ onVerify, onExpire }: TurnstileWidgetProps) {
  const containerId = useId().replace(/:/g, '')
  const widgetId     = useRef<string | null>(null)
  const siteKey      = import.meta.env.VITE_TURNSTILE_SITE_KEY

  useEffect(() => {
    if (!siteKey) {
      console.warn('[Turnstile] VITE_TURNSTILE_SITE_KEY is not set — widget disabled')
      return
    }

    let cancelled = false
    loadTurnstileScript().then(() => {
      if (cancelled || !window.turnstile) return
      widgetId.current = window.turnstile.render(`#${containerId}`, {
        sitekey: siteKey,
        callback: (token: string) => onVerify(token),
        'expired-callback': () => onExpire?.(),
      })
    }).catch(err => console.error(err))

    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey])

  if (!siteKey) return null
  return <div id={containerId} className="flex justify-center" />
}
