import { parseVersion } from '../../shared/version'
import type { Env } from '../_lib/env'
import { fail, json, readJson } from '../_lib/http'
import { getUpdateStatus, setUpdateDismissed } from '../_lib/update-check'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const refresh = new URL(context.request.url).searchParams.has('refresh')
  return json(await getUpdateStatus(context.env, refresh))
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: { version?: unknown } = {}
  try {
    body = await readJson<{ version?: unknown }>(context.request)
  } catch {
    body = {}
  }
  const version = typeof body.version === 'string' ? body.version.trim() : ''
  if (version.length > 64 || (version && !parseVersion(version))) {
    return fail('Invalid version', 400, undefined, 'invalid_version')
  }
  await setUpdateDismissed(context.env, version || null)
  return json(await getUpdateStatus(context.env))
}
