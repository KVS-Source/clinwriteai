export { authApi }         from './auth'
export { projectsApi }     from './projects'
export { documentsApi }    from './documents'
export { crmApi }          from './crm'
export { meddraApi }       from './meddra'
export { publicationsApi } from './publications'

export { signaturesApi }   from './signatures'
export type { InitiateChainBody, SignRecordBody, SignatureChain, SignatureRecord } from './signatures'

export { presenceApi }     from './presence'
export type { PresenceSession, PresenceSnapshot } from './presence'

export { reportsApi }      from './reports'
export type { ProjectDashboard, TenantOverview, AiSpendReport, AuditActivityReport } from './reports'

export { taxonomyApi }     from './taxonomy'
export type { TherapeuticArea, TherapeuticAreaNode, ValidateResponse } from './taxonomy'

export { tenantsApi, membershipsApi, ssoApi, auditApi } from './tenantAdmin'
export type {
  Tenant, Membership, SsoConnection, AuditEntry, AuditPage,
  AuditVerifyResult, AuditQuery, ModuleKey,
} from './tenantAdmin'

export { ApiError }        from './client'
export { describeApiError, type DescribedError, type ErrorSeverity } from './error-handling'
