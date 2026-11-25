import { preferredLocale, type RequestLocale } from '../../shared/request-locale'
import { appPasswordIssue, MIN_APP_PASSWORD_LENGTH, type PasswordIssue } from '../../shared/app-password'
import type { Env } from './env'

/** The health endpoint remains available to report a misconfigured deployment. */
const HEALTH_PATH = '/api/health'
const text = {
  'zh-CN': {
    title: 'WhelkMail 登录密码配置有误',
    empty: 'APP_PASSWORD 尚未设置。',
    example: 'APP_PASSWORD 仍在使用示例密码。',
    short: 'APP_PASSWORD 长度不足。',
    instruction: `请为当前部署设置至少 ${MIN_APP_PASSWORD_LENGTH} 个字符的登录密码。`,
    pages: '打开项目设置中的“变量和机密”（Variables and Secrets）。',
    docker: '编辑 deploy/docker/.env 中的 APP_PASSWORD。',
    unavailable: '更正配置后即可使用 WhelkMail。',
  },
  en: {
    title: 'WhelkMail is not configured correctly',
    empty: 'APP_PASSWORD is empty.',
    example: 'APP_PASSWORD still uses an example value.',
    short: 'APP_PASSWORD is too short.',
    instruction: `Set a login password of at least ${MIN_APP_PASSWORD_LENGTH} characters.`,
    pages: 'Open the project settings and select Variables and Secrets.',
    docker: 'Set APP_PASSWORD in deploy/docker/.env.',
    unavailable: 'The application stays unavailable until this is fixed.',
  },
  it: {
    title: 'La password di accesso a WhelkMail non è configurata correttamente',
    empty: 'APP_PASSWORD è vuota.',
    example: 'APP_PASSWORD contiene ancora una password di esempio.',
    short: 'APP_PASSWORD è troppo corta.',
    instruction: `Imposta una password di accesso di almeno ${MIN_APP_PASSWORD_LENGTH} caratteri.`,
    pages: 'Apri le impostazioni del progetto e seleziona Variables and Secrets.',
    docker: 'Imposta APP_PASSWORD nel file deploy/docker/.env.',
    unavailable: 'WhelkMail sarà disponibile dopo la correzione.',
  },
}
function html(locale: RequestLocale, issue: PasswordIssue): string {
  const copy = text[locale]
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${copy.title}</title>
<style>body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;margin:0;padding:2.5rem 1.25rem;background:#fff7f2;color:#202124}main{max-width:38rem;margin:0 auto;background:#fff;border:1px solid #f0ded6;border-radius:16px;padding:1.75rem}h1{font-size:1.1rem;margin:0 0 .75rem}p{font-size:.9rem;line-height:1.5;margin:.5rem 0}code{background:#f6f6f6;border-radius:4px;padding:.1rem .3rem;font-size:.85em}ul{font-size:.9rem;line-height:1.6;margin:.5rem 0 0;padding-left:1.2rem}</style></head>
<body><main><h1>${copy.title}</h1><p>${copy[issue]}</p><p>${copy.instruction}</p>
<ul><li><strong>Workers</strong> · <code>npx wrangler secret put APP_PASSWORD</code></li>
<li><strong>Pages</strong> · ${copy.pages}</li><li><strong>Docker</strong> · ${copy.docker}</li></ul>
<p>${copy.unavailable}</p></main></body></html>`
}

// One entry per isolate. Only the issue is cached so each client gets its own language.
let cached: { password: string; issue: PasswordIssue | null } | null = null

export function passwordGuard(env: Env, pathname: string, acceptLanguage = ''): Response | null {
  const password = env.APP_PASSWORD ?? ''
  if (!cached || cached.password !== password) {
    cached = { password, issue: appPasswordIssue(password) }
  }
  if (!cached.issue || pathname === HEALTH_PATH) {
    return null
  }
  const locale = preferredLocale(acceptLanguage)
  const copy = text[locale]
  const isApi = pathname.startsWith('/api/')
  const body = isApi
    ? JSON.stringify({ error: copy.title, detail: copy[cached.issue], code: 'app_password_insecure' })
    : html(locale, cached.issue)
  return new Response(body, {
    status: 503,
    headers: {
      'Content-Type': isApi ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Language': locale,
      Vary: 'Accept-Language',
    },
  })
}
