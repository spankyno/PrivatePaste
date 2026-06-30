/**
 * Dashboard — user's paste list with search, folders, and delete.
 */
import { useEffect, useState, useCallback } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Search, Folder, FileText, Trash2, ExternalLink, Eye, Clock, Lock, Globe, EyeOff, Plus, Loader2, Copy, Check } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { api, type Paste, type Folder as FolderType } from '@/lib/api'
import { formatDistanceToNow, fromUnixTime } from 'date-fns'
import clsx from 'clsx'

export function DashboardPage() {
  const { user, tier, loading: authLoading } = useAuth()
  const [pastes,   setPastes]   = useState<Paste[]>([])
  const [folders,  setFolders]  = useState<FolderType[]>([])
  const [query,    setQuery]    = useState('')
  const [folderId, setFolderId] = useState<string | undefined>()
  const [page,     setPage]     = useState(1)
  const [loading,  setLoading]  = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const handleCopy = async (id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const url = `${window.location.origin}/p/${id}`
    await navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }
  const fetchPastes = useCallback(async () => {
    setLoading(true)
    try {
      const [pastesRes, foldersRes] = await Promise.all([
        api.listPastes({ q: query || undefined, folderId, page }),
        api.listFolders(),
      ])
      setPastes(pastesRes.pastes)
      setFolders(foldersRes.folders)
    } catch { /* handled */ }
    finally { setLoading(false) }
  }, [query, folderId, page])

  useEffect(() => { if (user) fetchPastes() }, [user, fetchPastes])

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault()
    if (!confirm('Delete this paste?')) return
    setDeleting(id)
    try {
      await api.deletePaste(id)
      setPastes(ps => ps.filter(p => p.id !== id))
    } catch { /* ignore */ }
    setDeleting(null)
  }

  if (authLoading) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
    </div>
  )

  if (!user) return <Navigate to="/auth" replace />

  const visIcon = (v: string) => ({
    public:   <Globe   className="w-3.5 h-3.5 text-green-500" />,
    private:  <EyeOff  className="w-3.5 h-3.5 text-yellow-500" />,
    password: <Lock    className="w-3.5 h-3.5 text-blue-500" />,
  }[v] ?? null)

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">My pastes</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            {tier === 'pro' ? 'Pro' : 'Free'} account · {pastes.length} paste{pastes.length !== 1 ? 's' : ''} shown
          </p>
        </div>
        <Link to="/" className="btn-primary text-sm">
          <Plus className="w-4 h-4" />
          New paste
        </Link>
      </div>

      <div className="flex gap-4 flex-col sm:flex-row">
        {/* Sidebar: Folders */}
        {folders.length > 0 && (
          <div className="sm:w-48 flex-shrink-0">
            <div className="card p-3 flex flex-col gap-1">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide px-1 mb-1">Folders</p>
              <button
                onClick={() => setFolderId(undefined)}
                className={clsx(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left',
                  !folderId ? 'bg-brand-600/10 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400' : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]'
                )}
              >
                <FileText className="w-4 h-4" />
                All pastes
              </button>
              {folders.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFolderId(folderId === f.id ? undefined : f.id)}
                  className={clsx(
                    'flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left',
                    folderId === f.id ? 'bg-brand-600/10 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400' : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]'
                  )}
                >
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: f.color }} />
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 flex flex-col gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-faint)]" />
            <input
              type="search"
              placeholder="Search pastes…"
              value={query}
              onChange={e => { setQuery(e.target.value); setPage(1) }}
              className="input pl-9"
            />
          </div>

          {/* Paste list */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
            </div>
          ) : pastes.length === 0 ? (
            <div className="text-center py-16 text-[var(--text-muted)]">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">{query ? 'No results found' : 'No pastes yet'}</p>
              {!query && (
                <Link to="/" className="btn-primary mt-4 inline-flex">Create your first paste</Link>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {pastes.map(paste => (
                <Link
                  key={paste.id}
                  to={`/p/${paste.id}`}
                  className="card p-4 hover:border-[var(--border-strong)] transition-colors group"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {visIcon(paste.visibility)}
                        <span className="font-medium text-sm truncate">{paste.title}</span>
                        <span className="badge bg-[var(--bg-tertiary)] text-[var(--text-muted)] hidden sm:inline-flex">
                          {paste.language}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-faint)]">
                        <span className="flex items-center gap-1">
                          <Eye className="w-3 h-3" />{paste.views}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {paste.expiresAt
                            ? formatDistanceToNow(fromUnixTime(paste.expiresAt), { addSuffix: true })
                            : 'Never expires'}
                        </span>
                        <span>{formatDistanceToNow(fromUnixTime(paste.createdAt), { addSuffix: true })}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={e => handleCopy(paste.id, e)}
                        className="btn-ghost p-1.5 rounded-md"
                        title="Copy URL"
                      >
                        {copiedId === paste.id
                          ? <Check className="w-3.5 h-3.5 text-green-500" />
                          : <Copy  className="w-3.5 h-3.5" />}
                      </button>
                      <a
                        href={`/p/${paste.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="btn-ghost p-1.5 rounded-md"
                        title="Open"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <button
                        onClick={e => handleDelete(paste.id, e)}
                        disabled={deleting === paste.id}
                        className="btn-ghost p-1.5 rounded-md text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Delete"
                      >
                        {deleting === paste.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2   className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
