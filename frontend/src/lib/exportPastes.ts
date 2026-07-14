/**
 * Exporta todos los pastes del usuario (activos + archivados) a un único
 * .zip descargado desde el navegador. Usa la misma API de listado del
 * Dashboard (GET /api/pastes), que ya devuelve `content` completo para el
 * dueño — incluidos los pastes con contraseña, sin necesidad de
 * desbloquearlos uno a uno.
 */
import JSZip from 'jszip'
import { api, type Paste, type Folder } from '@/lib/api'

// Extensión de fichero por lenguaje — solo cosmético, para que el zip se
// abra bien en el editor de cada uno. Lo que no está aquí cae a .txt.
const EXTENSIONS: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  jsx:        'jsx',
  tsx:        'tsx',
  python:     'py',
  rust:       'rs',
  java:       'java',
  cpp:        'cpp',
  html:       'html',
  css:        'css',
  sql:        'sql',
  json:       'json',
  markdown:   'md',
  php:        'php',
  xml:        'xml',
  shell:      'sh',
  plaintext:  'txt',
}

function extensionFor(language: string): string {
  return EXTENSIONS[language] ?? 'txt'
}

/** Quita caracteres no válidos en nombres de fichero/carpeta y recorta longitud. */
function sanitizeName(name: string, fallback: string): string {
  const clean = (name || '').trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 100)
    .trim()
  return clean || fallback
}

export interface ExportProgress {
  fetched: number
  /** Total desconocido hasta terminar de paginar — se muestra solo `fetched`. */
}

/**
 * Descarga un .zip con todos los pastes del usuario, organizados en
 * carpetas según sus carpetas de PrivatePaste (los que no tienen carpeta
 * van sueltos en la raíz del zip).
 */
export async function exportAllPastesAsZip(
  onProgress?: (p: ExportProgress) => void
): Promise<{ count: number }> {
  const [foldersRes] = await Promise.all([api.listFolders()])
  const folderNameById = new Map<string, string>(
    foldersRes.folders.map((f: Folder) => [f.id, sanitizeName(f.name, f.id)])
  )

  const allPastes: Paste[] = []

  // Pagina sobre activos y archivados por separado (la API no tiene un
  // modo "todos"), a bloques de 100 (máximo permitido por el backend).
  for (const archived of [false, true]) {
    let page = 1
    for (;;) {
      const res = await api.listPastes({ page, limit: 100, archived })
      allPastes.push(...res.pastes)
      onProgress?.({ fetched: allPastes.length })
      // No nos fiamos solo de `hasMore`: si vino una página incompleta
      // (menos de 100), ya no hay más que pedir en ese bloque.
      if (!res.hasMore || res.pastes.length < 100) break
      page++
    }
  }

  const zip = new JSZip()
  const usedNames = new Set<string>()

  for (const paste of allPastes) {
    const folderName = paste.folderId
      ? (folderNameById.get(paste.folderId) ?? 'Sin carpeta')
      : ''
    const baseName = sanitizeName(paste.title, paste.id)
    const ext = extensionFor(paste.language)

    let filename = `${baseName}.${ext}`
    const path = folderName ? `${folderName}/${filename}` : filename

    // Evita colisiones si dos pastes comparten título en la misma carpeta.
    let finalPath = path
    let n = 2
    while (usedNames.has(finalPath)) {
      filename = `${baseName}-${paste.id}.${ext}`
      finalPath = folderName ? `${folderName}/${filename}` : filename
      n++
      if (n > 50) break // salvaguarda, no debería pasar nunca
    }
    usedNames.add(finalPath)

    zip.file(finalPath, paste.content ?? '')
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `privatepaste-export-${stamp}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)

  return { count: allPastes.length }
}
