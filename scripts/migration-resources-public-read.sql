-- resources: allow anonymous + authenticated visitors to read published videos,
-- for the public /videos library page (src/pages/public/VideoLibrary.jsx), which
-- queries Supabase directly with the anon key since it's not behind portal auth.
--
-- Admin CRUD (api/resources.js) uses the service role key and bypasses RLS
-- entirely, so this does not change anything about how videos are managed.

ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.resources TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read published resources" ON public.resources;

CREATE POLICY "Public can read published resources"
ON public.resources
FOR SELECT
TO anon, authenticated
USING (is_published = true);
