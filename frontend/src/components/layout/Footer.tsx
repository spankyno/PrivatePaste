import { Link } from 'react-router-dom'

const EXTERNAL_LINKS = [
  { label: 'Contacto',  href: 'https://aitorsanchez.pages.dev/contacto' },
  { label: 'Blog',      href: 'https://aitorsanchez.pages.dev/' },
  { label: 'Más apps',  href: 'https://aitorhub.vercel.app/' },
]

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] py-4 mt-8">
      <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[var(--text-faint)]">
        <span>PrivatePaste — fast, private, edge-deployed</span>

        <nav className="flex items-center gap-4 flex-wrap justify-center">
          <Link to="/about" className="hover:text-[var(--text-muted)] transition-colors">
            Acerca de
          </Link>

          {EXTERNAL_LINKS.map(link => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--text-muted)] transition-colors"
            >
              {link.label}
            </a>
          ))}

          <a href="/api/health" className="hover:text-[var(--text-muted)] transition-colors">
            API status
          </a>
        </nav>
      </div>
    </footer>
  )
}