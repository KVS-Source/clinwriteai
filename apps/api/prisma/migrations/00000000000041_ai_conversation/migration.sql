-- AI chat conversation thread per (user, document, section) — one row per
-- turn (user prompt + assistant response alternating). Powers the new
-- AIChatPanel (replaces AIAssistPanel).
--
-- Scope decisions:
--   - Private per user. actorId + (documentId, sectionId) scopes a thread.
--   - Each prompt is single-shot — LLM only sees the content the user's
--     scope chip (section|document|source) said to attach. The thread is
--     a VIEWING history, not a conversation context payload.
--   - `kind` = 'suggest' when the assistant turn contains text intended to
--     replace the section (Accept button lights up) or 'explain' when it's
--     commentary (no Accept). Lets the UI render differently without
--     parsing content.
--   - `aiCallRecordId` back-links to AiCallRecord for cost / model / tokens.

CREATE TABLE "ai_conversation_messages" (
  "id"                TEXT         NOT NULL,
  "actorId"           TEXT         NOT NULL,                     -- user id (per-user private thread)
  "documentId"        TEXT         NOT NULL,
  "sectionId"         TEXT         NOT NULL,
  "role"              TEXT         NOT NULL,                     -- 'user' | 'assistant' | 'system'
  "content"           TEXT         NOT NULL,
  "scope"             TEXT,                                      -- 'section' | 'document' | 'source' (user-chosen scope for user turns; null for assistant turns)
  "kind"              TEXT,                                      -- 'suggest' | 'explain' | null (null on user turns)
  "intent"            TEXT,                                      -- 'tighten' | 'explain' | 'custom' | 'edit' | 'draft_from_source' | null
  "aiCallRecordId"    TEXT,                                      -- back-link to AiCallRecord (null on user turns + system turns)
  "aiModel"           TEXT,                                      -- denorm from AiCallRecord so the UI doesn't need a join
  "appliedToSection"  BOOLEAN      NOT NULL DEFAULT false,       -- true after the user clicks Accept on an assistant turn
  "appliedAt"         TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_conversation_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_conversation_messages_actor_doc_sec_created_idx"
  ON "ai_conversation_messages" ("actorId", "documentId", "sectionId", "createdAt");

CREATE INDEX "ai_conversation_messages_aiCallRecordId_idx"
  ON "ai_conversation_messages" ("aiCallRecordId");
