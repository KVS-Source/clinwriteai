-- Extend PlatformSettings with voice + sso JSONB sections (Phase 3 expansion).
-- Non-secret config lives here; provider API keys and the OIDC client secret
-- still ride on ExternalApiCredential so there's one masked-GET path for every
-- credential the admin pastes.

ALTER TABLE "platform_settings"
  ADD COLUMN "voice" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "sso"   JSONB NOT NULL DEFAULT '{}';
