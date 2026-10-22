CREATE OR REPLACE FUNCTION public.record_release_download(release_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.releases
  SET downloads = downloads + 1
  WHERE id = release_id AND published = true;
$$;
REVOKE ALL ON FUNCTION public.record_release_download(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_release_download(uuid) TO anon, authenticated, service_role;