/**
 * Dashboard — lista de pastes con búsqueda, carpetas, drag & drop y borrado.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  Search, FileText, Trash2, ExternalLink, Eye, Clock, Lock, Globe, EyeOff,
  Plus, Loader2, Copy, Check, Folder as FolderIcon, FolderPlus, Pencil,
  X, FolderInput, GripVertical,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { api, type Paste, type Folder as FolderType } from '@/lib/api'
import { formatDistanceToNow, fromUnixTime } from 'date-fns'
import clsx from 'clsx'

const FOLDER_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6']

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

  const [showFolderModal, setShowFolderModal] = useState(false)
  const [editingFolder,   setEditingFolder]   = useState<FolderType | null>(null)
  const [folderName,      setFolderName]      = useState('')
  const [folderColor,     setFolderColor]     = useState(FOLDER_COLORS[0])
  const [savingFolder,    setSavingFolder]    = useState(false)

  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null)
  const moveMenuRef = useRef<HTMLDivElement>(null)

  // Drag & drop state
  const [draggingId,  setDraggingId]  = useState<string | null>(null)
  const [dragOverId,  setDragOverId]  = useState<string | null>(null) // 'root' o folder.id

  const canUseFolders = tier === 'registered' || tier === 'pro'

  const fetchAll = useCallback(async () => {
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

  useEffect(() => { if (user) fetchAll() }, [user, fetchAll])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (moveMenuRef.current && !moveMenuRef.current.contains(e.target as Node)) {
        setMoveMenuFor(null)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('Delete this paste?')) return
    setDeleting(id)
    try {
      await api.deletePaste(id)
      setPastes(ps => ps.filter(p => p.id !== id))
    } catch { /* ignore */ }
    setDeleting(null)
  }

  const handleCopy = async (id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    await navigator.clipboard.writeText(`${window.location.origin}/p/${id}`)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  /**
   * Mueve un paste a una carpeta (o a null = sin carpeta).
   * Si la vista actual está filtrada por carpeta y el destino es distinto,
   * el paste se elimina del array local — esto arregla el bug de que
   * el paste seguía visible en la carpeta origen tras moverlo.
   */
  const movePasteToFolder = async (pasteId: string, targetFolderId: string | null) => {
    try {
      await api.updatePaste(pasteId, { folderId: targetFolderId })
      setPastes(ps => {
        // Si estamos viendo "All pastes" (folderId === undefined), solo actualizamos el campo
        if (folderId === undefined) {
          return ps.map(p => p.id === pasteId ? { ...p, folderId: targetFolderId } : p)
        }
        // Si estamos dentro de una carpeta concreta y el destino es otra carpeta
        // (o ninguna), el paste ya no pertenece a esta vista — lo quitamos.
        if (targetFolderId !== folderId) {
          return ps.filter(p => p.id !== pasteId)
        }
        return ps
      })
    } catch { /* ignore */ }
  }

  const handleMoveToFolder = async (pasteId: string, targetFolderId: string | null, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    await movePasteToFolder(pasteId, targetFolderId)
    setMoveMenuFor(null)
  }

  // ─── Drag & drop handlers ─────────────────────────────────────────────────

  const handleDragStart = (pasteId: string) => (e: React.DragEvent) => {
    setDraggingId(pasteId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pasteId)
  }

  const handleDragEnd = () => {
    setDraggingId(null)
    setDragOverId(null)
  }

  const handleDragOverFolder = (targetId: string) => (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(targetId)
  }

  const handleDragLeaveFolder = () => {
    setDragOverId(null)
  }

  const handleDropOnFolder = (targetFolderId: string | null) => async (e: React.DragEvent) => {
    e.preventDefault()
    const pasteId = e.dataTransfer.getData('text/plain') || draggingId
    setDragOverId(null)
    setDraggingId(null)
    if (!pasteId) return
    await movePasteToFolder(pasteId, targetFolderId)
  }

  // ─── Folder modal handlers ────────────────────────────────────────────────

  const openCreateFolder = () => {
    setEditingFolder(null)
    setFolderName('')
    setFolderColor(FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)])
    setShowFolderModal(true)
  }

  const openEditFolder = (f: FolderType, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingFolder(f)
    setFolderName(f.name)
    setFolderColor(f.color)
    setShowFolderModal(true)
  }

  const handleSaveFolder = async () => {
    if (!folderName.trim()) return
    setSavingFolder(true)
    try {
      if (editingFolder) {
        await api.updateFolder(editingFolder.id, { name: folderName.trim(), color: folderColor })
      } else {
        await api.createFolder({ name: folderName.trim(), color: folderColor })
      }
      setShowFolderModal(false)
      await fetchAll()
    } catch { /* ignore */ }
    setSavingFolder(false)
  }

  const handleDeleteFolder = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this folder? Pastes inside will move to "All pastes".')) return
    try {
      await api.deleteFolder(id)
      if (folderId === id) setFolderId(undefined)
      await fetchAll()
    } catch { /* ignore */ }
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

  const activeFolder = folders.find(f => f.id === folderId)

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">My pastes</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            {tier === 'pro' ? 'Pro' : 'Free'} account · {pastes.length} paste{pastes.length !== 1 ? 's' : ''} shown
            {canUseFolders && <span className="hidden sm:inline"> · drag a paste onto a folder to move it</span>}
          </p>
        </div>
        <Link to="/" className="btn-primary text-sm">
          <Plus className="w-4 h-4" />
          New paste
        </Link>
      </div>

      <div className="flex gap-4 flex-col sm:flex-row">
        {/* Sidebar: Folders */}
        <div className="sm:w-52 flex-shrink-0">
          <div className="card p-3 flex flex-col gap-1">
            <div className="flex items-center justify-between px-1 mb-1">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Folders</p>
              {canUseFolders && (
                <button onClick={openCreateFolder} className="btn-ghost p-1 rounded-md" title="New folder">
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* "All pastes" — también es drop target para sacar de cualquier carpeta */}
            <button
              onClick={() => setFolderId(undefined)}
              onDragOver={canUseFolders ? handleDragOverFolder('root') : undefined}
              onDragLeave={canUseFolders ? handleDragLeaveFolder : undefined}
              onDrop={canUseFolders ? handleDropOnFolder(null) : undefined}
              className={clsx(
                'flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left',
                !folderId ? 'bg-brand-600/10 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400' : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]',
                dragOverId === 'root' && 'ring-2 ring-brand-500 bg-brand-600/10'
              )}
            >
              <FileText className="w-4 h-4" />
              All pastes
            </button>

            {folders.map(f => (
              <div
                key={f.id}
                onClick={() => setFolderId(folderId === f.id ? undefined : f.id)}
                onDragOver={canUseFolders ? handleDragOverFolder(f.id) : undefined}
                onDragLeave={canUseFolders ? handleDragLeaveFolder : undefined}
                onDrop={canUseFolders ? handleDropOnFolder(f.id) : undefined}
                className={clsx(
                  'group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors cursor-pointer',
                  folderId === f.id ? 'bg-brand-600/10 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400' : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]',
                  dragOverId === f.id && 'ring-2 ring-brand-500 bg-brand-600/10 scale-[1.02]'
                )}
              >
                <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: f.color }} />
                <span className="truncate flex-1">{f.name}</span>
                <button
                  onClick={(e) => openEditFolder(f, e)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--bg-secondary)] transition-opacity flex-shrink-0"
                  title="Edit folder"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => handleDeleteFolder(f.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-opacity flex-shrink-0"
                  title="Delete folder"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}

            {folders.length === 0 && (
              <p className="text-xs text-[var(--text-faint)] px-2 py-2">
                {canUseFolders ? 'No folders yet' : 'Folders require an account'}
              </p>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col gap-4">
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-faint)]" />
              <input
                type="search"
                placeholder="Search pastes…"
                value={query}
                onChange={e => { setQuery(e.target.value); setPage(1) }}
                className="input pl-9"
              />
            </div>
            {activeFolder && (
              <span className="badge flex-shrink-0" style={{ background: activeFolder.color + '22', color: activeFolder.color }}>
                <FolderIcon className="w-3 h-3" /> {activeFolder.name}
              </span>
            )}
          </div>

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
                  draggable={canUseFolders}
                  onDragStart={canUseFolders ? handleDragStart(paste.id) : undefined}
                  onDragEnd={canUseFolders ? handleDragEnd : undefined}
                  className={clsx(
                    'card p-4 hover:border-[var(--border-strong)] transition-colors group relative',
                    draggingId === paste.id && 'opacity-40',
                    canUseFolders && 'cursor-grab active:cursor-grabbing'
                  )}
                >
                  <div className="flex items-start gap-3">
                    {canUseFolders && (
                      <GripVertical className="w-4 h-4 text-[var(--text-faint)] mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
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
                      <button onClick={e => handleCopy(paste.id, e)} className="btn-ghost p-1.5 rounded-md" title="Copy URL">
                        {copiedId === paste.id
                          ? <Check className="w-3.5 h-3.5 text-green-500" />
                          : <Copy  className="w-3.5 h-3.5" />}
                      </button>

                      {canUseFolders && (
                        <div className="relative">
                          <button
                            onClick={e => { e.preventDefault(); e.stopPropagation(); setMoveMenuFor(moveMenuFor === paste.id ? null : paste.id) }}
                            className="btn-ghost p-1.5 rounded-md"
                            title="Move to folder"
                          >
                            <FolderInput className="w-3.5 h-3.5" />
                          </button>

                          {moveMenuFor === paste.id && (
                            <div
                              ref={moveMenuRef}
                              className="absolute right-0 top-full mt-1 w-48 card shadow-lg z-50 py-1 animate-fade-in"
                              onClick={e => e.stopPropagation()}
                            >
                              <button
                                onClick={e => handleMoveToFolder(paste.id, null, e)}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[var(--bg-tertiary)] transition-colors"
                              >
                                <FileText className="w-3.5 h-3.5 text-[var(--text-muted)]" /> No folder
                              </button>
                              {folders.map(f => (
                                <button
                                  key={f.id}
                                  onClick={e => handleMoveToFolder(paste.id, f.id, e)}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[var(--bg-tertiary)] transition-colors"
                                >
                                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: f.color }} />
                                  <span className="truncate">{f.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

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

      {showFolderModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4"
          onClick={() => setShowFolderModal(false)}
        >
          <div
            className="card p-6 max-w-sm w-full animate-slide-up"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">
                {editingFolder ? 'Edit folder' : 'New folder'}
              </h2>
              <button onClick={() => setShowFolderModal(false)} className="btn-ghost p-1 rounded-md">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[var(--text-muted)]">Name</label>
                <input
                  type="text"
                  value={folderName}
                  onChange={e => setFolderName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveFolder()}
                  placeholder="e.g. Work scripts"
                  className="input"
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[var(--text-muted)]">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {FOLDER_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setFolderColor(c)}
                      className={clsx(
                        'w-7 h-7 rounded-full transition-transform',
                        folderColor === c && 'ring-2 ring-offset-2 ring-[var(--text)] scale-110'
                      )}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>

              <button
                onClick={handleSaveFolder}
                disabled={savingFolder || !folderName.trim()}
                className="btn-primary justify-center mt-1"
              >
                {savingFolder && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingFolder ? 'Save changes' : 'Create folder'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
