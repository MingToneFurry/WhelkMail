import { describe, expect, it } from 'vitest'
import {
  accountRowForExport,
  accountRowForImport,
  CONFIG_FORMAT,
  CONFIG_VERSION,
  ConfigTransferError,
  decryptConfigBundle,
  encryptConfigBundle,
  type ConfigBundle,
} from '../functions/_lib/config-transfer'
import { decryptString, encryptString } from '../functions/_lib/crypto'
import type { Env } from '../functions/_lib/env'

function testEnv(): Env {
  return { TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString('base64') } as unknown as Env
}

function emptyBundle(): ConfigBundle {
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    createdAt: '2026-01-01T00:00:00.000Z',
    data: {
      accounts: [],
      labels: [],
      filters: [],
      contacts: [],
      pushPrefs: [],
      settings: [{ key: 'allow_remote_images', value: '1' }],
    },
  }
}

describe('config bundle encryption', () => {
  it('round-trips a bundle with the passphrase', async () => {
    const bundle = emptyBundle()
    const envelope = await encryptConfigBundle('correct horse battery', bundle)
    expect(envelope.format).toBe(CONFIG_FORMAT)
    // Cloudflare Workers rejects PBKDF2 above 100,000 iterations.
    expect(envelope.kdf.iterations).toBeLessThanOrEqual(100_000)
    expect(envelope.ciphertext).not.toContain('allow_remote_images')
    const restored = await decryptConfigBundle('correct horse battery', envelope)
    expect(restored.data.settings).toEqual(bundle.data.settings)
  })

  it('rejects a wrong passphrase', async () => {
    const envelope = await encryptConfigBundle('correct horse battery', emptyBundle())
    await expect(decryptConfigBundle('wrong passphrase', envelope)).rejects.toMatchObject({
      code: 'config_passphrase',
    })
  })

  it('rejects unknown formats', async () => {
    await expect(decryptConfigBundle('whatever', { format: 'other' })).rejects.toBeInstanceOf(
      ConfigTransferError,
    )
  })
})

describe('account secret portability', () => {
  it('decrypts secrets on export and re-encrypts them on import', async () => {
    const env = testEnv()
    const encryptedSecret = await encryptString(env, 'imap-password')
    const row = {
      id: 'account-1',
      email: 'user@example.com',
      secret_enc: encryptedSecret,
      relay_api_key_enc: null,
    }

    const exported = await accountRowForExport(env, row)
    expect(exported.secret_enc).toBeUndefined()
    expect(exported.secrets).toEqual({ secret: 'imap-password' })

    const restored = await accountRowForImport(env, exported)
    expect(restored.secrets).toBeUndefined()
    expect(restored.relay_api_key_enc).toBeNull()
    expect(typeof restored.secret_enc).toBe('string')
    expect(restored.secret_enc).not.toBe(encryptedSecret)
    expect(await decryptString(env, restored.secret_enc as string)).toBe('imap-password')
  })

  it('keeps null secrets null', async () => {
    const env = testEnv()
    const restored = await accountRowForImport(env, { id: 'a', secret_enc: null })
    expect(restored.secret_enc).toBeNull()
  })
})
