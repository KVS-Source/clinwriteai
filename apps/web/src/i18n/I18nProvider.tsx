// `<I18nProvider>` — wraps children with react-i18next's I18nextProvider
// after calling initI18n(). Mount once near the root (above the router)
// so every component can call useTranslation().
import { useMemo, type ReactElement, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'

import { initI18n } from './index'

export interface I18nProviderProps {
  children: ReactNode
}

export function I18nProvider({ children }: I18nProviderProps): ReactElement {
  // Initialise once; subsequent renders reuse the singleton.
  const instance = useMemo(() => initI18n(), [])
  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>
}
