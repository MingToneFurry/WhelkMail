import type { FormEvent } from 'react'
import { useState } from 'react'
import { Mail } from 'lucide-react'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'
import { LocaleToggle } from './LocaleToggle'

interface LoginProps {
  onSuccess: () => void
}

export function Login({ onSuccess }: LoginProps) {
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.login(password)
      onSuccess()
    } catch (err) {
      setError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4">
      <div className="mb-4 flex w-full max-w-sm justify-end">
        <LocaleToggle />
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand">
            <Mail size={22} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{t('app.name')}</h1>
            <p className="text-xs text-muted">{t('login.subtitle')}</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-muted">{t('login.password')}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              required
              className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </label>
          {error ? <p className="text-sm text-brand-strong">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
          >
            {busy ? t('login.busy') : t('login.submit')}
          </button>
        </form>
      </div>
    </div>
  )
}
