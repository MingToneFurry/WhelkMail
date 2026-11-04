import { createSession, sessionCookie, verifyPassword } from '../../_lib/crypto'
import type { Env } from '../../_lib/env'
import { fail, isSecure, json, readJson } from '../../_lib/http'

interface LoginBody {
  password?: string
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = await readJson<LoginBody>(context.request)
  if (!body.password || !(await verifyPassword(context.env, body.password))) {
    return fail('Invalid password', 401, undefined, 'login_failed')
  }
  const token = await createSession(context.env)
  return json({ ok: true }, 200, {
    'Set-Cookie': sessionCookie(token, isSecure(context.request)),
  })
}
