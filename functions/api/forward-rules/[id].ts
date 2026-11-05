import { forwardRuleUpdateSchema } from '../../../shared/schemas'
import type { Env } from '../../_lib/env'
import { parseRecipients, toForwardRule, type ForwardRuleRow } from '../../_lib/forward'
import { fail, json, readJson } from '../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  try {
    const id = context.params.id as string
    const row = await context.env.DB.prepare('SELECT * FROM forward_rules WHERE id = ?')
      .bind(id)
      .first<ForwardRuleRow>()
    if (!row) {
      return fail('Forward rule not found', 404, undefined, 'forward_rule_not_found')
    }
    const parsed = forwardRuleUpdateSchema.safeParse(await readJson<unknown>(context.request))
    if (!parsed.success) {
      return fail(
        'Invalid forward rule',
        400,
        parsed.error.issues.map((issue) => issue.message).join('; '),
        'forward_rule_invalid',
      )
    }
    const input = parsed.data
    const accountId = input.accountId ?? row.account_id
    const labelId = input.labelId ?? row.label_id
    if (input.accountId || input.labelId) {
      const account = await context.env.DB.prepare('SELECT id, kind FROM accounts WHERE id = ?')
        .bind(accountId)
        .first<{ id: string; kind: string }>()
      if (!account || account.kind !== 'imap') {
        return fail('IMAP account not found', 404, undefined, 'account_not_found')
      }
      const label = await context.env.DB.prepare('SELECT id FROM labels WHERE id = ?')
        .bind(labelId)
        .first<{ id: string }>()
      if (!label) {
        return fail('Label not found', 404, undefined, 'label_not_found')
      }
    }
    const recipients = input.recipients
      ? [...new Set(input.recipients.map((email) => email.trim().toLowerCase()))]
      : parseRecipients(row.recipients_json)
    await context.env.DB.prepare(
      `UPDATE forward_rules SET account_id = ?, label_id = ?, recipients_json = ?, enabled = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(
        accountId,
        labelId,
        JSON.stringify(recipients),
        input.enabled === undefined ? row.enabled : input.enabled ? 1 : 0,
        new Date().toISOString(),
        id,
      )
      .run()
    const updated = await context.env.DB.prepare('SELECT * FROM forward_rules WHERE id = ?')
      .bind(id)
      .first<ForwardRuleRow>()
    if (!updated) {
      return fail('Forward rule not found', 404, undefined, 'forward_rule_not_found')
    }
    return json({ rule: toForwardRule(updated) })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  try {
    const id = context.params.id as string
    const row = await context.env.DB.prepare('SELECT id FROM forward_rules WHERE id = ?')
      .bind(id)
      .first<{ id: string }>()
    if (!row) {
      return fail('Forward rule not found', 404, undefined, 'forward_rule_not_found')
    }
    await context.env.DB.batch([
      context.env.DB.prepare('DELETE FROM forward_log WHERE rule_id = ?').bind(id),
      context.env.DB.prepare('DELETE FROM forward_rules WHERE id = ?').bind(id),
    ])
    return json({ ok: true })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}
