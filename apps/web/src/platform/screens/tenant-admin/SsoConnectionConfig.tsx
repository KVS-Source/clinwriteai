// SSO connection config — Arc 4.6 of docs/pivot-plan.md.
//
// Per-tenant screen for creating + verifying WorkOS connections. The
// `Test connect` button fires the stub /test endpoint which flips
// status to 'verified' when workosConnectionId is set (real WorkOS
// discovery wires in when the SDK is procured).

import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useCreateSsoConnection, useSsoConnections, useTenant, useTestSsoConnection,
  useUpdateSsoConnection, useDisableSsoConnection, type SsoConnection,
} from '../../../hooks'
import { describeApiError } from '../../../api'

function StatusChip({ status }: { status: SsoConnection['status'] }) {
  const palette = {
    draft:    { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1', label: '○ Draft' },
    verified: { bg: '#F0FDF4', fg: '#166534', border: '#BBF7D0', label: '✓ Verified' },
    disabled: { bg: '#FFF5F5', fg: '#B91C1C', border: '#FECACA', label: '○ Disabled' },
  }[status]
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: palette.bg, color: palette.fg, border: `1px solid ${palette.border}` }}
    >{palette.label}</span>
  )
}

export function SsoConnectionConfig() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const { data: tenant } = useTenant(tenantId)
  const { data: conns = [], error } = useSsoConnections(tenantId)
  const create  = useCreateSsoConnection(tenantId ?? '')
  const update  = useUpdateSsoConnection(tenantId ?? '')
  const test    = useTestSsoConnection(tenantId ?? '')
  const disable = useDisableSsoConnection(tenantId ?? '')

  const [newType, setNewType] = useState<'oidc' | 'saml'>('oidc')
  const [newCallback, setNewCallback] = useState('')
  const [newWorkosId, setNewWorkosId] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ connectionId: string; ok: boolean; message: string } | null>(null)

  async function submitNew() {
    setActionError(null)
    try {
      await create.mutateAsync({
        type: newType,
        callbackUrl: newCallback,
        workosConnectionId: newWorkosId || undefined,
      })
      setNewCallback(''); setNewWorkosId('')
    } catch (e) { setActionError(describeApiError(e).message) }
  }

  async function runTest(id: string) {
    setTestResult(null)
    try {
      const result = await test.mutateAsync(id)
      setTestResult({ connectionId: id, ok: result.ok, message: result.message ?? (result.ok ? 'Verified' : (result.error ?? 'Failed')) })
    } catch (e) {
      const d = describeApiError(e)
      setTestResult({ connectionId: id, ok: false, message: d.message })
    }
  }

  return (
    <div className="bg-slate-50" data-screen="sso-config">
      <div className="flex flex-col gap-5" style={{ maxWidth: 1024, padding: '20px 32px 48px' }}>
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <Link to="/super-admin/tenants" className="hover:underline">Tenants</Link>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          {tenant && <Link to={`/super-admin/tenants/${tenant.id}`} className="hover:underline">{tenant.name}</Link>}
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">SSO</span>
        </nav>

        <h1 className="text-[22px] font-bold text-slate-900">SSO connections</h1>
        <p className="text-[12px] text-slate-500">
          Per-tenant OIDC / SAML config. Secrets live in <code className="font-mono">/opt/platform/env/api.env.enc</code>; this
          screen only tracks the WorkOS connection id + status so you can see verified / draft / disabled at a glance.
        </p>

        {error && <p className="rounded-md bg-red-50 p-3 text-[13px] text-red-800">{describeApiError(error).message}</p>}
        {actionError && <p className="rounded-md bg-red-50 p-3 text-[13px] text-red-800">{actionError}</p>}

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-[14px] font-bold text-slate-900">Add connection</h2>
          <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label className="flex flex-col gap-1 text-[12px] text-slate-700">
              Type
              <select
                className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px]"
                value={newType}
                onChange={e => setNewType(e.target.value as 'oidc' | 'saml')}
              >
                <option value="oidc">OIDC</option>
                <option value="saml">SAML</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-slate-700">
              Callback URL
              <input
                className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px]"
                value={newCallback}
                onChange={e => setNewCallback(e.target.value)}
                placeholder="https://api.clinwrite.ai/auth/callback"
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-slate-700">
              WorkOS connection id (optional)
              <input
                className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px]"
                value={newWorkosId}
                onChange={e => setNewWorkosId(e.target.value)}
                placeholder="conn_01HWX..."
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={submitNew}
              disabled={!newCallback || create.isPending}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
              data-action="create-sso"
            >
              {create.isPending ? 'Creating…' : 'Add connection'}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-[14px] font-bold text-slate-900">Existing connections</h2>
          <div className="mt-3 flex flex-col gap-3">
            {conns.length === 0 && (
              <p className="text-[12px] text-slate-500">No connections configured yet.</p>
            )}
            {conns.map(c => (
              <div key={c.id} className="rounded-md border border-slate-200 p-4" data-sso-row={c.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <StatusChip status={c.status} />
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-mono" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>{c.type.toUpperCase()}</span>
                    </div>
                    <p className="mt-2 text-[12px] text-slate-700">Callback: <code className="font-mono text-[11px]">{c.callbackUrl}</code></p>
                    <p className="mt-1 text-[12px] text-slate-700">WorkOS id: <code className="font-mono text-[11px]">{c.workosConnectionId ?? '— unset —'}</code></p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => runTest(c.id)}
                      disabled={test.isPending}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      data-action="test-sso"
                    >
                      {test.isPending ? 'Testing…' : 'Test connect'}
                    </button>
                    {c.status !== 'disabled' && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm('Disable this SSO connection? Users bound to it will fall back to the next connection or password login.')) {
                            disable.mutate(c.id)
                          }
                        }}
                        className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] text-red-700 hover:bg-red-100"
                      >Disable</button>
                    )}
                  </div>
                </div>
                {testResult?.connectionId === c.id && (
                  <p
                    className={`mt-3 rounded-md p-2 text-[12px] ${testResult.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}
                    data-test-result={testResult.ok ? 'ok' : 'fail'}
                  >
                    {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
                  </p>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <label className="flex items-center gap-1 text-[11px] text-slate-500">
                    Update WorkOS id
                    <input
                      className="rounded-md border border-slate-300 px-2 py-1 text-[12px]"
                      defaultValue={c.workosConnectionId ?? ''}
                      onBlur={e => {
                        const value = e.currentTarget.value
                        if (value !== (c.workosConnectionId ?? '')) {
                          update.mutate({ id: c.id, workosConnectionId: value })
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
