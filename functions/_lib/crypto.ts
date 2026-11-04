import type { Env } from './env'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return fromBase64(normalized + padding)
}

function rawKey(env: Env): Uint8Array<ArrayBuffer> {
  const key = fromBase64(env.TOKEN_ENC_KEY)
  if (key.length !== 32) {
    throw new Error('TOKEN_ENC_KEY deve essere una chiave base64 di 32 byte')
  }
  return key
}

async function aesKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey(env), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey(env), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

export async function encryptString(env: Env, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await aesKey(env),
    encoder.encode(value),
  )
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`
}

export async function decryptString(env: Env, value: string): Promise<string> {
  const [ivPart, dataPart] = value.split('.')
  if (!ivPart || !dataPart) {
    throw new Error('Token cifrato non valido')
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivPart) },
    await aesKey(env),
    fromBase64(dataPart),
  )
  return decoder.decode(plaintext)
}

export async function sign(env: Env, payload: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(env), encoder.encode(payload))
  return toBase64Url(new Uint8Array(signature))
}

export function safeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  if (left.length !== right.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < left.length; i += 1) {
    diff |= left[i] ^ right[i]
  }
  return diff === 0
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

export async function createSession(env: Env): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const signature = await sign(env, `session:${expires}`)
  return `${expires}.${signature}`
}

export async function verifySession(env: Env, token: string | null): Promise<boolean> {
  if (!token) {
    return false
  }
  const [expiresPart, signature] = token.split('.')
  const expires = Number(expiresPart)
  if (!expiresPart || !signature || !Number.isFinite(expires)) {
    return false
  }
  if (expires < Math.floor(Date.now() / 1000)) {
    return false
  }
  const expected = await sign(env, `session:${expires}`)
  return safeEqual(signature, expected)
}

export async function verifyPassword(env: Env, password: string): Promise<boolean> {
  if (!env.APP_PASSWORD) {
    return false
  }
  return safeEqual(password, env.APP_PASSWORD)
}

export async function createOAuthState(env: Env, accountId: string): Promise<string> {
  const payload = `${accountId}:${Math.floor(Date.now() / 1000)}`
  const encoded = toBase64Url(encoder.encode(payload))
  const signature = await sign(env, `oauth:${encoded}`)
  return `${encoded}.${signature}`
}

export async function verifyOAuthState(env: Env, state: string): Promise<string | null> {
  const [encoded, signature] = state.split('.')
  if (!encoded || !signature) {
    return null
  }
  const expected = await sign(env, `oauth:${encoded}`)
  if (!safeEqual(signature, expected)) {
    return null
  }
  let decoded = ''
  try {
    decoded = decoder.decode(fromBase64Url(encoded))
  } catch {
    return null
  }
  const [accountId, issuedAt] = decoded.split(':')
  if (!accountId || !issuedAt) {
    return null
  }
  const issued = Number(issuedAt)
  if (!Number.isFinite(issued) || Math.floor(Date.now() / 1000) - issued > 600) {
    return null
  }
  return accountId
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) {
    return null
  }
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) {
      return rest.join('=')
    }
  }
  return null
}

export function sessionCookie(token: string, secure: boolean): string {
  const attributes = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`
  return `mc_session=${token}; ${attributes}${secure ? '; Secure' : ''}`
}

export function clearedSessionCookie(secure: boolean): string {
  return `mc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}
