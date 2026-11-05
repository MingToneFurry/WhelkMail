import { forwardRuleCreateSchema } from '../../../shared/schemas'
import type { Env } from '../../_lib/env'
import { listForwardRules, toForwardRule, type ForwardRuleRow } from '../../_lib/forward'
import { fail, json, readJson } from '../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url)
    return json({
      rules: await listForwardRules(context.env, url.searchParams.get('accountId') ?? undefined),
    })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const parsed = forwardRuleCreateSchema.safeParse(await readJson<unknown>(context.request))
    if (!parsed.success) {
      return fail(
        'Invalid forward rule',
        400,
        parsed.error.issues.map((issue) => issue.message).join('; '),
        'forward_rule_invalid',
      )
    }
    const input = parsed.data
    const account = await context.env.DB.prepare('SELECT id, kind FROM accounts WHERE id = ?')
      .bind(input.accountId)
      .first<{ id: string; kind: string }>()
    if (!account) {
      return fail('Account not found', 404, undefined, 'account_not_found')
    }
    if (account.kind !== 'imap') {
      return fail('Forward rules require an IMAP account', 400, undefined, 'forward_unsupported')
    }
    const label = await context.env.DB.prepare('SELECT id FROM labels WHERE id = ?')
      .bind(input.labelId)
      .first<{ id: string }>()
    if (!label) {
      return fail('Label not found', 404, undefined, 'label_not_found')
    }
    const recipients = [...new Set(input.recipients.map((email) => email.trim().toLowerCase()))]
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await context.env.DB.prepare(
      `INSERT INTO forward_rules (id, account_id, label_id, recipients_json, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        input.accountId,
        input.labelId,
        JSON.stringify(recipients),
        input.enabled === false ? 0 : 1,
        now,
        now,
      )
      .run()
    const row = await context.env.DB.prepare('SELECT * FROM forward_rules WHERE id = ?')
      .bind(id)
      .first<ForwardRuleRow>()
    if (!row) {
      return fail('Internal error', 500, undefined, 'internal')
    }
    return json({ rule: toForwardRule(row) }, 201)
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}
