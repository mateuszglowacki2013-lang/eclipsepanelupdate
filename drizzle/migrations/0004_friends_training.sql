CREATE TABLE public.players (uuid text PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(), share_server boolean NOT NULL DEFAULT false, public_key text);
CREATE TABLE public.friendships (a text NOT NULL, b text NOT NULL, status text NOT NULL CHECK (status IN ('pending','accepted')), requested_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (a,b), CHECK (a < b));
CREATE TABLE public.presence (uuid text PRIMARY KEY, status text NOT NULL CHECK (status IN ('online','in_game','offline')), server_address text, mc_version text, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.messages (id bigserial PRIMARY KEY, sender text NOT NULL, recipient text NOT NULL, text text NOT NULL CHECK (char_length(text) BETWEEN 6 AND 4000 AND text LIKE 'e2e1:%'), created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz);
CREATE INDEX messages_recipient_idx ON public.messages (recipient, created_at);
CREATE TABLE public.training_uploads (id bigserial PRIMARY KEY, install_id text NOT NULL, mc_version text, received_at timestamptz NOT NULL DEFAULT now(), samples jsonb NOT NULL);
CREATE INDEX training_uploads_install_idx ON public.training_uploads (install_id, received_at);
CREATE TABLE public.movement_model (pattern text NOT NULL, move text NOT NULL, count bigint NOT NULL, players int NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (pattern, move));
CREATE TABLE public.movement_model_meta (id int PRIMARY KEY DEFAULT 1, version int NOT NULL DEFAULT 0, generated_at timestamptz, total_samples bigint NOT NULL DEFAULT 0, contributors int NOT NULL DEFAULT 0);
GRANT ALL ON public.players, public.friendships, public.presence, public.messages, public.training_uploads, public.movement_model, public.movement_model_meta TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movement_model ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movement_model_meta ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.rebuild_movement_model() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM training_uploads WHERE received_at < now() - interval '30 days';
  DELETE FROM movement_model WHERE true;
  INSERT INTO movement_model (pattern, move, count, players, updated_at)
  SELECT s->>'pattern', s->>'move', sum((s->>'count')::bigint), count(DISTINCT u.install_id), now()
  FROM training_uploads u, jsonb_array_elements(u.samples) s GROUP BY 1,2;
  INSERT INTO movement_model_meta (id, version, generated_at, total_samples, contributors)
  VALUES (1, 1, now(), (SELECT coalesce(sum(count),0) FROM movement_model), (SELECT count(DISTINCT install_id) FROM training_uploads))
  ON CONFLICT (id) DO UPDATE SET version = movement_model_meta.version + 1, generated_at = now(), total_samples = EXCLUDED.total_samples, contributors = EXCLUDED.contributors;
  DELETE FROM messages WHERE created_at < now() - interval '90 days';
END $$;
REVOKE ALL ON FUNCTION public.rebuild_movement_model() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_movement_model() TO service_role;
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('eclipse-nightly', '0 0 * * *', 'SELECT public.rebuild_movement_model()');