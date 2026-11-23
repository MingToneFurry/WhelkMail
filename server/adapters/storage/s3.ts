/**
 * S3-compatible object storage exposed through the small subset of the R2
 * binding that the application uses (`put`, `get`, `delete`). That keeps the
 * existing `R2Storage` adapter unchanged: on Docker it simply receives this
 * object as `env.BUCKET`.
 *
 * Signing is a self-contained AWS Signature V4 implementation over `fetch` and
 * WebCrypto, so the image needs no SDK.
 */

const encoder = new TextEncoder()

export interface S3Config {
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  /** Path-style is the default because MinIO and most self-hosted gateways use it. */
  forcePathStyle?: boolean
}

export interface S3PutOptions {
  httpMetadata?: { contentType?: string }
}

export interface S3GetResult {
  body: ReadableStream<Uint8Array>
  httpMetadata: { contentType: string }
  size: number
}

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return toHex(new Uint8Array(digest))
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
  return new Uint8Array(signature)
}

async function signingKey(
  secret: string,
  date: string,
  region: string,
  service: string,
): Promise<Uint8Array> {
  const kDate = await hmac(encoder.encode(`AWS4${secret}`), date)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeSegment).join('/')
}

function amzDate(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

export class S3Bucket {
  private readonly config: Required<Omit<S3Config, 'sessionToken'>> & { sessionToken?: string }
  private readonly pathStyle: boolean
  private readonly hostHeader: string
  private readonly basePath: string
  private readonly clock: () => Date

  constructor(config: S3Config, clock: () => Date = () => new Date()) {
    this.clock = clock
    const endpoint = new URL(config.endpoint)
    this.config = {
      endpoint: config.endpoint,
      bucket: config.bucket,
      region: config.region || 'us-east-1',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      forcePathStyle: config.forcePathStyle ?? true,
      sessionToken: config.sessionToken,
    }
    this.pathStyle = this.config.forcePathStyle
    this.basePath = endpoint.pathname.replace(/\/+$/, '')
    this.hostHeader = this.pathStyle
      ? endpoint.host
      : `${config.bucket}.${endpoint.hostname}${endpoint.port ? `:${endpoint.port}` : ''}`
  }

  async put(key: string, data: Uint8Array, options?: S3PutOptions): Promise<void> {
    const contentType = options?.httpMetadata?.contentType
    await this.send('PUT', key, data, contentType)
  }

  async get(key: string): Promise<S3GetResult | null> {
    const response = await this.send('GET', key)
    if (response.status === 404) {
      return null
    }
    if (!response.ok || !response.body) {
      throw await this.error('GET', key, response)
    }
    return {
      body: response.body,
      httpMetadata: {
        contentType: response.headers.get('content-type') ?? 'message/rfc822',
      },
      size: Number(response.headers.get('content-length') ?? 0),
    }
  }

  async delete(key: string): Promise<void> {
    const response = await this.send('DELETE', key)
    if (response.status === 404) {
      return
    }
    if (!response.ok) {
      throw await this.error('DELETE', key, response)
    }
  }

  private requestUrl(key: string): { url: string; canonicalUri: string } {
    const encodedKey = encodeKey(key)
    if (this.pathStyle) {
      const canonicalUri = `${this.basePath}/${encodeSegment(this.config.bucket)}/${encodedKey}`
      const endpoint = new URL(this.config.endpoint)
      return { url: `${endpoint.origin}${canonicalUri}`, canonicalUri }
    }
    const canonicalUri = `${this.basePath}/${encodedKey}`
    const endpoint = new URL(this.config.endpoint)
    return {
      url: `${endpoint.protocol}//${this.hostHeader}${canonicalUri}`,
      canonicalUri,
    }
  }

  private async send(
    method: string,
    key: string,
    body?: Uint8Array,
    contentType?: string,
  ): Promise<Response> {
    const { url, canonicalUri } = this.requestUrl(key)
    const date = amzDate(this.clock())
    const shortDate = date.slice(0, 8)
    const payloadHash = await sha256Hex(body ?? new Uint8Array(0))

    const headers = new Headers()
    headers.set('x-amz-content-sha256', payloadHash)
    headers.set('x-amz-date', date)
    if (contentType) {
      headers.set('Content-Type', contentType)
    }
    if (this.config.sessionToken) {
      headers.set('x-amz-security-token', this.config.sessionToken)
    }

    const signedHeaderLines: string[] = [
      `host:${this.hostHeader}`,
      `x-amz-content-sha256:${payloadHash}`,
      `x-amz-date:${date}`,
    ]
    if (contentType) {
      signedHeaderLines.push(`content-type:${contentType}`)
    }
    if (this.config.sessionToken) {
      signedHeaderLines.push(`x-amz-security-token:${this.config.sessionToken}`)
    }
    signedHeaderLines.sort()
    const signedHeaders = signedHeaderLines
      .map((line) => line.slice(0, line.indexOf(':')))
      .join(';')
    const canonicalHeaders = `${signedHeaderLines.join('\n')}\n`

    const canonicalRequest = [
      method,
      canonicalUri,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n')

    const scope = `${shortDate}/${this.config.region}/s3/aws4_request`
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      date,
      scope,
      await sha256Hex(canonicalRequest),
    ].join('\n')

    const signing = await signingKey(
      this.config.secretAccessKey,
      shortDate,
      this.config.region,
      's3',
    )
    const signature = toHex(await hmac(signing, stringToSign))
    headers.set(
      'Authorization',
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    )

    return fetch(url, {
      method,
      headers,
      body: body ? (body as unknown as BodyInit) : undefined,
    })
  }

  private async error(method: string, key: string, response: Response): Promise<Error> {
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 500)
    } catch {
      // ignore
    }
    return new Error(
      `S3 ${method} ${this.config.bucket}/${key} failed with ${response.status}${detail ? `: ${detail}` : ''}`,
    )
  }
}

export function createS3Bucket(config: S3Config): S3Bucket {
  return new S3Bucket(config)
}
