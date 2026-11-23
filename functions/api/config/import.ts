import { configImportSchema } from '../../../shared/schemas'
import {
  applyConfigBundle,
  ConfigTransferError,
  decryptConfigBundle,
} from '../../_lib/config-transfer'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

/**
 * Restores a configuration bundle produced by `/api/config/export`.
 *
 * The passphrase decrypts the file, the account secrets are re-encrypted with
 * this deployment's `TOKEN_ENC_KEY`, and the configuration tables are replaced.
 * The mail mirror is cleared (it is rebuilt from the providers) but sessions and
 * two-factor settings are left untouched.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await readJson<unknown>(context.request)
    const parsed = configImportSchema.safeParse(body)
    if (!parsed.success) {
      return fail(
        'Invalid import request',
        400,
        parsed.error.issues.map((issue) => issue.message).join('; '),
        'config_invalid',
      )
    }
    try {
      const bundle = await decryptConfigBundle(parsed.data.passphrase, parsed.data.payload)
      return json(await applyConfigBundle(context.env, bundle))
    } catch (error) {
      if (error instanceof ConfigTransferError) {
        return fail(error.message, 400, undefined, error.code)
      }
      throw error
    }
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    console.error('[config import] failed:', error)
    return fail(
      'Internal error',
      500,
      error instanceof Error ? error.message : undefined,
      'internal',
    )
  }
}
