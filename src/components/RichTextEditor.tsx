import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Type,
  Underline,
} from 'lucide-react'
import { useI18n } from '../i18n'
import { htmlToPlainText, plainTextToHtml, sanitizeComposeHtml } from '../lib/rich-text'

export interface RichTextEditorHandle {
  command: (name: string, value?: string) => void
  createLink: () => void
  focus: () => void
}

interface RichTextEditorProps {
  html: string
  placeholder?: string
  className?: string
  autoFocus?: boolean
  handleRef?: RefObject<RichTextEditorHandle | null>
  onChange: (html: string, text: string) => void
}

export function RichTextEditor({
  html,
  placeholder,
  className,
  autoFocus,
  handleRef,
  onChange,
}: RichTextEditorProps) {
  const { t } = useI18n()
  const editorRef = useRef<HTMLDivElement>(null)
  const lastEmitted = useRef<string | null>(null)
  const savedRange = useRef<Range | null>(null)

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    // Echo of our own change: resetting innerHTML here would move the caret.
    if (lastEmitted.current !== null && html === lastEmitted.current) {
      return
    }
    if (editor.innerHTML !== html) {
      editor.innerHTML = html
    }
  }, [html])

  useEffect(() => {
    if (!autoFocus) {
      return
    }
    const editor = editorRef.current
    if (!editor) {
      return
    }
    // Start writing at the top, in the empty body paragraph above an existing
    // signature, so the signature's formatting is never inherited.
    editor.focus()
    const range = document.createRange()
    const first = editor.firstElementChild
    if (first) {
      range.selectNodeContents(first)
    } else {
      range.selectNodeContents(editor)
    }
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [autoFocus])

  useEffect(() => {
    function saveSelection() {
      const editor = editorRef.current
      const selection = window.getSelection()
      if (
        !editor ||
        !selection ||
        selection.rangeCount === 0 ||
        !editor.contains(selection.anchorNode)
      ) {
        return
      }
      savedRange.current = selection.getRangeAt(0).cloneRange()
    }
    document.addEventListener('selectionchange', saveSelection)
    return () => document.removeEventListener('selectionchange', saveSelection)
  }, [])

  function emit() {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    const clean = sanitizeComposeHtml(editor.innerHTML)
    lastEmitted.current = clean
    onChange(clean, htmlToPlainText(clean))
  }

  function restoreSelection() {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    editor.focus()
    const selection = window.getSelection()
    if (!selection) {
      return
    }
    const range = savedRange.current
    if (range && editor.contains(range.commonAncestorContainer)) {
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }
    // No usable range: do not leave a stale selection that would make the next
    // command wrap the whole signature in <b>. Put the caret at the end instead.
    const end = document.createRange()
    end.selectNodeContents(editor)
    end.collapse(false)
    selection.removeAllRanges()
    selection.addRange(end)
  }

  function command(name: string, value?: string) {
    restoreSelection()
    // Prefer tags (<b>, <u>) over inline styles: the sanitizer keeps those and
    // email clients render them consistently.
    try {
      document.execCommand('styleWithCSS', false, 'false')
    } catch {
      // Older browsers only support the default mode.
    }
    document.execCommand(name, false, value)
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      savedRange.current = selection.getRangeAt(0).cloneRange()
    }
    emit()
  }

  function createLink() {
    const url = window.prompt(t('compose.linkPrompt'), 'https://')
    if (!url || !/^(https?:|mailto:)/i.test(url.trim())) {
      return
    }
    command('createLink', url.trim())
  }

  useImperativeHandle(handleRef, () => ({
    command,
    createLink,
    focus: restoreSelection,
  }))

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault()
    const rich = event.clipboardData.getData('text/html')
    const plain = event.clipboardData.getData('text/plain')
    if (rich) {
      document.execCommand('insertHTML', false, sanitizeComposeHtml(rich))
    } else {
      document.execCommand('insertHTML', false, plainTextToHtml(plain))
    }
    emit()
  }

  return (
    <div
      ref={editorRef}
      contentEditable
      role="textbox"
      aria-multiline="true"
      data-placeholder={placeholder}
      onInput={emit}
      onBlur={emit}
      onPaste={handlePaste}
      className={
        className ??
        'rich-editor min-h-48 flex-1 overflow-y-auto px-5 py-4 text-sm leading-6 outline-none'
      }
    />
  )
}

interface RichTextToolbarProps {
  className?: string
  onCommand: (name: string, value?: string) => void
  onLink: () => void
  onTogglePlainText?: () => void
}

/**
 * The formatting that applies at the caret. The toolbar uses it to highlight
 * the active buttons, so bold text shows an active bold button instead of the
 * toolbar looking identical whatever the cursor is doing.
 */
interface FormatState {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  bulletList: boolean
  orderedList: boolean
  quote: boolean
  link: boolean
}

