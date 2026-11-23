import { configExportSchema } from '../../../shared/schemas'
import {
  buildConfigBundle,
  ConfigTransferError,
  encryptConfigBundle,
} from '../../_lib/config-transfer'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

/**
 * Builds the portable configuration bundle and returns it encrypted with a
 * passphrase, so the downloaded file is safe at rest and importable by an
 * installation that uses a different `TOKEN_ENC_KEY`.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await readJson<unknown>(context.request)
    const parsed = configExportSchema.safeParse(body)
    if (!parsed.success) {
      return fail(
        'Invalid passphrase',
        400,
        parsed.error.issues.map((issue) => issue.message).join('; '),
        'config_invalid',
      )
    }
    const bundle = await buildConfigBundle(context.env)
    const envelope = await encryptConfigBundle(parsed.data.passphrase, bundle)
    return json(envelope, 200, {
      'Content-Disposition': 'attachment; filename="whelkmail-config.json"',
    })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    if (error instanceof ConfigTransferError) {
      return fail(error.message, 400, undefined, error.code)
    }
    console.error('[config export] failed:', error)
    return fail(
      'Internal error',
      500,
      error instanceof Error ? error.message : undefined,
      'internal',
    )
  }
}
