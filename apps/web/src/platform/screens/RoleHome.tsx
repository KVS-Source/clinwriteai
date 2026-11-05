// Role home — the landing page after sign-in, one tailored view per role.
//
// Everything shown is derived from the signed-in user (usePlatformStore,
// which useSessionSync fills from /auth/me). Links only point at routes the
// role can actually open, matching the sidebar and the route guards.

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PLATFORM_USER_ROLE_LABEL, type PlatformUserRole } from '@platform/types'
import { usePlatformStore } from '../store'
import { MODULE_LABELS, MODULE_SLUG_TO_KEY, isModuleEnabled, type ModuleSlug } from '../../config/modules'
import { isAdminRole } from '../../config/roles'

interface QuickLink { labelKey: string; href: string; hintKey: string }
interface RoleProfile {
  taglineKey: string
  canKeys: string[]
  cannotKeys: string[]
  links: QuickLink[]
  accent: string
}

const PROJECTS: QuickLink       = { labelKey: 'page.role_home.link_projects_label',        href: '/projects',                hintKey: 'page.role_home.link_projects_hint' }
const NOTIFICATIONS: QuickLink  = { labelKey: 'page.role_home.link_notifications_label',   href: '/notifications',           hintKey: 'page.role_home.link_notifications_hint' }
const LIBRARY: QuickLink        = { labelKey: 'page.role_home.link_library_label',         href: '/library',                 hintKey: 'page.role_home.link_library_hint' }
const BEST_PRACTICES: QuickLink = { labelKey: 'page.role_home.link_best_practices_label',  href: '/library/best-practices',  hintKey: 'page.role_home.link_best_practices_hint' }

const ADMIN_LINKS: QuickLink[] = [
  { labelKey: 'page.role_home.link_user_management_label', href: '/admin/users',  hintKey: 'page.role_home.link_user_management_hint' },
  { labelKey: 'page.role_home.link_audit_trail_label',     href: '/admin/audit',  hintKey: 'page.role_home.link_audit_trail_hint' },
  { labelKey: 'page.role_home.link_raci_label',            href: '/admin/raci',   hintKey: 'page.role_home.link_raci_hint' },
  { labelKey: 'page.role_home.link_admin_panel_label',     href: '/admin',        hintKey: 'page.role_home.link_admin_panel_hint' },
]

// Keyed profiles. Post 2026-10-27 role consolidation: platform admin = 'admin'
// with tenantId=null (RoleHome selects the right card at render time via that
// predicate); 'super-admin' is retired from the type but kept as a profile
// key for RoleHome to render the platform-owner card when needed.
const ROLE_PROFILES: Partial<Record<PlatformUserRole, RoleProfile>> & Record<
  'admin' | 'clinical-writer' | 'scientific-writer' | 'medical-writer'
  | 'regulatory-writer' | 'ideation-lead' | 'reviewer' | 'read-only', RoleProfile
