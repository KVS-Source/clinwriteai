// i18n foundation — Phase 1 chrome coverage (2026-11-03).
//
// Scope decision: UI chrome only (menus, buttons, labels, toasts, help
// text). Document bodies, user-generated content, and emails are OUT
// of scope — see memory/project_i18n_phase1.md for the full rationale.
//
// Pattern (mirrors the GenRAC sister project that proved it):
//   • Resource bundles ship as plain .json files per language.
//   • Keys use dot-namespacing by concern:
//       button.*, nav.*, header.*, toast.*, status.*  — shared vocab
//       page.<screen>.*                               — per-screen keys
//   • Fallback is always 'en' — a missing JA key renders the English
//     string, never a broken "[missing: nav.foo]" placeholder.
//   • Persistence (Phase 1): localStorage via LanguageDetector. Phase 2
//     will sync to tenant locale_preferences.uiLanguage so the choice
//     follows the user across devices.
//
// Translation workflow (dev-time only, no runtime API calls):
//   npm --workspace=apps/web run translate -- --target ja
// routes to the engine registered for ja (default: Claude via the
// existing AI gateway; Google available via --engine google). See
// scripts/translate-missing-keys.ts for the dispatcher + routes map.
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import enCommon from './en.json'
import jaCommon from './ja.json'

export const SUPPORTED_LANGUAGES = ['en', 'ja'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const LANGUAGE_LABELS: Readonly<Record<SupportedLanguage, string>> = {
  en: 'English',
  ja: '日本語',
}

/** Localstorage key — namespaced so it doesn't collide with anything else. */
const LOCALSTORAGE_KEY = 'clinwrite.uiLanguage'

export function initI18n(): typeof i18n {
  if (i18n.isInitialized) return i18n

  void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        en: { common: enCommon },
        ja: { common: jaCommon },
      },
      fallbackLng: 'en',
      supportedLngs: [...SUPPORTED_LANGUAGES],
      ns: ['common'],
      defaultNS: 'common',
      interpolation: {
        escapeValue: false, // React escapes by default
      },
      detection: {
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: LOCALSTORAGE_KEY,
        caches: ['localStorage'],
      },
      returnEmptyString: false,
      // In dev, warn (not throw) on missing keys so new screens can rely
      // on inline-English fallback until a key is added. The build-time
      // translator script picks up anything missing from ja.json.
      saveMissing: false,
    })

  return i18n
}

export { i18n }
export default i18n
