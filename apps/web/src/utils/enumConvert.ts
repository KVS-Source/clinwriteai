// Converts TypeScript kebab-case enum values to SQL snake_case for API calls
export const toSQLEnum = (value: string): string => value.replace(/-/g, '_')
export const fromSQLEnum = (value: string): string => value.replace(/_/g, '-')
