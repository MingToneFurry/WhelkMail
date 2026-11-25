import { describe, expect, it } from 'vitest'
import { handleRequest } from '../server/app'
import type { Env } from '../functions/_lib/env'
import { passwordGuard } from '../functions/_lib/password-guard'

function envWith(password: string | undefined): Env {
  return { APP_PASSWORD: password } as unknown as Env
}

describe('password guard', () => {
  it('lets a real password through', () => {
    expect(passwordGuard(envWith('a-strong-password-9'), '/api/accounts')).toBeNull()
  })

  it('answers JSON for an API call when the password is the example value', async () => {
    const response = passwordGuard(envWith('change-me'), '/api/accounts')

    expect(response?.status).toBe(503)
    expect(response?.headers.get('Content-Type')).toContain('application/json')
    expect(await response?.json()).toMatchObject({ code: 'app_password_insecure' })
  })

  it('answers HTML in Simplified Chinese by default', async () => {
    const response = passwordGuard(envWith('short'), '/')

    expect(response?.status).toBe(503)
    expect(response?.headers.get('Content-Type')).toContain('text/html')
    expect(await response?.text()).toContain('APP_PASSWORD 长度不足。')
  })

  it('localizes the cached password issue for each request', async () => {
    const env = envWith('change-me')
    const english = passwordGuard(env, '/api/accounts', 'en-GB')
    const italian = passwordGuard(env, '/api/accounts', 'en;q=0.4, it-IT;q=0.9')
    expect(await english?.json()).toMatchObject({ detail: 'APP_PASSWORD still uses an example value.' })
    expect(italian?.headers.get('Content-Language')).toBe('it')
    expect(await italian?.json()).toMatchObject({ detail: 'APP_PASSWORD contiene ancora una password di esempio.' })
  })

  it('keeps the health endpoint reachable so monitoring still works', () => {
    expect(passwordGuard(envWith('change-me'), '/api/health')).toBeNull()
  })

  it('blocks the login endpoint too: the weak password must not be usable', () => {
    expect(passwordGuard(envWith('change-me'), '/api/auth/login')?.status).toBe(503)
  })
})

describe('Workers request path', () => {
  it('refuses an API call before touching the database', async () => {
    // The Node entry refuses to start; Workers has no startup hook, so the same
    // policy has to happen here.
    const response = await handleRequest(
      new Request('https://mail.example/api/accounts'),
      envWith('change-me'),
      { waitUntil: () => undefined },
    )

    expect(response.status).toBe(503)
    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  })

  it('does not block the health endpoint', async () => {
    const response = await handleRequest(
      new Request('https://mail.example/api/health'),
      envWith('change-me'),
      { waitUntil: () => undefined },
    )

    expect(response.status).not.toBe(503)
  })
})
