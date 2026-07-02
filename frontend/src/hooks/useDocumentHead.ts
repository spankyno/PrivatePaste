import { useEffect } from 'react'

const SITE_NAME = 'PrivatePaste'

interface DocumentHeadOptions {
  /** Título de la página (se añade automáticamente " · PrivatePaste"). */
  title?: string
  /**
   * Si es true, añade `<meta name="robots" content="noindex, nofollow">`
   * para esta vista (contenido privado o específico de usuario que no
   * debe aparecer en buscadores: pastes individuales, login, dashboard).
   * Al desmontar el componente se restaura "index, follow" por defecto.
   */
  noindex?: boolean
}

function setRobotsMeta(content: string) {
  let tag = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
  if (!tag) {
    tag = document.createElement('meta')
    tag.name = 'robots'
    document.head.appendChild(tag)
  }
  tag.content = content
}

/**
 * Actualiza `document.title` y la meta `robots` para la vista actual.
 * Pensado para una SPA sin SSR: los bots que sí ejecutan JS (Googlebot)
 * verán el título/robots correctos; es un complemento a robots.txt, no
 * un sustituto para contenido que además ya está protegido en el backend.
 */
export function useDocumentHead({ title, noindex }: DocumentHeadOptions) {
  useEffect(() => {
    const previousTitle = document.title
    document.title = title ? `${title} · ${SITE_NAME}` : SITE_NAME
    setRobotsMeta(noindex ? 'noindex, nofollow' : 'index, follow')

    return () => {
      document.title = previousTitle
      setRobotsMeta('index, follow')
    }
  }, [title, noindex])
}
