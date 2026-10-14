// Role home — the landing page after sign-in, one tailored view per role.
//
// Everything shown is derived from the signed-in user (usePlatformStore,
// which useSessionSync fills from /auth/me). Links only point at routes the
// role can actually open, matching the sidebar and the route guards.

import { Link } from 'react-router-dom'
import { PLATFORM_USER_ROLE_LABEL, type PlatformUserRole } from '@platform/types'
import { usePlatformStore } from '../store'
import { MODULE_LABELS, MODULE_SLUG_TO_KEY, isModuleEnabled, type ModuleSlug } from '../../config/modules'

interface QuickLink { label: string; href: string; hint: string }
interface RoleProfile {
  tagline: string
  can: string[]
  cannot: string[]
  links: QuickLink[]
  accent: string
}

const PROJECTS: QuickLink      = { label: 'All projects',     href: '/projects',                hint: 'Open the projects you are part of' }
const NOTIFICATIONS: QuickLink = { label: 'Notifications',    href: '/notifications',           hint: 'Reviews, mentions and deadlines' }
const LIBRARY: QuickLink       = { label: 'Master library',   href: '/library',                 hint: 'Reusable sections and templates' }
const BEST_PRACTICES: QuickLink = { label: 'Best practices',  href: '/library/best-practices',  hint: 'Approved writing guidance' }

const ADMIN_LINKS: QuickLink[] = [
  { label: 'User management', href: '/admin/users',  hint: 'Invite, suspend and change roles' },
  { label: 'Audit trail',     href: '/admin/audit',  hint: 'Review every recorded action' },
  { label: 'RACI matrix',     href: '/admin/raci',   hint: 'Who is responsible, accountable, consulted' },
  { label: 'Admin panel',     href: '/admin',        hint: 'Organisation settings' },
]

const ROLE_PROFILES: Partial<Record<PlatformUserRole, RoleProfile>> & Record<
  'super-admin' | 'admin' | 'clinical-writer' | 'scientific-writer' | 'medical-writer'
  | 'regulatory-writer' | 'ideation-lead' | 'reviewer' | 'read-only', RoleProfile
> = {
  'super-admin': {
    accent: '#1A3C5E',
    tagline: 'Platform owner. You run every organisation on the platform.',
    can: [
      'Create, suspend and archive tenants',
      'Manage users, roles and SSO for any organisation',
      'Maintain the regulatory framework registry and rate card',
      'Read the platform-wide audit trail',
    ],
    cannot: ['Edit or delete audit entries — the trail is append-only for everyone'],
    links: [
      { label: 'Tenants', href: '/super-admin/tenants', hint: 'All client organisations' },
      { label: 'Super admin panel', href: '/super-admin', hint: 'Platform configuration' },
      ...ADMIN_LINKS.slice(0, 2),
      PROJECTS,
    ],
  },
  admin: {
    accent: '#1A3C5E',
    tagline: 'Organisation admin. You manage your team and what they can access.',
    can: [
      'Invite users and assign roles and module access',
      'Suspend or deprovision users in your organisation',
      'Edit the RACI matrix and review the audit trail',
      'Manage organisation settings and subscription',
    ],
    cannot: [
      'Grant or change the super-admin role',
      'See or manage users of other organisations',
      'Suspend yourself or the last active admin',
    ],
    links: [...ADMIN_LINKS, PROJECTS],
  },
  'clinical-writer': {
    accent: '#2563EB',
    tagline: 'Author clinical documents — protocols, CSRs and regulatory submissions text.',
    can: [
      'Draft and edit documents in Clinical Writing',
      'Respond to review comments and complete checklists',
      'Request reviews and track document stages',
    ],
    cannot: ['Manage users or roles', 'Approve a stage that needs a different designated role'],
    links: [PROJECTS, NOTIFICATIONS, LIBRARY, BEST_PRACTICES],
  },
  'scientific-writer': {
    accent: '#0D9488',
    tagline: 'Write publications and manuscripts with their author and journal workflow.',
    can: [
      'Draft manuscripts and abstracts in Scientific Writing',
      'Manage the author list and contributions',
      'Reuse approved content from the master library',
    ],
    cannot: ['Manage users or roles', 'Edit documents outside your assigned modules'],
    links: [PROJECTS, LIBRARY, NOTIFICATIONS, BEST_PRACTICES],
  },
  'medical-writer': {
    accent: '#7C3AED',
    tagline: 'Create medical content — KOL material, claims and field-facing documents.',
    can: [
      'Author content in Medical Writing',
      'Run KOL sessions and maintain the claims matrix',
      'Submit content for medical review',
    ],
    cannot: ['Manage users or roles', 'Publish content that has not passed review'],
    links: [PROJECTS, NOTIFICATIONS, LIBRARY, BEST_PRACTICES],
  },
  'regulatory-writer': {
    accent: '#B0200D',
    tagline: 'Prepare regulatory submissions and follow health-authority intelligence.',
    can: [
      'Author submission documents in Regulatory Writing',
      'Track regulatory intelligence and alerts',
      'Collaborate with reviewers on submission readiness',
    ],
    cannot: ['Manage users or roles', 'Sign off a submission without the e-signatory step'],
    links: [PROJECTS, NOTIFICATIONS, LIBRARY, BEST_PRACTICES],
  },
  'ideation-lead': {
    accent: '#0D9488',
    tagline: 'Lead ideation and publishing — planning, calendar and content pipeline.',
    can: [
      'Plan content in the ideation calendar',
      'Coordinate KOL outreach and publishing',
      'Review the publishing pipeline',
    ],
    cannot: ['Manage users or roles', 'Edit regulatory submission documents'],
    links: [PROJECTS, NOTIFICATIONS, LIBRARY, BEST_PRACTICES],
  },
  reviewer: {
    accent: '#475569',
    tagline: 'Review documents across modules and give structured feedback.',
    can: [
      'Read documents you are assigned to review',
      'Add comments and record a review verdict',
      'Follow resolution of your comments',
    ],
    cannot: ['Edit document content', 'Manage users or roles'],
    links: [PROJECTS, NOTIFICATIONS, LIBRARY],
  },
  'read-only': {
    accent: '#94A3B8',
    tagline: 'Observer. You can look, but nothing you do changes a record.',
    can: ['View projects and documents you have been given access to', 'Read notifications'],
    cannot: [
      'Create or edit anything',
      'Comment or review',
      'See modules you have not been granted — ask your admin for access',
    ],
    links: [PROJECTS, NOTIFICATIONS],
  },
}

