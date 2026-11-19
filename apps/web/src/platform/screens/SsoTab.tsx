// Settings → SSO tab (Phase 3, migration 96).
//
// Single-tenant SSO config: enable toggle, email-domain routing, and either
// an OIDC or SAML provider. Non-secret fields persist on PlatformSettings.sso
// (JSONB); the OIDC client secret rides on the shared ExternalApiCredential
// pipe (apiId = 'sso-oidc') so masking + audit mirror every other credential
// surface.
//
// There's no live sign-in integration yet — the fields let an IT admin
// capture the install's IdP contract so the next release can light up the
// auth middleware without a schema change.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PLATFORM_ACCENT } from '@platform/types'
import {
  platformApi,
  type ExternalApiCredentialRow,
  type PlatformSettingsView,
  type SsoSettings,
} from '../api/platformApi'
import { describeApiError } from '../../api'

type Protocol = 'oidc' | 'saml'

const OIDC_SECRET_API_ID = 'sso-oidc'

export function SsoTab() {
  const qc = useQueryClient()

  const { data: settings } = useQuery<PlatformSettingsView>({
    queryKey: ['platform-settings'],
    queryFn:  () => platformApi.getPlatformSettings(),
  })
  const { data: credRows = [] } = useQuery({
    queryKey: ['external-api-credentials'],
    queryFn:  () => platformApi.listExternalApiCredentials(),
    retry: false,
  })

  const saved: SsoSettings = settings?.sso ?? {}
  const clientSecretRow: ExternalApiCredentialRow | null = useMemo(
    () => credRows.find(r => r.apiId === OIDC_SECRET_API_ID) ?? null,
    [credRows],
  )

  const [draft, setDraft] = useState<SsoSettings>({
    enabled:      false,
    protocol:     null,
    emailDomains: [],
    oidc:         null,
    saml:         null,
  })
  const [domainInput, setDomainInput] = useState('')
  const [saveError,   setSaveError]   = useState<string | null>(null)
  const [showSecret,  setShowSecret]  = useState(false)
  const [clientSecretDraft, setClientSecretDraft] = useState('')

  // Re-sync from the server on load / after save. Guard with updatedAt so
  // a user editing locally doesn't get clobbered mid-edit.
  useEffect(() => {
    setDraft({
      enabled:      saved.enabled ?? false,
      protocol:     saved.protocol ?? null,
      emailDomains: saved.emailDomains ?? [],
      oidc:         saved.oidc ?? null,
      saml:         saved.saml ?? null,
    })
    setDomainInput('')
    setClientSecretDraft('')
    setShowSecret(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.updatedAt])

  const save = useMutation({
    mutationFn: (body: SsoSettings) => platformApi.updateSsoSettings(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-settings'] })
      setSaveError(null)
    },
    onError: err => setSaveError(describeApiError(err).message),
  })

  const saveSecret = useMutation({
    mutationFn: (secret: string | null) =>
      platformApi.saveExternalApiCredentials(OIDC_SECRET_API_ID, { apiKey: secret }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['external-api-credentials'] })
      setClientSecretDraft('')
      setShowSecret(false)
      setSaveError(null)
    },
    onError: err => setSaveError(describeApiError(err).message),
  })

  function addDomain() {
    const d = domainInput.trim().toLowerCase().replace(/^@/, '')
    if (!d) return
    if (draft.emailDomains?.includes(d)) { setDomainInput(''); return }
    setDraft(x => ({ ...x, emailDomains: [...(x.emailDomains ?? []), d] }))
    setDomainInput('')
  }
  function removeDomain(d: string) {
    setDraft(x => ({ ...x, emailDomains: (x.emailDomains ?? []).filter(v => v !== d) }))
  }

  function pickProtocol(p: Protocol | null) {
    setDraft(x => ({
      ...x,
      protocol: p,
      // When switching protocols, keep the inactive one's config as-is so
      // an admin flipping back doesn't lose their work, but blank the
      // active one if it's never been filled before.
      oidc: p === 'oidc' ? (x.oidc ?? { issuerUrl: '', clientId: '', scopes: ['openid', 'email', 'profile'] }) : x.oidc,
      saml: p === 'saml' ? (x.saml ?? { entityId: '' }) : x.saml,
    }))
  }

  function handleSave() {
    setSaveError(null)
    save.mutate({
      enabled:      draft.enabled,
      protocol:     draft.protocol ?? null,
      emailDomains: draft.emailDomains ?? [],
      oidc:         draft.protocol === 'oidc' ? draft.oidc : null,
      saml:         draft.protocol === 'saml' ? draft.saml : null,
    })
  }

  function handleSaveSecret() {
    const trimmed = clientSecretDraft.trim()
    if (!trimmed) { setSaveError('Enter a client secret.'); return }
    saveSecret.mutate(trimmed)
  }

  return (
    <div className="flex flex-col gap-5" data-tab-panel="sso">
      <header>
        <h2 className="text-[16px] font-semibold text-slate-900">Single Sign-On</h2>
        <p className="mt-1 text-[12px] text-slate-500">
          Identity provider configuration for this install. Users whose email ends in a configured domain are routed through SSO on login.
        </p>
      </header>

      {/* Enable toggle */}
      <section className="rounded-lg border border-slate-200 bg-white p-4" data-sso-enable>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={draft.enabled ?? false}
            onChange={e => setDraft(x => ({ ...x, enabled: e.target.checked }))}
            className="mt-0.5 h-4 w-4"
            style={{ accentColor: PLATFORM_ACCENT.primary }}
            data-sso-enable-toggle
          />
          <div>
            <p className="text-[13px] font-semibold text-slate-900">Enable SSO for this install</p>
            <p className="mt-0.5 text-[12px] text-slate-600">When off, every user signs in with their local password. Disabling does not delete the configuration below.</p>
          </div>
        </label>
      </section>

      {/* Email-domain routing */}
      <section className="rounded-lg border border-slate-200 bg-white p-4" data-sso-domains>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Email domains routed to SSO</p>
        <p className="mt-1 text-[12px] text-slate-600">
          Users whose email ends in one of these domains skip the password form and go straight to the IdP. Leave blank to let every user pick on the login screen.
        </p>
        <div className="mt-3 flex flex-wrap gap-2" data-domain-chips>
          {(draft.emailDomains ?? []).map(d => (
            <span key={d} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[12px] text-slate-700">
              @{d}
              <button
                type="button"
                onClick={() => removeDomain(d)}
                aria-label={`Remove ${d}`}
                className="text-slate-400 hover:text-red-600"
              >×</button>
            </span>
          ))}
          {(draft.emailDomains?.length ?? 0) === 0 && (
            <span className="text-[12px] italic text-slate-400">No domains yet.</span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={domainInput}
            onChange={e => setDomainInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDomain() } }}
            placeholder="e.g. acme.com"
            className="h-9 flex-1 rounded-md border border-slate-300 bg-white px-2 text-[13px]"
            data-domain-input
          />
          <button
            type="button"
            onClick={addDomain}
            disabled={!domainInput.trim()}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >Add domain</button>
        </div>
      </section>

      {/* Protocol picker */}
      <section className="rounded-lg border border-slate-200 bg-white p-4" data-sso-protocol>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Protocol</p>
        <div className="mt-2 flex gap-2" role="radiogroup" aria-label="SSO protocol">
          {([
            { id: 'oidc' as const, label: 'OIDC (OpenID Connect)' },
            { id: 'saml' as const, label: 'SAML 2.0' },
          ]).map(p => {
            const active = draft.protocol === p.id
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => pickProtocol(p.id)}
                className="rounded-md border px-4 py-2 text-[13px] font-semibold transition-colors"
                style={{
                  borderColor:     active ? PLATFORM_ACCENT.primary : '#CBD5E1',
                  backgroundColor: active ? PLATFORM_ACCENT.bgTint   : 'white',
                  color:           active ? PLATFORM_ACCENT.primary  : '#334155',
                }}
                data-protocol={p.id}
                data-protocol-active={active || undefined}
              >{p.label}</button>
            )
          })}
        </div>
      </section>

      {/* OIDC fields */}
      {draft.protocol === 'oidc' && (
        <section className="rounded-lg border border-slate-200 bg-white p-4" data-sso-oidc>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">OIDC provider</p>
          <div className="mt-3 flex flex-col gap-3">
            <Field
              label="Issuer URL"
              hint="e.g. https://login.acme.com (your IdP's .well-known/openid-configuration root)"
              value={draft.oidc?.issuerUrl ?? ''}
              onChange={v => setDraft(x => ({ ...x, oidc: { ...(x.oidc ?? { issuerUrl: '', clientId: '' }), issuerUrl: v } }))}
              placeholder="https://login.example.com"
              dataKey="oidc-issuer"
            />
            <Field
              label="Client ID"
              value={draft.oidc?.clientId ?? ''}
              onChange={v => setDraft(x => ({ ...x, oidc: { ...(x.oidc ?? { issuerUrl: '', clientId: '' }), clientId: v } }))}
              placeholder="client-abc123"
              dataKey="oidc-client-id"
            />

            {/* Client secret — stored separately so it masks like every
                other API key the admin pastes. */}
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Client secret</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {clientSecretRow?.hasApiKey && !clientSecretDraft ? (
                  <>
                    <code className="rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700">
                      {clientSecretRow.apiKeyMasked ?? '•••'}
                    </code>
                    <span className="font-mono text-[10px] text-slate-500">
                      Updated {new Date(clientSecretRow.updatedAt).toLocaleString()}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setClientSecretDraft(' ')}
                        className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
                      >Replace</button>
                      <button
                        type="button"
                        onClick={() => saveSecret.mutate(null)}
                        disabled={saveSecret.isPending}
                        className="h-8 rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-700 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                      >Clear</button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <input
                      type={showSecret ? 'text' : 'password'}
                      value={clientSecretDraft}
                      onChange={e => setClientSecretDraft(e.target.value)}
                      placeholder={clientSecretRow?.hasApiKey ? `Current: ${clientSecretRow.apiKeyMasked ?? '•••'}` : 'Paste client secret…'}
                      disabled={saveSecret.isPending}
                      className="h-8 flex-1 min-w-[180px] rounded-md border border-slate-300 bg-white px-2 font-mono text-[12px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100 disabled:opacity-50"
                      data-oidc-secret-input
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(s => !s)}
                      className="h-8 rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-700 hover:bg-slate-50"
                    >{showSecret ? 'Hide' : 'Show'}</button>
                    <button
                      type="button"
                      onClick={handleSaveSecret}
                      disabled={saveSecret.isPending || !clientSecretDraft.trim()}
                      className="h-8 rounded-md px-3 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ backgroundColor: PLATFORM_ACCENT.primary }}
                    >{saveSecret.isPending ? 'Saving…' : 'Save secret'}</button>
                    {clientSecretRow?.hasApiKey && (
                      <button
                        type="button"
                        onClick={() => { setClientSecretDraft(''); setShowSecret(false) }}
                        disabled={saveSecret.isPending}
                        className="h-8 rounded-md border border-slate-300 bg-white px-2 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >Cancel</button>
                    )}
                  </div>
                )}
              </div>
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                Stored on ExternalApiCredential as <code>{OIDC_SECRET_API_ID}</code>. Never echoed back after save.
              </p>
            </div>

            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Scopes</p>
              <input
                type="text"
                value={(draft.oidc?.scopes ?? []).join(' ')}
                onChange={e => setDraft(x => ({ ...x, oidc: { ...(x.oidc ?? { issuerUrl: '', clientId: '' }), scopes: e.target.value.split(/\s+/).filter(Boolean) } }))}
                placeholder="openid email profile"
                className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-[13px]"
                data-oidc-scopes
              />
              <p className="mt-1 text-[11px] text-slate-500">Space-separated. Defaults to <code>openid email profile</code>.</p>
            </div>
          </div>
        </section>
      )}

      {/* SAML fields */}
      {draft.protocol === 'saml' && (
        <section className="rounded-lg border border-slate-200 bg-white p-4" data-sso-saml>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">SAML provider</p>
          <div className="mt-3 flex flex-col gap-3">
            <Field
              label="Entity ID (Issuer)"
              hint="The IdP's EntityID, usually a URN or URL that uniquely names the issuer."
              value={draft.saml?.entityId ?? ''}
              onChange={v => setDraft(x => ({ ...x, saml: { ...(x.saml ?? { entityId: '' }), entityId: v } }))}
              placeholder="urn:acme:idp"
              dataKey="saml-entity-id"
            />
            <Field
              label="Metadata URL"
              hint="Optional. If set, the server auto-refreshes signing certificates from here."
              value={draft.saml?.metadataUrl ?? ''}
              onChange={v => setDraft(x => ({ ...x, saml: { ...(x.saml ?? { entityId: '' }), metadataUrl: v } }))}
              placeholder="https://idp.acme.com/metadata.xml"
              dataKey="saml-metadata-url"
            />
            <Field
              label="ACS URL (this install's callback)"
              hint="The IdP must be configured to POST SAML responses to this URL."
              value={draft.saml?.acsUrl ?? ''}
              onChange={v => setDraft(x => ({ ...x, saml: { ...(x.saml ?? { entityId: '' }), acsUrl: v } }))}
              placeholder="https://clinwrite.ai/auth/saml/callback"
              dataKey="saml-acs-url"
            />
          </div>
        </section>
      )}

      {saveError && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{saveError}</p>
      )}

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={save.isPending}
          className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          style={{ backgroundColor: PLATFORM_ACCENT.primary }}
          data-sso-save
        >{save.isPending ? 'Saving…' : 'Save SSO configuration'}</button>
      </div>
    </div>
  )
}

function Field({ label, hint, value, onChange, placeholder, dataKey }: {
  label:       string
  hint?:       string
  value:       string
  onChange:    (v: string) => void
  placeholder: string
  dataKey:     string
}) {
  return (
    <div>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</p>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-[13px]"
        data-field={dataKey}
      />
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  )
}
