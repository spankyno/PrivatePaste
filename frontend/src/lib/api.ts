/**
 * Typed API client for PrivatePaste.
 * All requests go through /api/* (proxied by Vite in dev, served by Worker in prod).
 */

export interface PastePayload {
  title?:      string
  content:     string
  language?:   string
  visibility?: 'public' | 'private' | 'password'
  password?:   string
  expiry?:     '1h' | '3d' | '30d' | '90d' | '300d' | 'never'
  folderId?:   string
}

export interface Paste {
  id:           string
  userId:       string | null
  folderId:     string | null
  title:        string
  content:      string | undefined
  language:     string
  visibility:   'public' | 'private' | 'password'
  expiresAt:    number | null
  views:        number
  isArchived:   boolean
  hasPassword:  boolean
  locked?:      boolean
  createdAt:    number
  updatedAt:    number
}

export interface ApiUser {
  id:              string
  email:           string
  name:            string | null
  role:            'registered' | 'pro' | 'admin'
  proExpiresAt:    number | null
  emailVerifiedAt: number | null
}

export interface SessionResponse {
  user: ApiUser | null
  tier: 'anon' | 'registered' | 'pro'
}

export interface Folder {
  id:       string
  userId:   string
  parentId: string | null
  name:     string
  slug:     string
  color:    string
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  const data = await res.json()
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Unknown error')
  return data as T
}

export const api = {
  // ── Session ──────────────────────────────────────────────────────────────
  me: () => apiFetch<SessionResponse>('/api/me'),

  // ── Auth ──────────────────────────────────────────────────────────────────
  signUp: (email: string, password: string, name?: string, turnstileToken?: string, website?: string) =>
    apiFetch('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, turnstileToken, website }),
    }),

  signIn: (email: string, password: string) =>
    apiFetch('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  signOut: () =>
    apiFetch('/api/auth/sign-out', { method: 'POST' }),

  verifyEmail: (token: string) =>
    apiFetch<{ success: boolean }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  resendVerification: () =>
    apiFetch<{ success: boolean }>('/api/auth/resend-verification', { method: 'POST' }),

  // ── Pastes ────────────────────────────────────────────────────────────────
  createPaste: (payload: PastePayload) =>
    apiFetch<{ id: string; url: string }>('/api/pastes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getPaste: (id: string) =>
    apiFetch<Paste>(`/api/pastes/${id}`),

  unlockPaste: (id: string, password: string) =>
    apiFetch<Paste>(`/api/pastes/${id}/unlock`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  listPastes: (params?: { q?: string; folderId?: string; page?: number; archived?: boolean }) => {
    const qs = new URLSearchParams()
    if (params?.q)        qs.set('q', params.q)
    if (params?.folderId) qs.set('folderId', params.folderId)
    if (params?.page)     qs.set('page', String(params.page))
    if (params?.archived) qs.set('archived', '1')
    return apiFetch<{ pastes: Paste[]; page: number; limit: number; hasMore: boolean }>(`/api/pastes?${qs}`)
  },

  deletePaste: (id: string) =>
    apiFetch(`/api/pastes/${id}`, { method: 'DELETE' }),

  updatePaste: (id: string, data: { title?: string; folderId?: string | null; content?: string; language?: string }) =>
    apiFetch<Paste>(`/api/pastes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // ── Folders ───────────────────────────────────────────────────────────────
  listFolders: () =>
    apiFetch<{ folders: Folder[] }>('/api/folders'),

  createFolder: (data: { name: string; parentId?: string; color?: string }) =>
    apiFetch<Folder>('/api/folders', { method: 'POST', body: JSON.stringify(data) }),

  updateFolder: (id: string, data: { name?: string; color?: string }) =>
    apiFetch(`/api/folders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteFolder: (id: string) =>
    apiFetch(`/api/folders/${id}`, { method: 'DELETE' }),
}

export { ApiError }
