# Architecture Decision Records (ADRs)

Phase 0 deliverable per [architecture-implementation-plan.md](../architecture-implementation-plan.md).

Each ADR captures **one decision**, the context that forced it, the options considered, and the consequences. We follow a lightweight Michael Nygard template.

## Status lifecycle

- **Proposed** — authored, waiting for review
- **Accepted** — team has agreed, implementation can rely on it
- **Deprecated** — superseded (link forward to the new ADR)
- **Rejected** — considered and declined (kept so we don't re-litigate)

## Review process

1. Author writes the ADR as **Proposed**
2. Team reviews on the PR; discussion lives inline
3. Tech lead marks **Accepted** when consensus reached
4. Once Accepted, the ADR is immutable except for status transitions

## Index

| # | Title | Status | Owner |
|---|---|---|---|
| 0001 | [Backend framework — Fastify vs Express](0001-backend-framework.md) | Proposed | Tech lead |
| 0002 | [ORM — Prisma vs Drizzle](0002-orm.md) | Proposed | Tech lead |
| 0003 | [Vector store — pgvector vs dedicated](0003-vector-store.md) | Proposed | AI engineer |
| 0004 | [LLM provider](0004-llm-provider.md) | Proposed | Tech lead + Legal |
| 0005 | SSO provider — Entra ID vs Okta vs Auth0 | Pending | Security |
| 0006 | Secrets manager — AWS Secrets vs Vault | Pending | DevOps |
| 0007 | Deployment target — AWS vs GCP vs Azure | Pending | DevOps + Tech lead |
| 0008 | Job queue — BullMQ vs SQS | Pending | Tech lead |
| 0009 | Diff algorithm scope | Pending | Module A owner |
| 0010 | E-signature hash scope | Pending | Compliance + Tech lead |
| 0011 | Canonical JSON indexing approach | Pending | Module D owner |
| 0012 | Claims Matrix similarity engine | Pending | AI engineer |
| 0013 | eCTD validator vendor | Pending | Regulatory SME + Procurement |

## Template

See [template.md](template.md) when authoring a new ADR.
