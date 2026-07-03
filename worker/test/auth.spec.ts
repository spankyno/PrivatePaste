import { describe, it, expect, vi, afterEach } from 'vitest'
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { app } from '../src/index'

/** Llama a la app con un ExecutionContext real y espera cualquier waitUntil(). */
async function request(path: string, init?: RequestInit) {
  const ctx = createExecutionContext()
  const res = await app.request(path, init, env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

function uniqueEmail() {
  return `user-${crypto.randomUUID()}@example.com`
}

function jsonInit(body: unknown, extraHeaders: Record<string, string> = {}) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  } satisfies RequestInit
}

function mockTurnstile(success: boolean) {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ success }), { status: 200 })
  ))
}

/** Extrae el valor de la cookie pp_session de una respuesta Set-Cookie. */
function extractCookie(res: Response): string {
  const setCookie = res.headers.get('Set-Cookie') ?? ''
  const match = setCookie.match(/pp_session=([^;]+)/)
  if (!match) throw new Error(`No pp_session cookie in response: ${setCookie}`)
  return `pp_session=${match[1]}`
}

// Cada test usa una IP distinta para no compartir cupo de authRateLimit
// entre tests (el rate limit está keyado por CF-Connecting-IP + email).
let ipCounter = 0
function nextIp() {
  ipCounter += 1
  return `203.0.113.${ipCounter}`
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /api/auth/sign-up/email', () => {
  it('crea una cuenta con datos válidos y devuelve cookie de sesión', async () => {
    mockTurnstile(true)
    const email = uniqueEmail()

    const res = await request('/api/auth/sign-up/email', jsonInit(
      { email, password: 'supersecret123', turnstileToken: 'valid', website: '' },
      { 'CF-Connecting-IP': nextIp() },
    ))

    expect(res.status).toBe(201)
    const body = await res.json<any>()
    expect(body.user.email).toBe(email)
    expect(body.user.role).toBe('registered')
    expect(body.user.password).toBeUndefined()
    expect(res.headers.get('Set-Cookie')).toMatch(/pp_session=/)
  })

  it('rechaza el registro si el honeypot viene relleno (bot)', async () => {
    mockTurnstile(true)
    const email = uniqueEmail()

    const res = await request('/api/auth/sign-up/email', jsonInit(
      { email, password: 'supersecret123', turnstileToken: 'valid', website: 'http://spam.example' },
      { 'CF-Connecting-IP': nextIp() },
    ))

    expect(res.status).toBe(400)

    // Y confirmamos que efectivamente no se creó la cuenta
    const check = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
    expect(check).toBeNull()
  })

  it('rechaza el registro si Turnstile no valida el token', async () => {
    mockTurnstile(false)
    const email = uniqueEmail()

    const res = await request('/api/auth/sign-up/email', jsonInit(
      { email, password: 'supersecret123', turnstileToken: 'invalid', website: '' },
      { 'CF-Connecting-IP': nextIp() },
    ))

    expect(res.status).toBe(400)
    const body = await res.json<any>()
    expect(body.error).toMatch(/verification/i)
  })

  it('rechaza contraseñas de menos de 8 caracteres', async () => {
    mockTurnstile(true)
    const res = await request('/api/auth/sign-up/email', jsonInit(
      { email: uniqueEmail(), password: 'short', turnstileToken: 'valid', website: '' },
      { 'CF-Connecting-IP': nextIp() },
    ))

    expect(res.status).toBe(400)
  })

  it('rechaza un email ya registrado (409)', async () => {
    mockTurnstile(true)
    const email = uniqueEmail()
    const ip = nextIp()

    const first = await request('/api/auth/sign-up/email', jsonInit(
      { email, password: 'supersecret123', turnstileToken: 'valid', website: '' },
      { 'CF-Connecting-IP': ip },
    ))
    expect(first.status).toBe(201)

    const second = await request('/api/auth/sign-up/email', jsonInit(
      { email, password: 'anotherpassword', turnstileToken: 'valid', website: '' },
      { 'CF-Connecting-IP': ip },
    ))
    expect(second.status).toBe(409)
  })
})

