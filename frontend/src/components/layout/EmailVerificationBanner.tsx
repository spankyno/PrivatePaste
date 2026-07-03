import { useState } from 'react'
import { Mail, Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { api, ApiError } from '@/lib/api'

/**
 * Banner persistente (sin opción de cerrar) mientras la cuenta tenga el
 * email pendiente de verificar. Se muestra en toda la app vía App.tsx,
 * justo debajo del Navbar.
 */
export function EmailVerificationBanner() {
  const { user } = useAuth()
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  if (!user || user.emailVerifiedAt) return null

  const handleResend = async () => {
    setSending(true)
    setError(null)
    try {
      await api.resendVerification()
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo reenviar el email')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2.5">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-sm text-amber-700 dark:text-amber-400">
        <Mail className="w-4 h-4 flex-shrink-0" />
        <span>
          Verifica tu email (<strong>{user.email}</strong>) para desbloquear todos los límites de tu cuenta.
        </span>
        {sent ? (
          <span className="font-medium">Correo reenviado — revisa tu bandeja de entrada.</span>
        ) : (
          <button
            onClick={handleResend}
            disabled={sending}
            className="underline font-medium hover:no-underline disabled:opacity-50 inline-flex items-center gap-1"
          >
            {sending && <Loader2 className="w-3 h-3 animate-spin" />}
            Reenviar email de verificación
          </button>
        )}
        {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </div>
  )
}
