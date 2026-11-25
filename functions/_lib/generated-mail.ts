const translations = {
  'zh-CN': {
    forwarded: '转发的邮件',
    from: '发件人：',
    date: '日期：',
    subject: '主题：',
    noSubject: '（无主题）',
    yourMessage: '您的邮件',
    vacationBody: '我目前不在办公室，回来后会尽快回复您的邮件。',
  },
  en: {
    forwarded: 'Forwarded message',
    from: 'From: ',
    date: 'Date: ',
    subject: 'Subject: ',
    noSubject: '(no subject)',
    yourMessage: 'your message',
    vacationBody: 'I am currently out of the office and will get back to you as soon as possible.',
  },
  it: {
    forwarded: 'Messaggio inoltrato',
    from: 'Da: ',
    date: 'Data: ',
    subject: 'Oggetto: ',
    noSubject: '(nessun oggetto)',
    yourMessage: 'il tuo messaggio',
    vacationBody: 'Al momento sono fuori ufficio e risponderò al tuo messaggio appena possibile.',
  },
}

// Scheduled mail is generated without a browser or a signed-in user's locale.
export function generatedMailText(locale?: string) {
  return translations[locale === 'en' || locale === 'it' ? locale : 'zh-CN']
}