const EMPTY_FORMAT_STATE: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  bulletList: false,
  orderedList: false,
  quote: false,
  link: false,
}

function queryCommandState(name: string): boolean {
  try {
    return document.queryCommandState(name)
  } catch {
    return false
  }
}

function readFormatState(): FormatState {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return EMPTY_FORMAT_STATE
  }
  const anchor = selection.anchorNode
  const element = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null)
  // Ignore selections outside an editable body (subject, recipients, inputs).
  if (
    !element ||
    !element.closest(
      '[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]',
    )
  ) {
    return EMPTY_FORMAT_STATE
  }
  let quote = false
  let link = false
  let node: Node | null = element
  while (node) {
    if (node instanceof HTMLElement) {
      if (node.tagName === 'BLOCKQUOTE') {
        quote = true
      }
      if (node.tagName === 'A') {
        link = true
      }
    }
    node = node.parentNode
  }
  try {
    if (String(document.queryCommandValue('formatBlock')).toLowerCase().includes('blockquote')) {
      quote = true
    }
  } catch {
    // Older browsers may not support formatBlock values.
  }
  return {
    bold: queryCommandState('bold'),
    italic: queryCommandState('italic'),
    underline: queryCommandState('underline'),
    strike: queryCommandState('strikeThrough'),
    bulletList: queryCommandState('insertUnorderedList'),
    orderedList: queryCommandState('insertOrderedList'),
    quote,
    link,
  }
}

function useFormatState() {
  const [state, setState] = useState<FormatState>(EMPTY_FORMAT_STATE)
  useEffect(() => {
    const update = () => setState(readFormatState())
    update()
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [])
  return { state, refresh: () => setState(readFormatState()) }
}

function ToolButton({
  label,
  active,
  onAction,
  children,
}: {
  label: string
  active?: boolean
  onAction: () => void
  children: ReactNode
}) {
  function runPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    // Run on pointerdown: the selection dies on click because the button takes
    // focus, which made "bold" wrap the entire signature or do nothing.
    event.preventDefault()
    onAction()
  }
  function runKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onAction()
    }
  }
  return (
    <button
      type="button"
      onPointerDown={runPointer}
      onKeyDown={runKey}
      className={`rounded p-1.5 ${
        active
          ? 'bg-slate-200 text-slate-900'
          : 'text-muted hover:bg-slate-100 hover:text-slate-800'
      }`}
      aria-label={label}
      aria-pressed={active ?? false}
      title={label}
    >
      {children}
    </button>
  )
}

export function RichTextToolbar({
  className,
  onCommand,
  onLink,
  onTogglePlainText,
}: RichTextToolbarProps) {
  const { t } = useI18n()
  const { state, refresh } = useFormatState()

  function run(name: string, value?: string) {
    onCommand(name, value)
    refresh()
  }

  function runLink() {
    onLink()
    refresh()
  }

  return (
    <div className={`flex flex-wrap items-center gap-0.5 ${className ?? ''}`}>
      <ToolButton label={t('compose.bold')} active={state.bold} onAction={() => run('bold')}>
        <Bold size={16} />
      </ToolButton>
      <ToolButton label={t('compose.italic')} active={state.italic} onAction={() => run('italic')}>
        <Italic size={16} />
      </ToolButton>
      <ToolButton
        label={t('compose.underline')}
        active={state.underline}
        onAction={() => run('underline')}
      >
        <Underline size={16} />
      </ToolButton>
      <ToolButton
        label={t('compose.strike')}
        active={state.strike}
        onAction={() => run('strikeThrough')}
      >
        <Strikethrough size={16} />
      </ToolButton>
      <span className="mx-1 h-4 w-px bg-line" />
      <ToolButton
        label={t('compose.bulletList')}
        active={state.bulletList}
        onAction={() => run('insertUnorderedList')}
      >
        <List size={16} />
      </ToolButton>
      <ToolButton
        label={t('compose.numberedList')}
        active={state.orderedList}
        onAction={() => run('insertOrderedList')}
      >
        <ListOrdered size={16} />
      </ToolButton>
      <ToolButton
        label={t('compose.quote')}
        active={state.quote}
        onAction={() => run('formatBlock', 'blockquote')}
      >
        <Quote size={16} />
      </ToolButton>
      <span className="mx-1 h-4 w-px bg-line" />
      <ToolButton label={t('compose.link')} active={state.link} onAction={runLink}>
        <Link2 size={16} />
      </ToolButton>
      <ToolButton
        label={t('compose.clearFormatting')}
        onAction={() => run('removeFormat')}
      >
        <RemoveFormatting size={16} />
      </ToolButton>
      {onTogglePlainText ? (
        <>
          <span className="mx-1 h-4 w-px bg-line" />
          <ToolButton label={t('compose.plainTextMode')} onAction={onTogglePlainText}>
            <Type size={16} />
          </ToolButton>
        </>
      ) : null}
    </div>
  )
}
