import { clearedSessionCookie } from '../../_lib/crypto'
import type { Env } from '../../_lib/env'
import { isSecure, json } from '../../_lib/http'

export const onRequestPost: PagesFunction<Env> = async (context) => {
  return json({ ok: true }, 200, {
    'Set-Cookie': clearedSessionCookie(isSecure(context.request)),
  })
}
