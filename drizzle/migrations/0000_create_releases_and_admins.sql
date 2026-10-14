CREATE TABLE public.releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL CHECK (version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$'),
  channel text NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable','beta')),
  notes text,
  file_path text,
  external_url text,
  file_name text,
  size bigint,
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  mandatory boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  downloads integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version, channel)
);

CREATE TABLE public.admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);

GRANT SELECT ON public.releases TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.releases TO authenticated;
GRANT ALL ON public.releases TO service_role;
GRANT SELECT ON public.admins TO authenticated;
GRANT ALL ON public.admins TO service_role;

ALTER TABLE public.releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.admins WHERE user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.claim_admin()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admins) THEN
    INSERT INTO public.admins (user_id) VALUES (auth.uid());
  END IF;
END;
$$;

CREATE POLICY "Anon can read published releases" ON public.releases FOR SELECT TO anon USING (published = true);
CREATE POLICY "Admins full access to releases" ON public.releases FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Users read own admin row" ON public.admins FOR SELECT TO authenticated USING (user_id = auth.uid());