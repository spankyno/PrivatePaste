/**
 * Supported languages for syntax highlighting.
 * Maps display label → CodeMirror language extension loader.
 */
import type { Extension } from '@codemirror/state'

export interface Language {
  id:    string
  label: string
  load:  () => Promise<Extension>
}

export const LANGUAGES: Language[] = [
  { id: 'plaintext',  label: 'Plain text',   load: async () => [] },
  { id: 'javascript', label: 'JavaScript',   load: () => import('@codemirror/lang-javascript').then(m => m.javascript()) },
  { id: 'typescript', label: 'TypeScript',   load: () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true })) },
  { id: 'jsx',        label: 'JSX',          load: () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true })) },
  { id: 'tsx',        label: 'TSX',          load: () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true, typescript: true })) },
  { id: 'python',     label: 'Python',       load: () => import('@codemirror/lang-python').then(m => m.python()) },
  { id: 'rust',       label: 'Rust',         load: () => import('@codemirror/lang-rust').then(m => m.rust()) },
  { id: 'go',         label: 'Go',           load: () => import('@codemirror/lang-go').then(m => m.go()) },
  { id: 'java',       label: 'Java',         load: () => import('@codemirror/lang-java').then(m => m.java()) },
  { id: 'cpp',        label: 'C++',          load: () => import('@codemirror/lang-cpp').then(m => m.cpp()) },
  { id: 'html',       label: 'HTML',         load: () => import('@codemirror/lang-html').then(m => m.html()) },
  { id: 'css',        label: 'CSS',          load: () => import('@codemirror/lang-css').then(m => m.css()) },
  { id: 'sql',        label: 'SQL',          load: () => import('@codemirror/lang-sql').then(m => m.sql()) },
  { id: 'json',       label: 'JSON',         load: () => import('@codemirror/lang-json').then(m => m.json()) },
  { id: 'markdown',   label: 'Markdown',     load: () => import('@codemirror/lang-markdown').then(m => m.markdown()) },
  { id: 'php',        label: 'PHP',          load: () => import('@codemirror/lang-php').then(m => m.php()) },
  { id: 'xml',        label: 'XML',          load: () => import('@codemirror/lang-xml').then(m => m.xml()) },
  { id: 'shell',      label: 'Shell/Bash',   load: async () => [] },  // no CM extension, use plaintext
]

export function getLanguage(id: string): Language {
  return LANGUAGES.find(l => l.id === id) ?? LANGUAGES[0]!
}
