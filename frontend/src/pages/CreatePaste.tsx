/**
 * CreatePaste page — the main editor.
 * Accessible to all tiers; options adapt based on auth state.
 */
import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactCodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { Lock, Eye, EyeOff, Globe, Clock, FolderOpen, Loader2, Copy, Check } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useDarkMode } from '@/hooks/useDarkMode'
import { api, type PastePayload, type Folder } from '@/lib/api'
import { LANGUAGES, getLanguage } from '@/lib/languages'
import { TIER_LIMITS, EXPIRY_OPTIONS } from '@/lib/tiers'
import clsx from 'clsx'

// Re-export tier limits for frontend use (same constants, no duplication)
// In a monorepo this is clean — both import from the same source file.

type Visibility = 'public' | 'private' | 'password'

export function CreatePastePage() {
  const { user, tier }  = useAuth()
  const { dark }        = useDarkMode()
  const navigate        = useNavigate()
  const limits          = TIER_LIMITS[tier]

  // Form state
  const [title,      setTitle]      = useState('')
  const [content,    setContent]    = useState('')
  const [language,   setLanguage]   = useState('plaintext')
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [password,   setPassword]   = useState('')
  const [expiry,     setExpiry]     = useState<string>(tier === 'anon' ? '3d' : '30d')
  const [folderId,   setFolderId]   = useState<string>('')
  const [folders,    setFolders]    = useState<Folder[]>([])

  // UI state
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [langExt,    setLangExt]    = useState<any>([])

  // Cargar carpetas si el usuario puede usarlas
  useEffect(() => {
    if (user && limits.canUseFolders) {
      api.listFolders().then(r => setFolders(r.folders)).catch(() => {})
    }
  }, [user, limits.canUseFolders])

  // Load language extension when selected
  const handleLangChange = useCallback(async (id: string) => {
    setLanguage(id)
    const lang = getLanguage(id)
    const ext  = await lang.load()
    setLangExt([ext])
  }, [])

  // Filter expiry options by tier
  const availableExpiry = EXPIRY_OPTIONS.filter(opt => {
    if (opt.value === 'never') return limits.canSetNeverExpire
    if (tier === 'anon')       return opt.days <= 3
    return true
  })

  const handleSubmit = async () => {
    if (!content.trim()) { setError('Paste content cannot be empty'); return }
    if (visibility === 'password' && !password) { setError('Enter a password for protected pastes'); return }

    setLoading(true)
    setError(null)

    const payload: PastePayload = {
      title:      title || 'Untitled',
      content,
      language,
      visibility: user ? visibility : 'public',
      expiry:     expiry as PastePayload['expiry'],
      ...(folderId ? { folderId } : {}),
    }
    if (visibility === 'password' && password) payload.password = password

    try {
      const { id } = await api.createPaste(payload)
      navigate(`/p/${id}`)
    } catch (err: any) {
      setError(err.message ?? 'Failed to create paste')
      setLoading(false)
    }
  }

  const visibilityOptions: Array<{ value: Visibility; label: string; icon: React.ReactNode; disabled?: boolean }> = [
    { value: 'public',   label: 'Public',   icon: <Globe   className="w-4 h-4" /> },
    { value: 'private',  label: 'Private',  icon: <EyeOff  className="w-4 h-4" />, disabled: !user },
    { value: 'password', label: 'Password', icon: <Lock    className="w-4 h-4" />, disabled: !limits.canUsePassword },
  ]

  const charCount  = content.length
  const bytesUsed  = new TextEncoder().encode(content).length
  const bytesLimit = limits.maxPasteSizeBytes
  const overLimit  = bytesUsed > bytesLimit

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-4">
      {/* Title bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <input
          type="text"
          placeholder="Paste title (optional)"
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={255}
          className="input flex-1 text-base"
        />

        {/* Language selector */}
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
          placeholder="Paste your code or text here…"
          style={{ flex: 1, fontSize: 14 }}
          basicSetup={{
            lineNumbers:     true,
            highlightActiveLine: true,
            foldGutter:      true,
            autocompletion:  false,
          }}
        />

        {/* Editor footer */}
        <div className="px-3 py-1.5 border-t border-[var(--border)] bg-[var(--bg-secondary)] flex items-center justify-between">
          <span className="text-xs text-[var(--text-faint)]">
            {charCount.toLocaleString()} chars
          </span>
          <span className={clsx(
            'text-xs font-mono',
            overLimit ? 'text-red-500' : 'text-[var(--text-faint)]'
          )}>
            {formatBytes(bytesUsed)} / {formatBytes(bytesLimit)}
          </span>
        </div>
      </div>

      {/* Options row */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* Visibility */}
        {user && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide">Visibility</label>
            <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
              {visibilityOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => !opt.disabled && setVisibility(opt.value)}
                  disabled={opt.disabled}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-2 text-sm transition-colors',
                    opt.disabled && 'opacity-40 cursor-not-allowed',
                    visibility === opt.value
                      ? 'bg-brand-600 dark:bg-brand-500 text-white'
                      : 'bg-[var(--bg)] text-[var(--text-muted)] hover:bg-[var(--bg-secondary)]',
                  )}
                  title={opt.disabled ? 'Requires an account' : undefined}
                >
                  {opt.icon}
                  <span className="hidden sm:inline">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Password field */}
        {visibility === 'password' && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide">Password</label>
            <input
              type="password"
              placeholder="Set a password…"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input w-48"
            />
          </div>
        )}

        {/* Expiry */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide flex items-center gap-1">
            <Clock className="w-3 h-3" /> Expiry
          </label>
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

        {/* Folder selector — solo para usuarios con carpetas */}
        {user && limits.canUseFolders && folders.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide flex items-center gap-1">
              <FolderOpen className="w-3 h-3" /> Folder
            </label>
            <select
              value={folderId}
              onChange={e => setFolderId(e.target.value)}
              className="input w-44 text-sm"
            >
              <option value="">No folder</option>
              {folders.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex-1" />

        {/* Submit */}
        <div className="flex items-center gap-3">
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            onClick={handleSubmit}
            disabled={loading || overLimit || !content.trim()}
            className={clsx(
              'btn-primary px-6 py-2.5 text-sm font-semibold',
              (loading || overLimit || !content.trim()) && 'opacity-50 cursor-not-allowed'
            )}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {loading ? 'Creating…' : 'Create paste'}
          </button>
        </div>
      </div>

      {/* Anon notice */}
      {!user && (
        <p className="text-xs text-[var(--text-faint)] text-center">
          Creating as anonymous — max 10 active pastes, expires in 3 days.{' '}
          <a href="/auth" className="text-brand-600 dark:text-brand-400 hover:underline">Sign in</a> for more features.
        </p>
      )}
    </div>
  )
}

function formatBytes(b: number): string {
  if (b < 1024)        return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}
