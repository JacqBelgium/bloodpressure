ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS stem_voorkeur text DEFAULT 'vrouw';

UPDATE public.users
SET stem_voorkeur = 'vrouw'
WHERE stem_voorkeur IS NULL;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_stem_voorkeur_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_stem_voorkeur_check
  CHECK (
    stem_voorkeur IS NULL
    OR stem_voorkeur IN ('vrouw', 'man')
  );
