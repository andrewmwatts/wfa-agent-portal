-- Agency branding: optional light-mode accent color. NULL/blank falls back to accent_color.
ALTER TABLE public.agencies
  ADD COLUMN IF NOT EXISTS accent_color_light text;
