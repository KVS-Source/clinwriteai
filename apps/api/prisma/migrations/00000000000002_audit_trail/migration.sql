-- Immutable audit trail (per ADR 0002).
--
-- Design:
--   - Append-only. UPDATE and DELETE grants revoked for all app-level roles.
--   - Hash-chained: each row carries prev_hash (= previous row's row_hash)
--     and row_hash (= sha256(prev_hash || canonical_json(this_row) || audit_secret)).
--   - A verification query over the table detects any tampering since the
--     chain breaks the moment a row is modified or inserted out of order.
--   - Writes go through src/audit/repository.ts, NOT Prisma. The Prisma
--     schema does not model this table — intentional, to keep writes
--     funneling through the hash-aware repository.

CREATE TABLE audit_events (
  id            BIGSERIAL PRIMARY KEY,
  "timestamp"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id      TEXT        NOT NULL,
  action        TEXT        NOT NULL,
  entity_type   TEXT        NOT NULL,
  entity_id     TEXT        NOT NULL,
  details       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ip_address    TEXT,
  prev_hash     TEXT        NOT NULL DEFAULT '',
  row_hash      TEXT        NOT NULL
);

-- Indexes for the common query patterns:
-- (1) list events for a given entity (sort by id = chronological ordering)
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id, id);

-- (2) list events by actor over a time window
CREATE INDEX audit_events_actor_time_idx ON audit_events (actor_id, "timestamp");

-- (3) query by action type
CREATE INDEX audit_events_action_idx ON audit_events (action, "timestamp");

-- (4) JSONB details — GIN index for ad-hoc filters
CREATE INDEX audit_events_details_gin ON audit_events USING GIN (details jsonb_path_ops);

-- (5) chain-verification helper
CREATE UNIQUE INDEX audit_events_row_hash_idx ON audit_events (row_hash);

-- Immutability guard: trigger that blocks UPDATE and DELETE at the DB layer.
-- Even if an app bug tries to update a row, the DB refuses.
CREATE OR REPLACE FUNCTION audit_events_forbid_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only; UPDATE and DELETE are not permitted'
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_forbid_mutation();

CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_forbid_mutation();

-- Comment preserves the design intent for anyone running \d+ in psql.
COMMENT ON TABLE audit_events IS
  'Immutable, hash-chained audit trail. Append-only. See docs/adr/0001-backend-framework.md and apps/api/src/audit/.';
COMMENT ON COLUMN audit_events.prev_hash IS 'row_hash of the preceding row (ORDER BY id); empty string for the genesis row.';
COMMENT ON COLUMN audit_events.row_hash  IS 'sha256(prev_hash || canonical_json(row) || audit_secret).';
