/**
 * Envío de emails transaccionales vía la API HTTP de Resend. Sin SDK:
 * una única llamada `fetch`, igual que con Turnstile — Workers no puede
 * hablar SMTP directamente (no hay sockets TCP crudos), así que cualquier
 * proveedor de email desde un Worker pasa por su API HTTP.
 *
 * https://resend.com/docs/api-reference/emails/send-email
 */

const RESEND_API_URL = 'https://api.resend.com/emails'

/**
 * Envía un email. Nunca lanza — devuelve `false` y registra el error en
 * caso de fallo, para que un problema con el proveedor de email no rompa
 * el flujo que lo dispara (p. ej. el registro de un usuario).
 */
export async function sendEmail(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    })

    if (!res.ok) {
      console.error('[email] Resend respondió con error', res.status, await res.text())
      return false
    }
    return true
  } catch (err) {
    console.error('[email] fallo al enviar', err)
    return false
  }
}

export function verificationEmailHtml(verifyUrl: string): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #3b5bdb;">Confirma tu email en PrivatePaste</h2>
      <p>Gracias por registrarte. Pulsa el siguiente botón para verificar tu dirección de correo:</p>
      <p style="margin: 32px 0;">
        <a href="${verifyUrl}"
           style="background:#3b5bdb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
          Verificar mi email
        </a>
      </p>
      <p style="color:#666;font-size:14px;">
        Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
        <a href="${verifyUrl}">${verifyUrl}</a>
      </p>
      <p style="color:#999;font-size:12px;">Este enlace caduca en 24 horas. Si no creaste esta cuenta, ignora este correo.</p>
    </div>
  `
}
