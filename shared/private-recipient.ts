/** Canonical form for comparing private recipient mailboxes. Only consumer Gmail
 * addresses treat dots, plus tags and the googlemail.com domain as aliases. */
export function mailboxIdentity(address: string): string {
  const email = address.trim().toLowerCase()
  const at = email.lastIndexOf('@')
  if (at < 1) return email
  const domain = email.slice(at + 1)
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return email
  return email.slice(0, at).split('+', 1)[0].replaceAll('.', '') + '@gmail.com'
}
