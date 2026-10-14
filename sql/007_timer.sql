ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS sets integer,
  ADD COLUMN IF NOT EXISTS per_kant boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS hold_seconden integer,
  ADD COLUMN IF NOT EXISTS rondes integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS rust_seconden integer DEFAULT 60;

UPDATE public.exercises
SET sets = 4, per_kant = false, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 1;

UPDATE public.exercises
SET sets = 4, per_kant = false, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 2;

UPDATE public.exercises
SET sets = 4, per_kant = false, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 3;

UPDATE public.exercises
SET sets = 4, per_kant = true, hold_seconden = 60, rondes = 1, rust_seconden = 60
WHERE nummer = 4;

UPDATE public.exercises
SET sets = 4, per_kant = false, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 5;

UPDATE public.exercises
SET sets = 4, per_kant = false, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 6;

UPDATE public.exercises
SET sets = 4, per_kant = false, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 7;

UPDATE public.exercises
SET sets = 4, per_kant = true, hold_seconden = 20, rondes = 4, rust_seconden = 60
WHERE nummer = 8;

UPDATE public.exercises
SET sets = 3, per_kant = true, hold_seconden = 60, rondes = 1, rust_seconden = 60
WHERE nummer = 9;

UPDATE public.exercises
SET sets = 4, per_kant = false, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 10;

UPDATE public.exercises
SET sets = 4, per_kant = false, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 11;

UPDATE public.exercises
SET sets = 4, per_kant = false, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 12;

UPDATE public.exercises
SET sets = 4, per_kant = false, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 13;

UPDATE public.exercises
SET sets = 4, per_kant = false, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 14;

UPDATE public.exercises
SET sets = 4, per_kant = false, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 15;

UPDATE public.exercises
SET sets = 2, per_kant = true, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 16;

UPDATE public.exercises
SET sets = 4, per_kant = false, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 17;

UPDATE public.exercises
SET sets = 4, per_kant = false, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 18;

UPDATE public.exercises
SET sets = 4, per_kant = false, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 19;

UPDATE public.exercises
SET sets = 2, per_kant = true, hold_seconden = NULL, rondes = 1, rust_seconden = 60
WHERE nummer = 20;
