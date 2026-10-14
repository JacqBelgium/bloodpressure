ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS audio_intro_url_nl text,
  ADD COLUMN IF NOT EXISTS audio_intro_url_en text,
  ADD COLUMN IF NOT EXISTS halverwege_variant text;

ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_halverwege_variant_check;

ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_halverwege_variant_check
  CHECK (
    halverwege_variant IS NULL
    OR halverwege_variant IN ('default', 'wissel_arm_been', 'langzaam', 'wissel_hand')
  );

CREATE TABLE IF NOT EXISTS public.audio_fragments (
  key text NOT NULL,
  lang text NOT NULL CHECK (lang IN ('nl', 'en')),
  variant integer NOT NULL DEFAULT 0,
  text text NOT NULL,
  url text,
  PRIMARY KEY (key, lang, variant)
);

ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audio_fragments ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.exercises TO anon, authenticated;
GRANT SELECT ON TABLE public.audio_fragments TO anon, authenticated;

GRANT ALL ON TABLE public.exercises TO service_role;
GRANT ALL ON TABLE public.audio_fragments TO service_role;

DROP POLICY IF EXISTS "Exercises are readable by everyone" ON public.exercises;
CREATE POLICY "Exercises are readable by everyone"
ON public.exercises
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Audio fragments are readable by everyone" ON public.audio_fragments;
CREATE POLICY "Audio fragments are readable by everyone"
ON public.audio_fragments
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Service role can manage exercises" ON public.exercises;
CREATE POLICY "Service role can manage exercises"
ON public.exercises
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage audio fragments" ON public.audio_fragments;
CREATE POLICY "Service role can manage audio fragments"
ON public.audio_fragments
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
