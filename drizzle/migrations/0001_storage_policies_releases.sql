CREATE POLICY "Admins manage release files" ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'releases' AND public.is_admin(auth.uid()))
WITH CHECK (bucket_id = 'releases' AND public.is_admin(auth.uid()));

CREATE POLICY "Admins read release files" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'releases' AND public.is_admin(auth.uid()));