CREATE OR REPLACE FUNCTION public.has_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.admins)
$$;
GRANT EXECUTE ON FUNCTION public.has_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.has_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_admin() TO authenticated;