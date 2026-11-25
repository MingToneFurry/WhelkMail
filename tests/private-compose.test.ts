import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Compose } from '../src/components/Compose'
import { I18nProvider } from '../src/i18n'
import type { Account } from '../shared/types'

const relay = { id: 'relay', email: 'hub@example.org', kind: 'relay', relayAnyAddress: true } as Account
const base: ComponentProps<typeof Compose> = {
  accounts: [relay],
  privacyDomain: 'example.org',
  draftStorageAccount: relay,
  contacts: [],
  onAddContact: async () => null,
  defaultAccountId: relay.id,
  maxAttachmentBytes: 1000,
  defaultSignature: 'Private name <personal@gmail.com>',
  defaultSignatureHtml: '',
  signatureMode: 'shared',
  composeRichDefault: false,
  initialDraft: null,
  seed: null,
  onClose() {}, onSent() {}, onSaved() {}, onDeleted() {},
}

describe('privacy-mode composer', () => {
  const fields = { accountId: relay.id, to: [], cc: [], bcc: [], subject: 'Hello', text: '' }
  it.each([
    { seed: { ...fields, fromEmail: 'shop@example.org' }, initialDraft: null },
    { seed: null, initialDraft: { ...fields, id: 'draft', html: null, attachments: [] } },
    { seed: null, initialDraft: null },
  ])('requires a sender choice without putting the global signature into the message', overrides => {
    const compose = createElement(Compose, { ...base, ...overrides })
    const html = renderToStaticMarkup(createElement(I18nProvider, { children: compose }))
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="发送"/)
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="保存草稿"/)
    expect(html).not.toContain('personal@gmail.com')
    if (overrides.seed) expect(html).toContain('使用 shop@example.org 发信')
  })
})
