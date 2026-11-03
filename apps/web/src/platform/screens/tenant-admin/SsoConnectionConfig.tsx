// SSO connection config — Arc 4.6 of docs/pivot-plan.md.
//
// Per-tenant screen for creating + verifying WorkOS connections. The
// `Test connect` button fires the stub /test endpoint which flips
// status to 'verified' when workosConnectionId is set (real WorkOS
// discovery wires in when the SDK is procured).

import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  useCreateSsoConnection, useSsoConnections, useTenant, useTestSsoConnection,
  useUpdateSsoConnection, useDisableSsoConnection, type SsoConnection,
} from '../../../hooks'
import { describeApiError } from '../../../api'

function StatusChip({ status }: { status: SsoConnection['status'] }) {
  const { t } = useTranslation()
  const palette = {
    draft:    { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1', label: `○ ${t('page.sso_connection_config.status_draft')}` },
    verified: { bg: '#F0FDF4', fg: '#166534', border: '#BBF7D0', label: `✓ ${t('page.sso_connection_config.status_verified')}` },
    disabled: { bg: '#FFF5F5', fg: '#B91C1C', border: '#FECACA', label: `○ ${t('page.sso_connection_config.status_disabled')}` },
  }[status]
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: palette.bg, color: palette.fg, border: `1px solid ${palette.border}` }}
    >{palette.label}</span>
  )
}

export function SsoConnectionConfig() {
  const { t } = useTranslation()
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
      setTestResult({ connectionId: id, ok: result.ok, message: result.message ?? (result.ok ? t('page.sso_connection_config.verified') : (result.error ?? t('page.sso_connection_config.failed'))) })
    } catch (e) {
      const d = describeApiError(e)
      setTestResult({ connectionId: id, ok: false, message: d.message })
    }
  }

  return (
    <div className="bg-slate-50" data-screen="sso-config">
      <div className="flex flex-col gap-5" style={{ maxWidth: 1024, padding: '20px 32px 48px' }}>
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <Link to="/super-admin/tenants" className="hover:underline">{t('page.sso_connection_config.crumb_tenants')}</Link>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          {tenant && <Link to={`/super-admin/tenants/${tenant.id}`} className="hover:underline">{tenant.name}</Link>}
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{t('page.sso_connection_config.crumb_sso')}</span>
        </nav>

        <h1 className="text-[22px] font-bold text-slate-900">{t('page.sso_connection_config.title')}</h1>
        <p className="text-[12px] text-slate-500">
          {t('page.sso_connection_config.subtitle_prefix')} <code className="font-mono">/opt/platform/env/api.env.enc</code>{t('page.sso_connection_config.subtitle_suffix')}
        </p>

        {error && <p className="rounded-md bg-red-50 p-3 text-[13px] text-red-800">{describeApiError(error).message}</p>}
        {actionError && <p className="rounded-md bg-red-50 p-3 text-[13px] text-red-800">{actionError}</p>}

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-[14px] font-bold text-slate-900">{t('page.sso_connection_config.add_connection_heading')}</h2>
          <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label className="flex flex-col gap-1 text-[12px] text-slate-700">
              {t('page.sso_connection_config.field_type')}
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
              {t('page.sso_connection_config.field_callback_url')}
              <input
                className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px]"
                value={newCallback}
                onChange={e => setNewCallback(e.target.value)}
                placeholder="https://api.clinwrite.ai/auth/callback"
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-slate-700">
              {t('page.sso_connection_config.field_workos_id')}
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
              {create.isPending ? t('page.sso_connection_config.creating') : t('page.sso_connection_config.add_connection')}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-[14px] font-bold text-slate-900">{t('page.sso_connection_config.existing_connections_heading')}</h2>
          <div className="mt-3 flex flex-col gap-3">
            {conns.length === 0 && (
              <p className="text-[12px] text-slate-500">{t('page.sso_connection_config.no_connections')}</p>
            )}
            {conns.map(c => (
              <div key={c.id} className="rounded-md border border-slate-200 p-4" data-sso-row={c.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <StatusChip status={c.status} />
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-mono" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>{c.type.toUpperCase()}</span>
                    </div>
                    <p className="mt-2 text-[12px] text-slate-700">{t('page.sso_connection_config.callback_label')}: <code className="font-mono text-[11px]">{c.callbackUrl}</code></p>
                    <p className="mt-1 text-[12px] text-slate-700">{t('page.sso_connection_config.workos_id_label')}: <code className="font-mono text-[11px]">{c.workosConnectionId ?? t('page.sso_connection_config.unset')}</code></p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => runTest(c.id)}
                      disabled={test.isPending}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      data-action="test-sso"
                    >
                      {test.isPending ? t('page.sso_connection_config.testing') : t('page.sso_connection_config.test_connect')}
                    </button>
                    {c.status !== 'disabled' && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(t('page.sso_connection_config.confirm_disable'))) {
                            disable.mutate(c.id)
                          }
                        }}
                        className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] text-red-700 hover:bg-red-100"
                      >{t('page.sso_connection_config.disable_button')}</button>
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
                    {t('page.sso_connection_config.update_workos_id')}
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
