-- Voice-aware audio storage.
-- Shared fragment rows are keyed by voice, because the same sentence can be read in NL/EN
-- by both a female and male voice. Intro fragments are stored in a dedicated table keyed by
-- exercise_nummer + lang + voice so they can be generated and versioned independently from the
-- generic shared fragments.

ALTER TABLE public.audio_fragments
  ADD COLUMN IF NOT EXISTS voice text DEFAULT 'vrouw';

UPDATE public.audio_fragments
SET voice = 'vrouw'
WHERE voice IS NULL;

ALTER TABLE public.audio_fragments
  DROP CONSTRAINT IF EXISTS audio_fragments_voice_check;

ALTER TABLE public.audio_fragments
  ADD CONSTRAINT audio_fragments_voice_check
  CHECK (
    voice IS NOT NULL
    AND voice IN ('vrouw', 'man')
  );

ALTER TABLE public.audio_fragments
  DROP CONSTRAINT IF EXISTS audio_fragments_pkey;

ALTER TABLE public.audio_fragments
  ADD PRIMARY KEY (key, lang, voice, variant);

CREATE TABLE IF NOT EXISTS public.audio_intro_fragments (
  exercise_nummer integer NOT NULL REFERENCES public.exercises(nummer),
  lang text NOT NULL CHECK (lang IN ('nl', 'en')),
  voice text NOT NULL CHECK (voice IN ('vrouw', 'man')),
  text text NOT NULL,
  url text,
  PRIMARY KEY (exercise_nummer, lang, voice)
);

ALTER TABLE public.audio_fragments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audio_intro_fragments ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.audio_fragments TO anon, authenticated;
GRANT SELECT ON TABLE public.audio_intro_fragments TO anon, authenticated;

GRANT ALL ON TABLE public.audio_fragments TO service_role;
GRANT ALL ON TABLE public.audio_intro_fragments TO service_role;

DROP POLICY IF EXISTS "Audio fragments are readable by everyone" ON public.audio_fragments;
CREATE POLICY "Audio fragments are readable by everyone"
ON public.audio_fragments
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Audio intro fragments are readable by everyone" ON public.audio_intro_fragments;
CREATE POLICY "Audio intro fragments are readable by everyone"
ON public.audio_intro_fragments
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Service role can manage audio fragments" ON public.audio_fragments;
CREATE POLICY "Service role can manage audio fragments"
ON public.audio_fragments
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage audio intro fragments" ON public.audio_intro_fragments;
CREATE POLICY "Service role can manage audio intro fragments"
ON public.audio_intro_fragments
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

