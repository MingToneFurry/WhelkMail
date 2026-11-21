import {
  useEffect,
  useImperativeHandle,
  useRef,
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
  handleRef?: RefObject<RichTextEditorHandle | null>
  onChange: (html: string, text: string) => void
}

export function RichTextEditor({
  html,
  placeholder,
  className,
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
}

function ToolButton({
  label,
  onAction,
  children,
}: {
  label: string
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
      className="rounded p-1.5 text-muted hover:bg-slate-100 hover:text-slate-800"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

export function RichTextToolbar({ className, onCommand, onLink }: RichTextToolbarProps) {
  const { t } = useI18n()

  return (
    <div className={`flex flex-wrap items-center gap-0.5 ${className ?? ''}`}>
      <ToolButton label={t('compose.bold')} onAction={() => onCommand('bold')}>
        <Bold size={16} />
      </ToolButton>
      <ToolButton label={t('compose.italic')} onAction={() => onCommand('italic')}>
        <Italic size={16} />
      </ToolButton>
      <ToolButton label={t('compose.underline')} onAction={() => onCommand('underline')}>
        <Underline size={16} />
      </ToolButton>
      <ToolButton label={t('compose.strike')} onAction={() => onCommand('strikeThrough')}>
        <Strikethrough size={16} />
      </ToolButton>
      <span className="mx-1 h-4 w-px bg-line" />
      <ToolButton
        label={t('compose.bulletList')}
        onAction={() => onCommand('insertUnorderedList')}
      >
        <List size={16} />
      </ToolButton>
      <ToolButton
        label={t('compose.numberedList')}
        onAction={() => onCommand('insertOrderedList')}
      >
        <ListOrdered size={16} />
      </ToolButton>
      <ToolButton
        label={t('compose.quote')}
        onAction={() => onCommand('formatBlock', 'blockquote')}
      >
        <Quote size={16} />
      </ToolButton>
      <span className="mx-1 h-4 w-px bg-line" />
      <ToolButton label={t('compose.link')} onAction={onLink}>
        <Link2 size={16} />
      </ToolButton>
      <ToolButton
        label={t('compose.clearFormatting')}
        onAction={() => onCommand('removeFormat')}
      >
        <RemoveFormatting size={16} />
      </ToolButton>
    </div>
  )
}