function fallbackProfile(label: string): RoleProfile {
  return {
    accent: '#475569',
    tagline: `Signed in as ${label}.`,
    can: ['Work in the modules assigned to you'],
    cannot: ['Access admin pages unless your role includes them'],
    links: [PROJECTS, NOTIFICATIONS, LIBRARY],
  }
}

export function RoleHome() {
  const user = usePlatformStore(s => s.currentUser)
  const label = PLATFORM_USER_ROLE_LABEL[user.role] ?? user.role
  const profile = (ROLE_PROFILES as Partial<Record<string, RoleProfile>>)[user.role] ?? fallbackProfile(label)

  const isAdmin = user.role === 'admin' || user.role === 'super-admin'
  const moduleEntries = Object.entries(MODULE_LABELS).filter(([slug]) => {
    const key = MODULE_SLUG_TO_KEY[slug as ModuleSlug]
    return key && isModuleEnabled(key) && (isAdmin || user.modules.includes(key))
  })

  return (
    <div className="bg-slate-50" data-screen="role-home" data-role={user.role}>
      <div className="flex flex-col gap-5" style={{ maxWidth: 960, padding: '28px 32px 56px' }}>
        <header className="rounded-lg border border-slate-200 bg-white p-5" style={{ borderTop: `4px solid ${profile.accent}` }}>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-slate-500">Your role</p>
          <h1 className="mt-1 text-[24px] font-bold text-slate-900">{label}</h1>
          <p className="mt-1 text-[14px] text-slate-600">Welcome, {user.name}. {profile.tagline}</p>
          <div className="mt-3 flex flex-wrap gap-2" data-section="modules">
            {moduleEntries.length === 0 && (
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
                No modules assigned yet — ask your admin for access
              </span>
            )}
            {moduleEntries.map(([slug, name]) => (
              <span key={slug} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">{name}</span>
            ))}
          </div>
        </header>

        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <section className="rounded-lg border border-slate-200 bg-white p-4" data-section="can">
            <h2 className="text-[13px] font-bold text-slate-900">What you can do</h2>
            <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-slate-700">
              {profile.can.map(t => <li key={t}>✓ {t}</li>)}
            </ul>
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-4" data-section="cannot">
            <h2 className="text-[13px] font-bold text-slate-900">What is restricted</h2>
            <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-slate-700">
              {profile.cannot.map(t => <li key={t}>– {t}</li>)}
            </ul>
          </section>
        </div>

        <section data-section="quick-links">
          <h2 className="mb-2 text-[13px] font-bold text-slate-900">Jump to</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
            {profile.links.map(l => (
              <Link
                key={l.href}
                to={l.href}
                className="rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-slate-400"
                data-quick-link={l.href}
              >
                <p className="text-[13px] font-semibold text-slate-900">{l.label}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{l.hint}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
