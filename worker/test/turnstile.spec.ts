import { describe, it, expect, vi, afterEach } from 'vitest'
import { verifyTurnstile } from '../src/lib/turnstile'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('verifyTurnstile', () => {
  it('devuelve false sin llamar a fetch si no hay token', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const ok = await verifyTurnstile(undefined, 'secret')

    expect(ok).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('devuelve true cuando Cloudflare responde success:true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 })
    ))

    await expect(verifyTurnstile('valid-token', 'secret')).resolves.toBe(true)
  })

  it('devuelve false cuando Cloudflare responde success:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), { status: 200 })
    ))

    await expect(verifyTurnstile('bad-token', 'secret')).resolves.toBe(false)
  })

  it('devuelve false si la respuesta HTTP no es ok (sin lanzar excepción)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 500 })))

    await expect(verifyTurnstile('token', 'secret')).resolves.toBe(false)
  })

  it('devuelve false si fetch lanza un error de red (sin propagar la excepción)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))

    await expect(verifyTurnstile('token', 'secret')).resolves.toBe(false)
  })

  it('envía el secret, el token y la IP al endpoint de siteverify', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    await verifyTurnstile('my-token', 'my-secret', '203.0.113.1')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    const body = init.body as URLSearchParams
    expect(body.get('secret')).toBe('my-secret')
    expect(body.get('response')).toBe('my-token')
    expect(body.get('remoteip')).toBe('203.0.113.1')
  })
})
