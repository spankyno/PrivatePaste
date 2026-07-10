/**
 * Verificación de Cloudflare Turnstile (anti-bot) desde el propio Worker.
 * Una única llamada HTTP al endpoint de siteverify de Cloudflare — sin
 * dependencias npm.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export async function verifyTurnstile(
  token: string | undefined,
  secretKey: string,
  remoteIp?: string,
): Promise<boolean> {
  if (!token) return false

  try {
    const body = new URLSearchParams()
    body.set('secret', secretKey)
    body.set('response', token)
    if (remoteIp) body.set('remoteip', remoteIp)

    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body })
    if (!res.ok) return false

    const data = await res.json<{ success: boolean }>()
    return !!data.success
  } catch (err) {
    console.error('[turnstile] verification request failed', err)
    return false
  }
}
