/**
 * About page — descripción, stack tecnológico y límites por tier.
 */
import { Link } from 'react-router-dom'
import { useDocumentHead } from '@/hooks/useDocumentHead'
import {
  FileCode2, Zap, Lock, Clock, Search, FolderTree, Moon,
  Check, X, Sparkles,
} from 'lucide-react'

const STACK = [
  { name: 'Cloudflare Workers', role: 'Runtime edge serverless', icon: '⚡' },
  { name: 'Hono',               role: 'Framework HTTP ligero',   icon: '🔥' },
  { name: 'Cloudflare D1',      role: 'Base de datos SQLite',    icon: '🗄️' },
  { name: 'Workers KV',         role: 'Rate limiting',           icon: '⏱️' },
  { name: 'React 18',           role: 'Interfaz de usuario',     icon: '⚛️' },
  { name: 'TypeScript',         role: 'Tipado estático',         icon: '🔷' },
  { name: 'Vite',               role: 'Build tool',              icon: '🚀' },
  { name: 'Tailwind CSS',       role: 'Estilos utilitarios',     icon: '🎨' },
  { name: 'CodeMirror 6',       role: 'Editor de código',        icon: '📝' },
  { name: 'Web Crypto API',     role: 'Hash de contraseñas',     icon: '🔐' },
  { name: 'GitHub Actions',     role: 'CI/CD automático',        icon: '🔄' },
  { name: 'nanoid',             role: 'IDs cortos para URLs',    icon: '🔗' },
]

const TIER_ROWS = [
  { label: 'Pastes activos',        anon: '10',       free: '100',      pro: '~10.000' },
  { label: 'Tamaño máximo',         anon: '512 KB',   free: '2 MB',     pro: '10 MB' },
  { label: 'Caducidad máxima',      anon: '3 días',   free: '90 días',  pro: 'Nunca' },
  { label: 'Pastes / día',          anon: '5',        free: '20',       pro: '500' },
  { label: 'Rate API (15 min)',      anon: '5 req',    free: '30 req',   pro: '100 req' },
  { label: 'Requests / día',        anon: '200',      free: '5.000',    pro: '50.000' },
  { label: 'Pastes privados',       anon: '✕',        free: '✓',        pro: '✓' },
  { label: 'Protección contraseña', anon: '✕',        free: '✓',        pro: '✓' },
  { label: 'Carpetas',              anon: '✕',        free: '✓',        pro: '✓' },
  { label: 'Búsqueda',             anon: '✕',        free: '✓',        pro: '✓' },
  { label: 'Limpieza automática',   anon: 'Agresiva', free: 'Normal',   pro: 'Archivado' },
]

const FEATURES = [
  { icon: Zap,       title: 'Edge global',            desc: 'Servido desde la red de Cloudflare, sin servidores centralizados ni cold starts notables.' },
  { icon: Lock,      title: 'Privacidad real',         desc: 'Pastes privados visibles solo por el propietario, y protección por contraseña con hash SHA-256.' },
  { icon: Clock,     title: 'Caducidad configurable',  desc: 'Desde 1 hora hasta caducidad nunca (cuentas Pro), con limpieza automática vía cron.' },
  { icon: FolderTree,title: 'Organización',            desc: 'Carpetas con colores, arrastrar y soltar para mover pastes entre ellas.' },
  { icon: Search,    title: 'Búsqueda integrada',      desc: 'Full-text search sobre título y contenido usando SQLite FTS5.' },
  { icon: Moon,      title: 'Modo oscuro',             desc: 'Sigue la preferencia del sistema o se puede alternar manualmente.' },
]

function Cell({ value }: { value: string }) {
  if (value === '✓') return <Check className="w-3.5 h-3.5 text-green-500" />
  if (value === '✕') return <X className="w-3.5 h-3.5 text-[var(--text-faint)]" />
  return <>{value}</>
}

