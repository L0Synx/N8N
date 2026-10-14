BEGIN;
CREATE SCHEMA IF NOT EXISTS inbox;
CREATE TABLE IF NOT EXISTS inbox.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE inbox.agents (user_id uuid PRIMARY KEY, display_name text NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE TABLE inbox.contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), jid text NOT NULL UNIQUE,
 phone text, name text, created_at timestamptz NOT NULL DEFAULT now(), last_activity timestamptz
);
CREATE TABLE inbox.conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid NOT NULL UNIQUE REFERENCES inbox.contacts(id),
 instance text NOT NULL, mode text NOT NULL DEFAULT 'automatic' CHECK (mode IN ('automatic','human','paused')),
 last_message_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inbox.messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seq bigserial UNIQUE NOT NULL,
 conversation_id uuid NOT NULL REFERENCES inbox.conversations(id), external_id text,
 direction text NOT NULL CHECK(direction IN ('in','out')),
 sender text NOT NULL CHECK(sender IN ('patient','bot','agent','external','system')),
 agent_id uuid REFERENCES inbox.agents(user_id), body text NOT NULL DEFAULT '', kind text NOT NULL DEFAULT 'text',
 occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 timestamp_source text NOT NULL DEFAULT 'provider' CHECK(timestamp_source IN ('provider','received','local')),
 status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','sending','accepted','sent','delivered','read','failed','uncertain')),
 status_rank integer NOT NULL DEFAULT 0, error_code text,
 request_id uuid UNIQUE, media jsonb,
 UNIQUE(conversation_id,external_id,direction)
);
CREATE INDEX messages_timeline ON inbox.messages(conversation_id,occurred_at DESC,seq DESC);
CREATE INDEX messages_unread ON inbox.messages(conversation_id,seq) WHERE direction='in';
CREATE INDEX conversations_activity ON inbox.conversations(last_message_at DESC);
CREATE TABLE inbox.reads (
 conversation_id uuid NOT NULL REFERENCES inbox.conversations(id), user_id uuid NOT NULL REFERENCES inbox.agents(user_id),
 last_seq bigint NOT NULL DEFAULT 0, PRIMARY KEY(conversation_id,user_id)
);
CREATE TABLE inbox.message_reads (
 message_id uuid NOT NULL REFERENCES inbox.messages(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES inbox.agents(user_id), PRIMARY KEY(message_id,user_id)
);
CREATE TABLE inbox.receipts (
 jid text NOT NULL, external_id text NOT NULL, status text NOT NULL, rank integer NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(jid,external_id)
);
CREATE TABLE inbox.integration_health (id integer PRIMARY KEY CHECK(id=1), last_event_at timestamptz, rejected_count bigint NOT NULL DEFAULT 0);
INSERT INTO inbox.integration_health(id) VALUES(1);
CREATE TABLE inbox.rejected_events (
 id bigserial PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL,
 fingerprint text NOT NULL UNIQUE, normalized jsonb NOT NULL
);
CREATE TABLE inbox.audit_log (
 id bigserial PRIMARY KEY, occurred_at timestamptz NOT NULL DEFAULT now(), user_id uuid,
 conversation_id uuid REFERENCES inbox.conversations(id), action text NOT NULL, details jsonb NOT NULL DEFAULT '{}'
);
-- Las tablas no se exponen por PostgREST. El navegador solo usa Supabase Auth.
-- Sin políticas = denegación por defecto. El backend usa conexión PostgreSQL privada.
ALTER TABLE inbox.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.integration_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.rejected_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA inbox FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA inbox FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA inbox FROM PUBLIC;
INSERT INTO inbox.schema_migrations(version) VALUES('001_initial');
COMMIT;
