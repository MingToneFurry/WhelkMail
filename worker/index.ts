import { preferredLocale } from '../shared/request-locale'

interface Env {
  APP_URL: string
  CRON_SECRET: string
}

export default {
  async scheduled(
    _controller: unknown,
    env: Env,
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ): Promise<void> {
    const base = env.APP_URL.replace(/\/$/, '')
    ctx.waitUntil(
      fetch(`${base}/api/cron/notifications`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      }).then(() => undefined),
    )
  },
  async fetch(request: Request): Promise<Response> {
    const locale = preferredLocale(request.headers.get('Accept-Language'))
    const names = { 'zh-CN': 'WhelkMail 定时通知服务', en: 'WhelkMail notification cron worker', it: 'Servizio notifiche pianificate di WhelkMail' }
    return new Response(names[locale], { headers: { 'Content-Language': locale, Vary: 'Accept-Language' } })
  },
}
