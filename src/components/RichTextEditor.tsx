import { useEffect, useRef, type ClipboardEvent } from 'react'
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

interface RichTextEditorProps {
  html: string
  placeholder?: string
  onChange: (html: string, text: string) => void
}

export function RichTextEditor({ html, placeholder, onChange }: RichTextEditorProps) {
  const { t } = useI18n()
  const editorRef = useRef<HTMLDivElement>(null)
  const lastEmitted = useRef<string | null>(null)

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

  function emit() {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    const clean = sanitizeComposeHtml(editor.innerHTML)
    lastEmitted.current = clean
    onChange(clean, htmlToPlainText(clean))
  }

  function command(name: string, value?: string) {
    editorRef.current?.focus()
    // Prefer tags (<b>, <u>) over inline styles: the sanitizer keeps those and
    // email clients render them consistently.
    try {
      document.execCommand('styleWithCSS', false, 'false')
    } catch {
      // Older browsers only support the default mode.
    }
    document.execCommand(name, false, value)
    emit()
  }

  function addLink() {
    const url = window.prompt(t('compose.linkPrompt'), 'https://')
    if (!url || !/^(https?:|mailto:)/i.test(url.trim())) {
      return
    }
    command('createLink', url.trim())
  }

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

  const buttonClass =
    'rounded p-1.5 text-muted hover:bg-slate-100 hover:text-slate-800'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-3 py-1">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => command('bold')}
          className={buttonClass}
          aria-label={t('compose.bold')}
          title={t('compose.bold')}
        >
          <Bold size={16} />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => command('italic')}
          className={buttonClass}
          aria-label={t('compose.italic')}
          title={t('compose.italic')}
        >
          <Italic size={16} />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => command('underline')}
          className={buttonClass}
          aria-label={t('compose.underline')}
          title={t('compose.underline')}
        >
          <Underline size={16} />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => command('strikeThrough')}
          className={buttonClass}
          aria-label={t('compose.strike')}
          title={t('compose.strike')}
        >
          <Strikethrough size={16} />
        </button>
        <span className="mx-1 h-4 w-px bg-line" />
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => command('insertUnorderedList')}
          className={buttonClass}
          aria-label={t('compose.bulletList')}
          title={t('compose.bulletList')}
        >
          <List size={16} />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => command('insertOrderedList')}
          className={buttonClass}
          aria-label={t('compose.numberedList')}
          title={t('compose.numberedList')}
        >
          <ListOrdered size={16} />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => command('formatBlock', 'blockquote')}
          className={buttonClass}
          aria-label={t('compose.quote')}
          title={t('compose.quote')}
        >
          <Quote size={16} />
        </button>
        <span className="mx-1 h-4 w-px bg-line" />
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={addLink}
          className={buttonClass}
          aria-label={t('compose.link')}
          title={t('compose.link')}
        >
          <Link2 size={16} />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => command('removeFormat')}
          className={buttonClass}
          aria-label={t('compose.clearFormatting')}
          title={t('compose.clearFormatting')}
        >
          <RemoveFormatting size={16} />
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        onPaste={handlePaste}
        className="rich-editor min-h-48 flex-1 overflow-y-auto px-5 py-4 text-sm leading-6 outline-none"
      />
    </div>
  )
}
