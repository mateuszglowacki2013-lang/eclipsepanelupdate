CREATE TABLE public.auth_challenges (server_id text PRIMARY KEY, ip text, created_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.auth_challenges TO service_role;
ALTER TABLE public.auth_challenges ENABLE ROW LEVEL SECURITY;