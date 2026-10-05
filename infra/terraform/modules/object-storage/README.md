# object-storage module

S3 buckets with versioning + encryption + lifecycle rules + access logging.

## Buckets (planned)

- `platform-documents-<env>` — Module A document binaries + Module B publication artefacts
- `platform-voice-<env>` — voice note audio (Module A)
- `platform-exports-<env>` — generated PDFs, GPP reports, eCTD packages (short retention)
- `platform-ectd-<env>` — assembled eCTD packages pre-transmission (Module D)
- `platform-ha-correspondence-<env>` — HA inbound/outbound binaries

## Policies

- Server-side encryption with CMK (not SSE-S3)
- Public access blocked
- Versioning on
- Lifecycle: `exports` transition to IA after 30 days, delete after 180
- Access logging to a separate audit bucket
- Object Lock in compliance mode for `documents` and `ectd` buckets (Part 11 retention)