export function AboutPage() {
  useDocumentHead({ title: 'Acerca de PrivatePaste' })
  return (
    <div className="max-w-4xl mx-auto px-4 py-10 flex flex-col gap-12">

      {/* Hero */}
      <div className="text-center flex flex-col items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-brand-600/10 dark:bg-brand-500/10 flex items-center justify-center">
          <FileCode2 className="w-7 h-7 text-brand-600 dark:text-brand-400" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Acerca de PrivatePaste</h1>
        <p className="text-[var(--text-muted)] max-w-xl leading-relaxed">
          Una alternativa moderna y privada a Pastebin, construida sobre la red edge de
          Cloudflare. Comparte código y texto al instante, con control total sobre quién
          puede verlo y durante cuánto tiempo.
        </p>
        <Link to="/new" className="btn-primary mt-2">
          <FileCode2 className="w-4 h-4" />
          Crear mi primer paste
        </Link>
      </div>

      {/* Cómo funciona */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Cómo funciona</h2>
        <p className="text-sm text-[var(--text-muted)] leading-relaxed">
          Pega o escribe tu contenido en el editor, elige un lenguaje para el resaltado de
          sintaxis, configura la visibilidad y la caducidad, y genera una URL corta lista
          para compartir. No hace falta cuenta para empezar: cualquiera puede crear pastes
          públicos de forma anónima, y registrarte desbloquea pastes privados, protección
          por contraseña, carpetas y límites más generosos.
        </p>
      </section>

      {/* Características */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Características</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="card p-4 flex gap-3">
              <div className="w-9 h-9 rounded-lg bg-brand-600/10 dark:bg-brand-500/10 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Stack tecnológico */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Stack tecnológico</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {STACK.map(item => (
            <div key={item.name} className="card p-3.5 flex flex-col gap-1">
              <span className="text-lg leading-none">{item.icon}</span>
              <p className="text-sm font-medium mt-1">{item.name}</p>
              <p className="text-xs text-[var(--text-faint)]">{item.role}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Planes y límites */}
      <section className="flex flex-col gap-4">
        <div className="flex items-end justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold">Planes y límites</h2>
          <span className="text-xs text-[var(--text-faint)]">Precios en euros, IVA no incluido</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="card p-5 flex flex-col gap-2">
            <p className="text-sm font-semibold">Anónimo</p>
            <p className="text-2xl font-semibold">Gratis</p>
            <p className="text-xs text-[var(--text-muted)]">Sin registro. Ideal para compartir algo rápido.</p>
          </div>

          <div className="card p-5 flex flex-col gap-2">
            <p className="text-sm font-semibold">Registrado</p>
            <p className="text-2xl font-semibold">Gratis</p>
            <p className="text-xs text-[var(--text-muted)]">Cuenta con email. Privacidad, contraseñas y carpetas.</p>
          </div>

          <div className="card p-5 flex flex-col gap-2 border-brand-500 dark:border-brand-400 relative overflow-hidden">
            <span className="absolute top-0 right-0 flex items-center gap-1 bg-brand-600 text-white text-xs font-medium px-2.5 py-1 rounded-bl-lg">
              <Sparkles className="w-3 h-3" /> Pro
            </span>
            <p className="text-sm font-semibold">Pro</p>
            <p className="text-2xl font-semibold">10€ <span className="text-sm font-normal text-[var(--text-muted)]">/ año</span></p>
            <p className="text-xs text-[var(--text-muted)]">Sin límites prácticos. Pastes que nunca caducan.</p>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
                  <th className="text-left px-4 py-2.5 font-medium text-[var(--text-muted)]">Límite</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[var(--text-muted)]">Anónimo</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[var(--text-muted)]">Registrado</th>
                  <th className="text-left px-4 py-2.5 font-medium text-brand-600 dark:text-brand-400">Pro</th>
                </tr>
              </thead>
              <tbody>
                {TIER_ROWS.map((row, i) => (
                  <tr key={row.label} className={i % 2 === 0 ? '' : 'bg-[var(--bg-secondary)]'}>
                    <td className="px-4 py-2 text-[var(--text-muted)]">{row.label}</td>
                    <td className="px-4 py-2"><Cell value={row.anon} /></td>
                    <td className="px-4 py-2"><Cell value={row.free} /></td>
                    <td className="px-4 py-2 font-medium"><Cell value={row.pro} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <div className="text-center flex flex-col items-center gap-3 py-4">
        <p className="text-sm text-[var(--text-muted)]">¿Listo para empezar?</p>
        <div className="flex gap-3">
          <Link to="/new" className="btn-primary">Crear paste</Link>
          <Link to="/auth" className="btn-secondary">Crear cuenta gratis</Link>
        </div>
      </div>
    </div>
  )
}