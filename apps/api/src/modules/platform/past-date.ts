// A date chosen for something still to come can't have already passed. A day's grace: dates arrive as
// UTC, and "today" in the user's time zone can be yesterday in UTC. Takes 'YYYY-MM-DD' or a full ISO time.
export const isPastDay = (day: string): boolean =>
  day.slice(0, 10) < new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

export const DATE_IN_PAST = { error: 'date_in_past', message: 'Choose today or a later date.' } as const
