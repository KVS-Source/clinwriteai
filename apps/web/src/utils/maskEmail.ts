// Mask an email address for display: in the part before the @, the first
// character stays and every later letter or digit becomes '*' (separators
// . - _ + are kept). The domain stays readable.
//   tester@mailinator.com → t*****@mailinator.com
// Display only — the address itself is unchanged in the data and the API.
export function maskEmail(email: string | null | undefined): string {
  if (!email) return ''
  const at = email.lastIndexOf('@')
  const local  = at === -1 ? email : email.slice(0, at)
  const domain = at === -1 ? '' : email.slice(at)
  return local.charAt(0) + local.slice(1).replace(/[\p{L}\p{N}]/gu, '*') + domain
}
