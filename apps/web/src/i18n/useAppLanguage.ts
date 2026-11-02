// useAppLanguage — thin wrapper over react-i18next's useTranslation that
// exposes a stable `change` API and the current language code typed to
// our supported-languages set.
//
// Phase 1 persistence: localStorage via the LanguageDetector configured
// in ./index.ts. Phase 2 will sync to tenant locale_preferences.uiLanguage.
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { SUPPORTED_LANGUAGES, type SupportedLanguage } from './index'

export type AppLanguageApi = Readonly<{
  current:     SupportedLanguage
  change:      (lang: SupportedLanguage) => Promise<void>
  isSupported: (code: string) => code is SupportedLanguage
}>

function toSupported(raw: string): SupportedLanguage {
  const base = raw.split('-')[0] ?? 'en'
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(base)
    ? (base as SupportedLanguage)
    : 'en'
}

export function useAppLanguage(): AppLanguageApi {
  const { i18n } = useTranslation()
  const current = toSupported(i18n.language ?? 'en')

  const change = useCallback(
    async (lang: SupportedLanguage): Promise<void> => {
      if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) return
      await i18n.changeLanguage(lang)
    },
    [i18n],
  )

  const isSupported = useCallback(
    (code: string): code is SupportedLanguage =>
      (SUPPORTED_LANGUAGES as readonly string[]).includes(code),
    [],
  )

  return { current, change, isSupported }
}
