# secrets module

AWS Secrets Manager entries + Parameter Store SecureStrings + rotation Lambdas, per [ADR 0006](../../../../docs/adr/0006-secrets-manager.md).

## Secrets (planned)

| Name | Rotation | Source |
|---|---|---|
| `platform/<env>/db-url` | 90 days (RDS rotator) | RDS master |
| `platform/<env>/jwt-signing` | 180 days (manual) | — |
| `platform/<env>/audit-hash` | **Never** (changes break hash chain) | — |
| `platform/<env>/anthropic-api-key` | Manual | Anthropic console |
| `platform/<env>/azure-openai-key` | Manual | Azure portal |
| `platform/<env>/workos-api-key` | Manual | WorkOS dashboard |
| `platform/<env>/sendgrid-api-key` | Manual | SendGrid |
| `platform/<env>/twilio-auth-token` | Manual | Twilio |
| `platform/<env>/sentry-dsn` | Rare | Sentry |
| `platform/<env>/datadog-api-key` | Rare | Datadog |

## Parameter Store (low-sensitivity config)

| Name | Example |
|---|---|
| `/platform/<env>/cors-origin` | `https://proto.clinwrite.ai` |
| `/platform/<env>/feature-ai-gateway` | `true` |
| `/platform/<env>/feature-presence` | `true` |
| `/platform/<env>/s3-documents-bucket` | `platform-documents-dev` |
