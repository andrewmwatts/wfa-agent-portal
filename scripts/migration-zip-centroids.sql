-- zip_centroids: public reference data mapping US ZIP/ZCTA codes to a lat/lng
-- centroid, used by the Agents → Map tab to plot agents by home ZIP.
--
-- Contains no PII — it is a static lookup table of postal geography.
-- Populate it with scripts/seed-zip-centroids.mjs (see that file's header).

CREATE TABLE IF NOT EXISTS public.zip_centroids (
  zip   text PRIMARY KEY,
  lat   double precision NOT NULL,
  lng   double precision NOT NULL,
  city  text,
  state text
);

ALTER TABLE public.zip_centroids ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.zip_centroids TO authenticated;

DROP POLICY IF EXISTS "Authenticated can read zip centroids" ON public.zip_centroids;

CREATE POLICY "Authenticated can read zip centroids"
ON public.zip_centroids
FOR SELECT
TO authenticated
USING (true);
