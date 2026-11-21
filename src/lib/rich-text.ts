const ALLOWED_TAGS = new Set([
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'STRIKE',
  'BR',
  'P',
  'DIV',
  'UL',
  'OL',
  'LI',
  'A',
  'BLOCKQUOTE',
])

const BLOCK_TAGS = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'TR'])

/** Marks the signature block so the composer can separate it from the body. */
export const SIGNATURE_ATTR = 'data-signature'

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function unwrap(node: Element): void {
  const parent = node.parentNode
  if (!parent) {
    return
  }
  while (node.firstChild) {
    parent.insertBefore(node.firstChild, node)
  }
  parent.removeChild(node)
}

function cleanNode(node: Element): void {
  if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') {
    node.remove()
    return
  }
  if (!ALLOWED_TAGS.has(node.tagName)) {
    // Keep the text and formatting of unknown wrappers, drop the wrapper.
    for (const child of Array.from(node.children)) {
      cleanNode(child)
    }
    unwrap(node)
    return
  }
  for (const attribute of Array.from(node.attributes)) {
    if (node.tagName === 'A' && attribute.name.toLowerCase() === 'href') {
      continue
    }
    if (node.tagName === 'DIV' && attribute.name.toLowerCase() === SIGNATURE_ATTR) {
      continue
    }
    node.removeAttribute(attribute.name)
  }
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? ''
    if (!/^(https?:|mailto:)/i.test(href.trim())) {
      unwrap(node)
      return
    }
  }
  for (const child of Array.from(node.children)) {
    cleanNode(child)
  }
}

/** Keep the subset of HTML an email composer produces, drop everything else. */
export function sanitizeComposeHtml(html: string): string {
  if (!html.trim()) {
    return ''
  }
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) {
    return ''
  }
  for (const child of Array.from(root.children)) {
    cleanNode(child)
  }
  return root.innerHTML
}

function textOfNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.nodeValue ?? '').replace(/\u00a0/g, ' ')
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ''
  }
  const element = node as Element
  if (element.tagName === 'BR') {
    return '\n'
  }
  const inner = Array.from(element.childNodes).map(textOfNode).join('')
  return BLOCK_TAGS.has(element.tagName) ? `\n${inner}\n` : inner
}

export function htmlToPlainText(html: string): string {
  if (!html.trim()) {
    return ''
  }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(doc.body.childNodes)
    .map(textOfNode)
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function plainTextToHtml(text: string): string {
  if (!text) {
    return ''
  }
  return escapeText(text).replace(/\r?\n/g, '<br>')
}

/**
 * Wraps the signature in a marked block. The marker survives sanitization and
 * lets the composer draw a separator and keep the signature styling isolated
 * from the message body.
 */
export function signatureBlockHtml(signatureHtml: string): string {
  const inner = signatureHtml.trim()
  if (!inner) {
    return ''
  }
  return `<div ${SIGNATURE_ATTR}="1">${inner}</div>`
}