> & { 'super-admin'?: RoleProfile } = {
  'super-admin': {
    accent: '#1A3C5E',
    taglineKey: 'page.role_home.tagline_super_admin',
    canKeys: [
      'page.role_home.can_super_admin_1',
      'page.role_home.can_super_admin_2',
      'page.role_home.can_super_admin_3',
      'page.role_home.can_super_admin_4',
    ],
    cannotKeys: ['page.role_home.cannot_super_admin_1'],
    links: [
      { labelKey: 'page.role_home.link_tenants_label',          href: '/super-admin/tenants', hintKey: 'page.role_home.link_tenants_hint' },
      { labelKey: 'page.role_home.link_platform_admin_label',   href: '/super-admin',         hintKey: 'page.role_home.link_platform_admin_hint' },
      ...ADMIN_LINKS.slice(0, 2),
    ],
  },
  admin: {
    accent: '#1A3C5E',
    taglineKey: 'page.role_home.tagline_admin',
    canKeys: [
      'page.role_home.can_admin_1',
      'page.role_home.can_admin_2',
      'page.role_home.can_admin_3',
      'page.role_home.can_admin_4',
    ],
    cannotKeys: [
      'page.role_home.cannot_admin_1',
      'page.role_home.cannot_admin_2',
      'page.role_home.cannot_admin_3',
    ],
    links: [...ADMIN_LINKS],
  },
  'clinical-writer': {
    accent: '#2563EB',
    taglineKey: 'page.role_home.tagline_clinical_writer',
    canKeys: [
      'page.role_home.can_clinical_writer_1',
      'page.role_home.can_clinical_writer_2',
      'page.role_home.can_clinical_writer_3',
    ],
    cannotKeys: [
      'page.role_home.cannot_clinical_writer_1',
      'page.role_home.cannot_clinical_writer_2',
    ],
    links: [PROJECTS, NOTIFICATIONS, LIBRARY, BEST_PRACTICES],
  },
  'scientific-writer': {
    accent: '#0D9488',
    taglineKey: 'page.role_home.tagline_scientific_writer',
    canKeys: [
      'page.role_home.can_scientific_writer_1',
      'page.role_home.can_scientific_writer_2',
      'page.role_home.can_scientific_writer_3',
    ],
    cannotKeys: [
      'page.role_home.cannot_scientific_writer_1',
      'page.role_home.cannot_scientific_writer_2',
    ],
    links: [PROJECTS, LIBRARY, NOTIFICATIONS, BEST_PRACTICES],
  },
  'medical-writer': {
    accent: '#7C3AED',
    taglineKey: 'page.role_home.tagline_medical_writer',
    canKeys: [
      'page.role_home.can_medical_writer_1',
      'page.role_home.can_medical_writer_2',
      'page.role_home.can_medical_writer_3',
    ],
    cannotKeys: [
      'page.role_home.cannot_medical_writer_1',
      'page.role_home.cannot_medical_writer_2',
    ],
    links: [PROJECTS, NOTIFICATIONS, LIBRARY, BEST_PRACTICES],
  },
  'regulatory-writer': {
    accent: '#B0200D',
    taglineKey: 'page.role_home.tagline_regulatory_writer',
    canKeys: [
      'page.role_home.can_regulatory_writer_1',
      'page.role_home.can_regulatory_writer_2',
      'page.role_home.can_regulatory_writer_3',
    ],
    cannotKeys: [
      'page.role_home.cannot_regulatory_writer_1',
      'page.role_home.cannot_regulatory_writer_2',
    ],
    links: [PROJECTS, NOTIFICATIONS, LIBRARY, BEST_PRACTICES],
  },
  'ideation-lead': {
    accent: '#0D9488',
    taglineKey: 'page.role_home.tagline_ideation_lead',
    canKeys: [
      'page.role_home.can_ideation_lead_1',
      'page.role_home.can_ideation_lead_2',
      'page.role_home.can_ideation_lead_3',
    ],
    cannotKeys: [
      'page.role_home.cannot_ideation_lead_1',
      'page.role_home.cannot_ideation_lead_2',
    ],
    links: [PROJECTS, NOTIFICATIONS, LIBRARY, BEST_PRACTICES],
  },
  reviewer: {
    accent: '#475569',
    taglineKey: 'page.role_home.tagline_reviewer',
    canKeys: [
      'page.role_home.can_reviewer_1',
      'page.role_home.can_reviewer_2',
      'page.role_home.can_reviewer_3',
    ],
    cannotKeys: [
      'page.role_home.cannot_reviewer_1',
      'page.role_home.cannot_reviewer_2',
    ],
    links: [PROJECTS, NOTIFICATIONS, LIBRARY],
  },
  'read-only': {
    accent: '#94A3B8',
    taglineKey: 'page.role_home.tagline_read_only',
    canKeys: [
      'page.role_home.can_read_only_1',
      'page.role_home.can_read_only_2',
    ],
    cannotKeys: [
      'page.role_home.cannot_read_only_1',
      'page.role_home.cannot_read_only_2',
      'page.role_home.cannot_read_only_3',
    ],
    links: [PROJECTS, NOTIFICATIONS],
  },
}

