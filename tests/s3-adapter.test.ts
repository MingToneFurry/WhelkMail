import { createHash, createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { S3Bucket } from '../server/adapters/storage/s3'

afterEach(() => {
  vi.restoreAllMocks()
})

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

describe('S3 bucket adapter', () => {
  it('signs a path-style PUT with AWS Signature V4', async () => {
    const date = new Date('2026-01-02T03:04:05.000Z')
    const bucket = new S3Bucket(
      {
        endpoint: 'https://s3.example.com',
        bucket: 'mail',
        region: 'eu-central-1',
        accessKeyId: 'AKID',
        secretAccessKey: 'SECRET',
      },
      () => date,
    )

    let captured: { url: string; init: RequestInit } | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      captured = { url: String(input), init: init ?? {} }
      return new Response(null, { status: 200 })
    })

    await bucket.put('accounts/a/sent/b.eml', new TextEncoder().encode('hello'), {
      httpMetadata: { contentType: 'message/rfc822' },
    })

    expect(captured!.url).toBe('https://s3.example.com/mail/accounts/a/sent/b.eml')
    const headers = new Headers(captured!.init.headers)
    const amz = '20260102T030405Z'
    const short = '20260102'
    const payloadHash = sha256('hello')

    expect(headers.get('x-amz-date')).toBe(amz)
    expect(headers.get('x-amz-content-sha256')).toBe(payloadHash)
    expect(headers.get('content-type')).toBe('message/rfc822')

    const canonicalHeaders = [
      'content-type:message/rfc822',
      'host:s3.example.com',
      `x-amz-content-sha256:${payloadHash}`,
      `x-amz-date:${amz}`,
      '',
    ].join('\n')
    const signed = 'content-type;host;x-amz-content-sha256;x-amz-date'
    const canonicalRequest = [
      'PUT',
      '/mail/accounts/a/sent/b.eml',
      '',
      canonicalHeaders,
      signed,
      payloadHash,
    ].join('\n')
    const scope = `${short}/eu-central-1/s3/aws4_request`
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amz,
      scope,
      sha256(canonicalRequest),
    ].join('\n')
    const kDate = hmac('AWS4SECRET', short)
    const kRegion = hmac(kDate, 'eu-central-1')
    const kService = hmac(kRegion, 's3')
    const kSigning = hmac(kService, 'aws4_request')
    const signature = hmac(kSigning, stringToSign).toString('hex')

    expect(headers.get('authorization')).toBe(
      `AWS4-HMAC-SHA256 Credential=AKID/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
    )
  })

  it('returns null for a missing object and ignores a missing delete', async () => {
    const bucket = new S3Bucket({
      endpoint: 'http://minio:9000',
      bucket: 'mail',
      region: 'us-east-1',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }))

    await expect(bucket.get('missing.eml')).resolves.toBeNull()
    await expect(bucket.delete('missing.eml')).resolves.toBeUndefined()
  })
})
