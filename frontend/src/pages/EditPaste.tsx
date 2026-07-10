/**
 * EditPaste page — edición completa de un paste existente.
 * Solo accesible para el propietario del paste.
 */
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import ReactCodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { Loader2, Save, X, ArrowLeft } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useDarkMode } from '@/hooks/useDarkMode'
import { api, type Paste, ApiError } from '@/lib/api'
import { LANGUAGES, getLanguage } from '@/lib/languages'
import { TIER_LIMITS, EXPIRY_OPTIONS } from '@/lib/tiers'
import clsx from 'clsx'

type Visibility = 'public' | 'private' | 'password'

export function EditPastePage() {
  const { id }          = useParams<{ id: string }>()
  const { user, tier }  = useAuth()
  const { dark }        = useDarkMode()
  const navigate        = useNavigate()
  const limits          = TIER_LIMITS[tier]

  const [original,   setOriginal]   = useState<Paste | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [notAllowed, setNotAllowed] = useState(false)

  // Form state — inicializado desde el paste original
  const [title,      setTitle]      = useState('')
  const [content,    setContent]    = useState('')
  const [language,   setLanguage]   = useState('plaintext')
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [password,   setPassword]   = useState('')
  const [expiry,     setExpiry]     = useState('30d')
  const [langExt,    setLangExt]    = useState<any>([])

  // Cargar paste original
  useEffect(() => {
    if (!id) return
    api.getPaste(id)
      .then(async (paste) => {
        // Solo el propietario puede editar
        if (paste.userId !== user?.id) {
          setNotAllowed(true)
          return
        }
        setOriginal(paste)
        setTitle(paste.title)
        setContent(paste.content ?? '')
        setLanguage(paste.language)
        setVisibility(paste.visibility as Visibility)

        // Cargar extensión de lenguaje
        if (paste.language !== 'plaintext') {
          const lang = getLanguage(paste.language)
          const ext  = await lang.load()
          setLangExt([ext])
        }

        // Calcular expiry aproximado desde expiresAt
        if (!paste.expiresAt) {
          setExpiry('never')
        } else {
          const remainingDays = (paste.expiresAt - Math.floor(Date.now() / 1000)) / 86400
          if      (remainingDays <= 1)   setExpiry('1h')
          else if (remainingDays <= 3)   setExpiry('3d')
          else if (remainingDays <= 30)  setExpiry('30d')
          else if (remainingDays <= 90)  setExpiry('90d')
          else                           setExpiry('300d')
        }
      })
      .catch((err: ApiError) => {
        setError(err.message ?? 'Failed to load paste')
      })
      .finally(() => setLoading(false))
  }, [id, user?.id])

  const handleLangChange = useCallback(async (langId: string) => {
    setLanguage(langId)
    const lang = getLanguage(langId)
    const ext  = await lang.load()
    setLangExt([ext])
  }, [])

  const handleSave = async () => {
    if (!id || !content.trim()) { setError('Content cannot be empty'); return }
    if (visibility === 'password' && !original?.hasPassword && !password) {
      setError('Enter a password for protected pastes')
      return
    }

    setSaving(true)
    setError(null)

    try {
      await api.updatePaste(id, {
        title:      title || 'Untitled',
        content,
        language,
        visibility,
        expiry,
        ...(visibility === 'password' && password ? { password } : {}),
      })
      navigate(`/p/${id}`)
    } catch (err: any) {
      setError(err.message ?? 'Failed to save paste')
      setSaving(false)
    }
  }

  const bytesUsed  = new TextEncoder().encode(content).length
  const overLimit  = bytesUsed > limits.maxPasteSizeBytes

  const availableExpiry = EXPIRY_OPTIONS.filter(opt => {
    if (opt.value === 'never') return limits.canSetNeverExpire
    if (tier === 'anon')       return opt.days <= 3
    return true
  })

  const visibilityOptions = [
    { value: 'public'   as Visibility, label: 'Public',   disabled: false },
    { value: 'private'  as Visibility, label: 'Private',  disabled: !user },
    { value: 'password' as Visibility, label: 'Password', disabled: !limits.canUsePassword },
  ]

  if (loading) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
    </div>
  )

  if (notAllowed) return (
    <div className="max-w-2xl mx-auto px-4 py-20 text-center">
      <p className="text-4xl mb-4">🔒</p>
      <h1 className="text-xl font-semibold mb-2">Not your paste</h1>
      <p className="text-[var(--text-muted)] mb-6">You can only edit pastes you created.</p>
      <Link to="/dashboard" className="btn-primary">Go to dashboard</Link>
    </div>
  )

  if (error && !original) return (
    <div className="max-w-2xl mx-auto px-4 py-20 text-center">
      <p className="text-[var(--text-muted)] mb-6">{error}</p>
      <Link to="/" className="btn-primary">Go home</Link>
    </div>
  )

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to={`/p/${id}`} className="btn-ghost p-2 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-base font-semibold text-[var(--text-muted)]">
          Editing <span className="text-[var(--text)]">{original?.title}</span>
        </h1>
      </div>

      {/* Title + language */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <input
          type="text"
          placeholder="Paste title (optional)"
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={255}
          className="input flex-1 text-base"
        />
        <select
          value={language}
          onChange={e => handleLangChange(e.target.value)}
          className="input sm:w-44 text-sm"
        >
          {LANGUAGES.map(l => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
      </div>

      {/* Editor */}
      <div className={clsx(
        'rounded-xl border overflow-hidden flex flex-col',
        overLimit ? 'border-red-400 dark:border-red-600' : 'border-[var(--border)]'
      )} style={{ minHeight: 420 }}>
        <ReactCodeMirror
          value={content}
          onChange={setContent}
          extensions={langExt}
          theme={dark ? oneDark : undefined}
          placeholder="Paste content…"
          style={{ flex: 1, fontSize: 14 }}
          basicSetup={{ lineNumbers: true, highlightActiveLine: true, foldGutter: true, autocompletion: false }}
        />
        <div className="px-3 py-1.5 border-t border-[var(--border)] bg-[var(--bg-secondary)] flex items-center justify-between">
          <span className="text-xs text-[var(--text-faint)]">{content.length.toLocaleString()} chars</span>
          <span className={clsx('text-xs font-mono', overLimit ? 'text-red-500' : 'text-[var(--text-faint)]')}>
            {formatBytes(bytesUsed)} / {formatBytes(limits.maxPasteSizeBytes)}
          </span>
        </div>
      </div>

      {/* Options */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* Visibility */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide">Visibility</label>
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
            {visibilityOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => !opt.disabled && setVisibility(opt.value)}
                disabled={opt.disabled}
                className={clsx(
                  'px-3 py-2 text-sm transition-colors',
                  opt.disabled && 'opacity-40 cursor-not-allowed',
                  visibility === opt.value
                    ? 'bg-brand-600 dark:bg-brand-500 text-white'
                    : 'bg-[var(--bg)] text-[var(--text-muted)] hover:bg-[var(--bg-secondary)]',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Password */}
        {visibility === 'password' && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide">
              {original?.hasPassword ? 'New password (leave blank to keep current)' : 'Password'}
            </label>
            <input
              type="password"
              placeholder={original?.hasPassword ? 'Keep current password' : 'Set a password…'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input w-56"
            />
          </div>
        )}

        {/* Expiry */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide">Expiry</label>
          <select
            value={expiry}
            onChange={e => setExpiry(e.target.value)}
            className="input w-36 text-sm"
          >
            {availableExpiry.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="flex-1" />

        {/* Actions */}
        <div className="flex items-center gap-3">
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <Link to={`/p/${id}`} className="btn-secondary">
            <X className="w-4 h-4" /> Cancel
          </Link>
          <button
            onClick={handleSave}
            disabled={saving || overLimit || !content.trim()}
            className={clsx(
              'btn-primary px-6 py-2.5 text-sm font-semibold',
              (saving || overLimit || !content.trim()) && 'opacity-50 cursor-not-allowed'
            )}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatBytes(b: number): string {
  if (b < 1024)         return `${b} B`
  if (b < 1024 * 1024)  return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}
