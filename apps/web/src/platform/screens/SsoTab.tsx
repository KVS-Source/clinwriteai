// Settings → SSO tab (Phase 3 placeholder).
//
// The existing SsoConnectionConfig screen is coupled to the tenant-admin
// routing (`useParams<{ tenantId }>()`), which doesn't fit the single-
// tenant Settings model this refactor is moving toward. Rewiring the
// hooks to drop the tenant id is a separate change; shipping a clear
// placeholder here keeps the Settings tab list consistent without
// stranding a broken tenant-scoped flow inside the admin shell.

import { Link } from 'react-router-dom'

export function SsoTab() {
  return (
    <div className="flex flex-col gap-4" data-tab="sso">
      <header>
        <h2 className="text-[16px] font-semibold text-slate-900">Single Sign-On</h2>
        <p className="mt-1 text-[12px] text-slate-500">
          OIDC / SAML identity provider configuration for this install.
        </p>
      </header>

      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-[13px] text-slate-600">
        <p className="font-medium text-slate-800">SSO configuration moved to this tab.</p>
        <p className="mt-2">
          The existing tenant-scoped SSO screen (used in the multi-tenant era) still
          runs behind the scenes and is reachable from User Management while the
          single-tenant rewrite lands. Expect the full OIDC / SAML connect flow,
          verification + rollback, directly in this tab in the next release.
        </p>
        <p className="mt-3 text-[12px] text-slate-500">
          Looking for the old screen now? It lives under
          {' '}<Link to="/admin/users" className="font-medium text-blue-600 hover:underline">User Management</Link>{' '}
          while this tab is being wired up.
        </p>
      </div>
    </div>
  )
}
