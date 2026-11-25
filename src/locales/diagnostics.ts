export const diagnostics = {
  en: {
    'diagnostics.ok': 'OK',
    'diagnostics.connectionChecks': 'IMAP: OK ({count} folders) · SMTP: OK',
    'diagnostics.sentCopyFailed': 'Message sent, but saving the copy in {folder} failed: {detail}',
    'diagnostics.relayCopyFailed': 'Message sent, but saving the copy in {folder} of {email} failed: {detail}',
    'diagnostics.relayCopyRescued': 'Message sent. Saving the copy in {folder} of {email} failed ({detail}). The copy was archived to {storage}.',
    'diagnostics.acceptedWithoutRecord': '{relay} accepted the message, but WhelkMail could not record it ({detail}). Check the provider’s activity log before sending again.',
    'diagnostics.draftRescued': '{email} rejected the draft ({detail}). It was saved to {storage} instead.',
  },
  it: {
    'diagnostics.ok': 'OK',
    'diagnostics.connectionChecks': 'IMAP: OK ({count} cartelle) · SMTP: OK',
    'diagnostics.sentCopyFailed': 'Messaggio inviato, ma il salvataggio della copia in {folder} non è riuscito: {detail}',
    'diagnostics.relayCopyFailed': 'Messaggio inviato, ma il salvataggio della copia in {folder} di {email} non è riuscito: {detail}',
    'diagnostics.relayCopyRescued': 'Messaggio inviato. Il salvataggio della copia in {folder} di {email} non è riuscito ({detail}). La copia è stata archiviata su {storage}.',
    'diagnostics.acceptedWithoutRecord': '{relay} ha accettato il messaggio, ma WhelkMail non è riuscito a registrarlo ({detail}). Controlla il registro del provider prima di inviarlo di nuovo.',
    'diagnostics.draftRescued': '{email} ha rifiutato la bozza ({detail}). La bozza è stata salvata su {storage}.',
  },
  'zh-CN': {
    'diagnostics.ok': '正常',
    'diagnostics.connectionChecks': 'IMAP 已连接（{count} 个文件夹），SMTP 已连接',
    'diagnostics.sentCopyFailed': '邮件已发出，但副本未能保存到“{folder}”。错误信息：{detail}',
    'diagnostics.relayCopyFailed': '邮件已发出，但副本未能保存到 {email} 的“{folder}”。错误信息：{detail}',
    'diagnostics.relayCopyRescued': '邮件已发出。副本未能保存到 {email} 的“{folder}”，已改存至 {storage}。错误信息：{detail}',
    'diagnostics.acceptedWithoutRecord': '{relay} 已接收邮件，但 WhelkMail 未能记录发送结果。重发前请先查看服务商的投递记录。错误信息：{detail}',
    'diagnostics.draftRescued': '{email} 拒绝保存草稿，草稿已改存至 {storage}。错误信息：{detail}',
  },
}