function fallbackProfile(): RoleProfile {
  return {
    accent: '#475569',
    taglineKey: 'page.role_home.tagline_fallback',
    canKeys: ['page.role_home.can_fallback_1'],
    cannotKeys: ['page.role_home.cannot_fallback_1'],
    links: [PROJECTS, NOTIFICATIONS, LIBRARY],
  }
}

export function RoleHome() {
  const { t } = useTranslation()
  const user = usePlatformStore(s => s.currentUser)
  const label = PLATFORM_USER_ROLE_LABEL[user.role] ?? user.role
  // 'tenant-admin' (the API's canonical name) gets the organisation-admin card.
  const profileKey = user.role === 'tenant-admin' ? 'admin' : user.role
  const profile = (ROLE_PROFILES as Partial<Record<string, RoleProfile>>)[profileKey] ?? fallbackProfile()

  // Post 2026-10-27 role consolidation: admins carry an admin role ('admin',
  // or 'tenant-admin' from the API) regardless of platform-vs-tenant scope
  // (that distinction is on tenantId now).
  const isAdmin = isAdminRole(user.role)
  const moduleEntries = Object.entries(MODULE_LABELS).filter(([slug]) => {
    const key = MODULE_SLUG_TO_KEY[slug as ModuleSlug]
    return key && isModuleEnabled(key) && (isAdmin || user.modules.includes(key))
  })

  return (
    <div className="bg-slate-50" data-screen="role-home" data-role={user.role}>
      <div className="flex flex-col gap-5" style={{ maxWidth: 960, padding: '28px 32px 56px' }}>
        <header className="rounded-lg border border-slate-200 bg-white p-5" style={{ borderTop: `4px solid ${profile.accent}` }}>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-slate-500">{t('page.role_home.your_role_eyebrow')}</p>
          <h1 className="mt-1 text-[24px] font-bold text-slate-900">{label}</h1>
          <p className="mt-1 text-[14px] text-slate-600">{t('page.role_home.welcome_line', { name: user.name, tagline: t(profile.taglineKey, { label }) })}</p>
          <div className="mt-3 flex flex-wrap gap-2" data-section="modules">
            {moduleEntries.length === 0 && (
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
                {t('page.role_home.no_modules')}
              </span>
            )}
            {moduleEntries.map(([slug, name]) => (
              <span key={slug} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">{name}</span>
            ))}
          </div>
        </header>

        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <section className="rounded-lg border border-slate-200 bg-white p-4" data-section="can">
            <h2 className="text-[13px] font-bold text-slate-900">{t('page.role_home.what_you_can_do')}</h2>
            <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-slate-700">
              {profile.canKeys.map(k => <li key={k}>✓ {t(k)}</li>)}
            </ul>
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-4" data-section="cannot">
            <h2 className="text-[13px] font-bold text-slate-900">{t('page.role_home.what_is_restricted')}</h2>
            <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-slate-700">
              {profile.cannotKeys.map(k => <li key={k}>– {t(k)}</li>)}
            </ul>
          </section>
        </div>

        <section data-section="quick-links">
          <h2 className="mb-2 text-[13px] font-bold text-slate-900">{t('page.role_home.jump_to')}</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
            {profile.links.map(l => (
              <Link
                key={l.href}
                to={l.href}
                className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-slate-400"
                data-quick-link={l.href}
              >
                <p className="break-words text-[13px] font-semibold text-slate-900">{t(l.labelKey)}</p>
                <p className="mt-0.5 break-words text-[11px] text-slate-500">{t(l.hintKey)}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
