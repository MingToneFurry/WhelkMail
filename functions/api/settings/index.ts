import { appSettingsSchema } from '../../../shared/schemas'
import type { AppSettings } from '../../../shared/types'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'

const DEFAULT_SIGNATURE_KEY = 'default_signature'

export async function getSettings(env: Env): Promise<AppSettings> {
  const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(DEFAULT_SIGNATURE_KEY)
    .first<{ value: string }>()
  return { defaultSignature: row?.value ?? '' }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  return json(await getSettings(context.env))
}

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const body = await readJson<unknown>(context.request)
  const parsed = appSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'Invalid settings',
      400,
      parsed.error.issues.map((issue) => issue.message).join('; '),
      'settings_invalid',
    )
  }
  if (parsed.data.defaultSignature !== undefined) {
    await context.env.DB.prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
      .bind(DEFAULT_SIGNATURE_KEY, parsed.data.defaultSignature)
      .run()
  }
  return json(await getSettings(context.env))
}
