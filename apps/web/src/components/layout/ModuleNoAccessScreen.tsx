import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MODULE_LABELS, type ModuleSlug } from '../../config/modules'

interface Props { slug: ModuleSlug }

// Shown when the signed-in user has not been given this module (their profile's module list lacks it),
// the same "no access" the sidebar shows next to the module name. Every API call for the module would
// answer 403, so the page is not opened at all (CW-091).
export function ModuleNoAccessScreen({ slug }: Props) {
  const { t } = useTranslation()
  const label = MODULE_LABELS[slug] ?? slug
  return (
    <div className="flex h-full items-center justify-center p-12" data-module-no-access={slug}>
      <div className="max-w-md text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-amber-600">
          {t('component.module_no_access_screen.eyebrow')}
        </p>
        <h2 className="mt-2 text-xl font-bold text-slate-700">
          {t('component.module_no_access_screen.title', { module: label })}
        </h2>
        <p className="mt-3 text-sm text-slate-500">
          {t('component.module_no_access_screen.body', { module: label })}
        </p>
        <Link
          to="/projects"
          className="mt-6 inline-block rounded-md bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700"
        >
          {t('component.module_no_access_screen.back_to_projects')}
        </Link>
      </div>
    </div>
  )
}