describe('POST /api/auth/sign-in/email', () => {
  async function signUp(email: string, password: string) {
    mockTurnstile(true)
    const res = await request('/api/auth/sign-up/email', jsonInit(
      { email, password, turnstileToken: 'valid', website: '' },
      { 'CF-Connecting-IP': nextIp() },
    ))
    expect(res.status).toBe(201)
  }

  it('inicia sesión con credenciales correctas', async () => {
    const email = uniqueEmail()
    await signUp(email, 'supersecret123')

    const res = await request('/api/auth/sign-in/email', jsonInit(
      { email, password: 'supersecret123' },
      { 'CF-Connecting-IP': nextIp() },
    ))

    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toMatch(/pp_session=/)
  })

  it('rechaza una contraseña incorrecta con mensaje genérico', async () => {
    const email = uniqueEmail()
    await signUp(email, 'supersecret123')

    const res = await request('/api/auth/sign-in/email', jsonInit(
      { email, password: 'wrongpassword' },
      { 'CF-Connecting-IP': nextIp() },
    ))

    expect(res.status).toBe(401)
    const body = await res.json<any>()
    expect(body.error).toBe('Invalid email or password')
  })

  it('rechaza un email que no existe con el mismo mensaje genérico (no enumera cuentas)', async () => {
    const res = await request('/api/auth/sign-in/email', jsonInit(
      { email: uniqueEmail(), password: 'whatever123' },
      { 'CF-Connecting-IP': nextIp() },
    ))

    expect(res.status).toBe(401)
    const body = await res.json<any>()
    expect(body.error).toBe('Invalid email or password')
  })

  it('migra un hash legacy (SHA-256) a PBKDF2 tras un login correcto', async () => {
    const email = uniqueEmail()
    const password = 'legacypassword123'
    const userId = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)

    // Réplica exacta del algoritmo legacy que password.ts sustituyó.
    const salt = 'legacysalt123456'
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + password))
    const legacyHash = `${salt}:${Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')}`

    await env.DB.prepare(
      'INSERT INTO users (id, email, name, role, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    ).bind(userId, email, null, 'registered', now, now).run()
    await env.DB.prepare(
      'INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
    ).bind(crypto.randomUUID(), userId, 'email', userId, legacyHash, now, now).run()

    const res = await request('/api/auth/sign-in/email', jsonInit(
      { email, password },
      { 'CF-Connecting-IP': nextIp() },
    ))
    expect(res.status).toBe(200)

    const account = await env.DB.prepare(
      'SELECT password FROM accounts WHERE user_id = ? AND provider_id = ?'
    ).bind(userId, 'email').first<{ password: string }>()

    expect(account!.password).toMatch(/^pbkdf2-sha256\$/)
    expect(account!.password).not.toBe(legacyHash)
  })
})

describe('POST /api/auth/change-password', () => {
  async function signUpAndGetCookie(email: string, password: string) {
    mockTurnstile(true)
    const res = await request('/api/auth/sign-up/email', jsonInit(
      { email, password, turnstileToken: 'valid', website: '' },
      { 'CF-Connecting-IP': nextIp() },
    ))
    expect(res.status).toBe(201)
    return extractCookie(res)
  }

  it('requiere autenticación', async () => {
    const res = await request('/api/auth/change-password', jsonInit(
      { currentPassword: 'a', newPassword: 'b' },
    ))
    expect(res.status).toBe(401)
  })

  it('rechaza si la contraseña actual es incorrecta', async () => {
    const email = uniqueEmail()
    const cookie = await signUpAndGetCookie(email, 'originalpass123')

    const res = await request('/api/auth/change-password', jsonInit(
      { currentPassword: 'wrongcurrent', newPassword: 'newpassword123' },
      { Cookie: cookie },
    ))

    expect(res.status).toBe(401)
  })

  it('cambia la contraseña y revoca las demás sesiones, pero no la actual', async () => {
    const email = uniqueEmail()
    const cookieA = await signUpAndGetCookie(email, 'originalpass123')

    // Segunda sesión (p. ej. otro dispositivo), vía sign-in normal.
    const signInRes = await request('/api/auth/sign-in/email', jsonInit(
      { email, password: 'originalpass123' },
      { 'CF-Connecting-IP': nextIp() },
    ))
    const cookieB = extractCookie(signInRes)
    expect(cookieB).not.toBe(cookieA)

    // Cambiar la contraseña usando la sesión A.
    const changeRes = await request('/api/auth/change-password', jsonInit(
      { currentPassword: 'originalpass123', newPassword: 'brandnewpass123' },
      { Cookie: cookieA },
    ))
    expect(changeRes.status).toBe(200)

    // La sesión A (la que hizo el cambio) sigue viva.
    const meA = await request('/api/me', { headers: { Cookie: cookieA } })
    const bodyA = await meA.json<any>()
    expect(bodyA.user).not.toBeNull()

    // La sesión B (otro dispositivo) ha quedado revocada.
    const meB = await request('/api/me', { headers: { Cookie: cookieB } })
    const bodyB = await meB.json<any>()
    expect(bodyB.user).toBeNull()
    expect(bodyB.tier).toBe('anon')

    // Y la contraseña nueva ya funciona para iniciar sesión de nuevo.
    const reLogin = await request('/api/auth/sign-in/email', jsonInit(
      { email, password: 'brandnewpass123' },
      { 'CF-Connecting-IP': nextIp() },
    ))
    expect(reLogin.status).toBe(200)
  })
})
