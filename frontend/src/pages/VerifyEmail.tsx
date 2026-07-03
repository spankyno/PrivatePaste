/**
 * Verify email page — /verify-email?token=...
 * A esta página apunta el enlace del correo de verificación enviado por
 * el backend (Resend). Consume el token contra la API y muestra el
 * resultado.
 */
import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { CheckCircle2, XCircle, Loader2, FileCode2 } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentHead } from '@/hooks/useDocumentHead'

type Status = 'verifying' | 'success' | 'error'

export function VerifyEmailPage() {
  useDocumentHead({ title: 'Verificar email', noindex: true })
  const [searchParams] = useSearchParams()
  const { refetch } = useAuth()
  const [status,  setStatus]  = useState<Status>('verifying')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) {
      setStatus('error')
      setMessage('Falta el token de verificación en el enlace.')
      return
    }

    api.verifyEmail(token)
      .then(() => {
        setStatus('success')
        refetch() // refresca el user en memoria (emailVerifiedAt) sin recargar
      })
      .catch((err) => {
        setStatus('error')
        setMessage(err instanceof ApiError ? err.message : 'No se pudo verificar el email.')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 mb-6">
          <FileCode2 className="w-8 h-8 text-brand-600" />
          <h1 className="text-xl font-semibold">PrivatePaste</h1>
        </div>

        <div className="card p-6 shadow-sm animate-slide-up flex flex-col items-center gap-4 text-center">
          {status === 'verifying' && (
            <>
              <Loader2 className="w-10 h-10 text-brand-600 animate-spin" />
              <p className="text-sm text-[var(--text-muted)]">Verificando tu email…</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle2 className="w-10 h-10 text-green-500" />
              <div>
                <p className="font-medium">¡Email verificado!</p>
                <p className="text-sm text-[var(--text-muted)] mt-1">Ya tienes acceso completo a tu cuenta.</p>
              </div>
              <Link to="/dashboard" className="btn-primary w-full justify-center">Ir a mi dashboard</Link>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="w-10 h-10 text-red-500" />
              <div>
                <p className="font-medium">No se pudo verificar</p>
                <p className="text-sm text-[var(--text-muted)] mt-1">{message}</p>
              </div>
              <p className="text-xs text-[var(--text-faint)]">
                El enlace pudo caducar (24h) o ya haberse usado. Puedes pedir uno nuevo desde tu dashboard.
              </p>
              <Link to="/dashboard" className="btn-secondary w-full justify-center">Ir a mi dashboard</Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
