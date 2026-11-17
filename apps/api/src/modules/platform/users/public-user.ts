// What a user row looks like on the wire. The admin user routes used to return the whole database row,
// which put every user's password hash (and reset-token hash) in the browser of whoever opened User
// Management. Nothing on the screen uses these fields; they never leave the server.

const SECRET_FIELDS = ['passwordHash', 'passwordResetTokenHash', 'passwordResetExpiresAt'] as const

export type PublicUser<U> = Omit<U, (typeof SECRET_FIELDS)[number]>

export function publicUser<U extends object>(user: U): PublicUser<U> {
  const copy = { ...user } as Record<string, unknown>
  for (const f of SECRET_FIELDS) delete copy[f]
  return copy as PublicUser<U>
}
