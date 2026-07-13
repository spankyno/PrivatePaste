/**
 * ViewPaste page — displays a paste with syntax highlighting.
 * Handles: public, private (owner only), password-protected (unlock modal).
 */
import { useEffect, useState, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import ReactCodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { Copy, Check, ExternalLink, Trash2, Clock, Eye, Lock, Globe, EyeOff, Loader2, Pencil, Save, X, WrapText } from 'lucide-react'
import { useDarkMode } from '@/hooks/useDarkMode'
import { useAuth } from '@/hooks/useAuth'
import { useLineWrap } from '@/hooks/useLineWrap'
import { useDocumentHead } from '@/hooks/useDocumentHead'
import { api, type Paste, ApiError } from '@/lib/api'
import { getLanguage } from '@/lib/languages'
import { formatDistanceToNow, fromUnixTime } from 'date-fns'
import clsx from 'clsx'

export function ViewPastePage() {
  const { id }         = useParams<{ id: string }>()
  const { dark }       = useDarkMode()
  const { wrap, toggle: toggleWrap } = useLineWrap()
  const { user }       = useAuth()
  const navigate       = useNavigate()

  const [paste,       setPaste]       = useState<Paste | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [langExt,     setLangExt]     = useState<any>([])
  const [copied,      setCopied]      = useState(false)
  const [deleting,    setDeleting]    = useState(false)

  // Edit state
  const [editing,     setEditing]     = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving,      setSaving]      = useState(false)
  const [saveError,   setSaveError]   = useState<string | null>(null)

  // Contenido de terceros/privado — nunca debe indexarse en buscadores,
  // más allá de que robots.txt ya lo desaconseje para los crawlers que
  // lo respeten.
  useDocumentHead({ title: paste?.title || 'Ver paste', noindex: true })

  // Password unlock state
  const [locked,      setLocked]      = useState(false)
  const [pwInput,     setPwInput]     = useState('')
  const [pwError,     setPwError]     = useState<string | null>(null)
  const [unlocking,   setUnlocking]   = useState(false)

  // Fetch paste
  useEffect(() => {
    if (!id) return
    api.getPaste(id)
      .then(async (p) => {
        if (p.locked) {
          setLocked(true)
          setPaste(p)
        } else {
          setPaste(p)
          if (p.language !== 'plaintext') {
            const lang = getLanguage(p.language)
            const ext  = await lang.load()
            setLangExt([ext])
          }
        }
      })
      .catch((err: ApiError) => {
        setError(err.message ?? 'Failed to load paste')
      })
      .finally(() => setLoading(false))
  }, [id])

  const handleUnlock = async () => {
    if (!id || !pwInput) return
    setUnlocking(true)
    setPwError(null)
    try {
      const p = await api.unlockPaste(id, pwInput)
      setPaste(p)
      setLocked(false)
      if (p.language !== 'plaintext') {
        const lang = getLanguage(p.language)
        const ext  = await lang.load()
        setLangExt([ext])
      }
    } catch (err: any) {
      setPwError(err.message ?? 'Incorrect password')
    } finally {
      setUnlocking(false)
    }
  }

  const handleCopy = async () => {
    if (!paste?.content) return
    await navigator.clipboard.writeText(paste.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDelete = async () => {
    if (!id || !confirm('Delete this paste?')) return
    setDeleting(true)
    try {
      await api.deletePaste(id)
      navigate('/')
    } catch (err: any) {
      alert(err.message)
      setDeleting(false)
    }
  }

  const handleEditStart = () => {
    if (!paste) return
    setEditContent(paste.content ?? '')
    setSaveError(null)
    setEditing(true)
  }

  const handleEditCancel = () => {
    setEditing(false)
    setSaveError(null)
  }

  const handleEditSave = async () => {
    if (!id) return
    if (!editContent.trim()) {
      setSaveError('Content cannot be empty')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await api.updatePaste(id, { content: editContent })
      setPaste(updated)
      setEditing(false)
    } catch (err: any) {
      setSaveError(err.message ?? 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  // Extensiones de CodeMirror: la del lenguaje + wrap condicional. Se
  // calcula siempre (antes de los `return` condicionales de loading/error/
  // locked) porque es un hook y debe llamarse en el mismo orden en cada
  // render.
  const editorExtensions = useMemo(
    () => [...langExt, ...(wrap ? [EditorView.lineWrapping] : [])],
    [langExt, wrap]
  )

  if (loading) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
    </div>
  )

  if (error) return (
    <div className="max-w-2xl mx-auto px-4 py-20 text-center">
      <p className="text-4xl mb-4">🫥</p>
      <h1 className="text-xl font-semibold mb-2">Paste not found</h1>
      <p className="text-[var(--text-muted)] mb-6">{error}</p>
      <Link to="/new" className="btn-primary">Create new paste</Link>
    </div>
  )

  if (!paste) return null

  const isOwner   = user && paste.userId === user.id
  const isExpired = !!paste.expiresAt && paste.expiresAt < Math.floor(Date.now() / 1000)
  const expiryStr = paste.expiresAt
    ? `Expires ${formatDistanceToNow(fromUnixTime(paste.expiresAt), { addSuffix: true })}`
    : 'Never expires'

  const visibilityIcon = paste.visibility === 'private'
    ? <EyeOff className="w-3.5 h-3.5" />
    : paste.visibility === 'password'
    ? <Lock    className="w-3.5 h-3.5" />
    : <Globe   className="w-3.5 h-3.5" />

  // ── Password lock screen ────────────────────────────────────────────────────
  if (locked) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <div className="card p-8 max-w-sm w-full text-center animate-slide-up">
          <Lock className="w-10 h-10 text-brand-600 dark:text-brand-400 mx-auto mb-4" />
          <h1 className="text-lg font-semibold mb-1">Protected paste</h1>
          <p className="text-sm text-[var(--text-muted)] mb-6">Enter the password to view this paste.</p>
          <div className="flex flex-col gap-3">
            <input
              type="password"
              placeholder="Password"
              value={pwInput}
              onChange={e => setPwInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleUnlock()}
              className="input text-center"
              autoFocus
            />
            {pwError && <p className="text-red-500 text-sm">{pwError}</p>}
            <button onClick={handleUnlock} disabled={unlocking || !pwInput} className="btn-primary justify-center">
              {unlocking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              {unlocking ? 'Unlocking…' : 'Unlock'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Main view ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-4 animate-fade-in">
      {isOwner && isExpired && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <Clock className="w-4 h-4 flex-shrink-0" />
          This paste expired {formatDistanceToNow(fromUnixTime(paste.expiresAt!), { addSuffix: true })} and is now
          archived — it's no longer publicly accessible, but you can still view it here since you're the owner.
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold truncate">{paste.title}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-[var(--text-muted)]">
            <span className="flex items-center gap-1">
              {visibilityIcon}
              {paste.visibility}
            </span>
            <span>·</span>
            <span>{paste.language}</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Eye className="w-3 h-3" />
              {paste.views} views
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {expiryStr}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* El wrap toggle está siempre visible, edites o no — afecta al
              mismo editor de CodeMirror en ambos modos. */}
          <button
            onClick={toggleWrap}
            title={wrap ? 'Ajuste de línea activado — clic para desactivar (scroll horizontal)' : 'Ajuste de línea desactivado — clic para activar'}
            aria-pressed={wrap}
            className={clsx(
              'text-xs py-1.5 px-3',
              wrap ? 'btn-primary' : 'btn-secondary',
            )}
          >
            <WrapText className="w-3.5 h-3.5" />
            Wrap
          </button>

          {editing ? (
            <>
              <button
                onClick={handleEditCancel}
                disabled={saving}
                className="btn-secondary text-xs py-1.5 px-3"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={saving}
                className="btn-primary text-xs py-1.5 px-3"
              >
                {saving
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Save    className="w-3.5 h-3.5" />}
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <>
              <a
                href={`/raw/${paste.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary text-xs py-1.5 px-3"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Raw
              </a>

              <button onClick={handleCopy} className="btn-secondary text-xs py-1.5 px-3">
                {copied
                  ? <><Check className="w-3.5 h-3.5 text-green-500" /> Copied</>
                  : <><Copy  className="w-3.5 h-3.5" /> Copy</>}
              </button>

              {isOwner && (
                <button onClick={handleEditStart} className="btn-secondary text-xs py-1.5 px-3">
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </button>
              )}

              {isOwner && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="btn-danger text-xs py-1.5 px-3"
                >
                  {deleting
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Trash2  className="w-3.5 h-3.5" />}
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {saveError && (
        <p className="text-red-500 text-sm -mt-2">{saveError}</p>
      )}

      {/* Code editor (read-only unless editing) */}
      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <ReactCodeMirror
          value={editing ? editContent : paste.content}
          extensions={editorExtensions}
          theme={dark ? oneDark : undefined}
          editable={editing}
          onChange={(value) => { if (editing) setEditContent(value) }}
          basicSetup={{
            lineNumbers:      true,
            highlightActiveLine: editing,
            foldGutter:       true,
          }}
          style={{ fontSize: 14 }}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-[var(--text-faint)]">
        <span>
          Created {formatDistanceToNow(fromUnixTime(paste.createdAt), { addSuffix: true })}
        </span>
        <span>{(editing ? editContent : paste.content)?.length.toLocaleString()} chars</span>
      </div>
    </div>
  )
}
