import { useEffect, useState } from 'react'
import { Forward, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Account, ForwardRule, Label } from '../../shared/types'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'
import { cn, labelStyle } from '../lib/utils'

interface ForwardRulesSettingsProps {
  accounts: Account[]
  labels: Label[]
}

export function ForwardRulesSettings({ accounts, labels }: ForwardRulesSettingsProps) {
  const { t } = useI18n()
  const imapAccounts = accounts.filter((account) => account.kind === 'imap')
  const [rules, setRules] = useState<ForwardRule[]>([])
  const [accountId, setAccountId] = useState(imapAccounts[0]?.id ?? '')
  const [labelId, setLabelId] = useState(labels[0]?.id ?? '')
  const [recipients, setRecipients] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .forwardRules()
      .then((response) => {
        if (!cancelled) {
          setRules(response.rules)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(errorText(reason, t))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [t])

  const effectiveAccountId = imapAccounts.some((account) => account.id === accountId)
    ? accountId
    : imapAccounts[0]?.id ?? ''
  const effectiveLabelId = labels.some((label) => label.id === labelId)
    ? labelId
    : labels[0]?.id ?? ''

  function resetForm() {
    setEditingId(null)
    setRecipients('')
    setEnabled(true)
    setError(null)
  }

  function startEdit(rule: ForwardRule) {
    setEditingId(rule.id)
    setAccountId(rule.accountId)
    setLabelId(rule.labelId)
    setRecipients(rule.recipients.join(', '))
    setEnabled(rule.enabled)
    setError(null)
    setMessage(null)
  }

  async function submit() {
    setError(null)
    setMessage(null)
    const parsedRecipients = [
      ...new Set(
        recipients
          .split(/[,;\n]/)
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
    ]
    if (!effectiveAccountId || !effectiveLabelId) {
      setError(t('forward.accountRequired'))
      return
    }
    if (parsedRecipients.length === 0) {
      setError(t('forward.recipientsRequired'))
      return
    }
    if (parsedRecipients.some((email) => !email.includes('@'))) {
      setError(t('forward.invalidRecipient'))
      return
    }
    setBusy(true)
    try {
      if (editingId) {
        const response = await api.updateForwardRule(editingId, {
          accountId: effectiveAccountId,
          labelId: effectiveLabelId,
          recipients: parsedRecipients,
          enabled,
        })
        setRules((current) =>
          current.map((item) => (item.id === editingId ? response.rule : item)),
        )
        setMessage(t('forward.updated'))
        resetForm()
      } else {
        const response = await api.createForwardRule({
          accountId: effectiveAccountId,
          labelId: effectiveLabelId,
          recipients: parsedRecipients,
          enabled,
        })
        setRules((current) => [...current, response.rule])
        setMessage(t('forward.created'))
        resetForm()
      }
    } catch (reason) {
      setError(errorText(reason, t))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(rule: ForwardRule) {
    try {
      const response = await api.updateForwardRule(rule.id, { enabled: !rule.enabled })
      setRules((current) => current.map((item) => (item.id === rule.id ? response.rule : item)))
    } catch (reason) {
      setError(errorText(reason, t))
    }
  }

  async function remove(rule: ForwardRule) {
    if (!window.confirm(t('forward.deleteConfirm'))) {
      return
    }
    try {
      await api.deleteForwardRule(rule.id)
      setRules((current) => current.filter((item) => item.id !== rule.id))
      setMessage(t('forward.deleted'))
    } catch (reason) {
      setError(errorText(reason, t))
    }
  }

  const inputClass =
    'w-full rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand'

  if (loading) {
    return <p className="mt-4 text-xs text-muted">{t('common.loading')}</p>
  }

  return (
    <div className="mt-6 rounded-2xl border border-line bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <Forward size={16} className="text-muted" />
        <p className="text-sm font-medium">{t('forward.title')}</p>
      </div>
      <p className="mb-4 text-[11px] text-muted">{t('forward.hint')}</p>

      {imapAccounts.length === 0 || labels.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">
          {t('forward.requirements')}
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {rules.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">
                {t('forward.empty')}
              </p>
            ) : null}
            {rules.map((rule) => {
              const account = accounts.find((item) => item.id === rule.accountId)
              const label = labels.find((item) => item.id === rule.labelId)
              return (
                <div
                  key={rule.id}
                  className={cn(
                    'flex flex-wrap items-start justify-between gap-2 rounded-xl border border-line px-3 py-2',
                    !rule.enabled && 'opacity-60',
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-700">
                      {account?.email ?? rule.accountId}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                      {label ? (
                        <span
                          className={cn('rounded px-1.5 py-0.5 font-medium', labelStyle(label.color))}
                        >
                          {label.name}
                        </span>
                      ) : null}
                      → {rule.recipients.join(', ')}
                    </p>
                    <p className="mt-1 text-[11px] text-muted">
                      {rule.lastStatus
                        ? `${t('forward.lastStatus')}: ${rule.lastStatus}${rule.lastError ? ` — ${rule.lastError}` : ''}`
                        : t('forward.neverRun')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void toggle(rule)}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[11px]',
                        rule.enabled
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-muted',
                      )}
                    >
                      {rule.enabled ? t('forward.enabled') : t('forward.disabled')}
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(rule)}
                      className="rounded-full p-1.5 text-muted hover:bg-slate-100"
                      aria-label={t('forward.edit')}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(rule)}
                      className="rounded-full p-1.5 text-muted hover:bg-red-50 hover:text-brand-strong"
                      aria-label={t('forward.delete')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-4 rounded-xl border border-line p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <Plus size={13} /> {editingId ? t('forward.edit') : t('forward.new')}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={effectiveAccountId}
                onChange={(event) => setAccountId(event.target.value)}
                className={inputClass}
              >
                {imapAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.email}
                  </option>
                ))}
              </select>
              <select
                value={effectiveLabelId}
                onChange={(event) => setLabelId(event.target.value)}
                className={inputClass}
              >
                {labels.map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.name}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={recipients}
              onChange={(event) => setRecipients(event.target.value)}
              placeholder={t('forward.recipients')}
              className={`${inputClass} mt-2`}
            />
            <label className="mt-2 flex items-center gap-2 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="h-3.5 w-3.5"
              />
              {t('forward.enabled')}
            </label>
            {error ? <p className="mt-2 text-xs text-brand-strong">{error}</p> : null}
            <div className="mt-3 flex justify-end gap-2">
              {editingId ? (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:bg-slate-50"
                >
                  {t('common.cancel')}
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {busy ? t('common.loading') : editingId ? t('common.save') : t('forward.create')}
              </button>
            </div>
          </div>
        </>
      )}

      {error && (imapAccounts.length === 0 || labels.length === 0) ? (
        <p className="mt-2 text-[11px] text-brand-strong">{error}</p>
      ) : null}
      {message ? <p className="mt-2 text-[11px] text-emerald-700">{message}</p> : null}
    </div>
  )
}
