-- 008_weekly_send_log.sql
-- Logboek van verstuurde weekmails: één regel per gebruiker per ISO-week (tijdzone Europe/Brussels).
-- /api/send-weekly-emails reserveert een regel vóór het verzenden; de unique constraint
-- voorkomt dat twee gelijktijdige runs dezelfde gebruiker mailen. Mislukt het verzenden,
-- dan verwijdert de route de regel weer zodat een volgende run het opnieuw probeert.
-- Idempotent: kan veilig opnieuw worden uitgevoerd.

create table if not exists public.weekly_send_log (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  iso_year integer not null check (iso_year between 2000 and 2100),
  iso_week integer not null check (iso_week between 1 and 53),
  sent_at timestamptz not null default now(),
  constraint weekly_send_log_week_user_key unique (iso_year, iso_week, user_email)
);

-- RLS aan zonder policies: alleen service_role (die RLS omzeilt) kan erbij.
alter table public.weekly_send_log enable row level security;

-- Expliciete rechten: sinds 30 oktober 2026 geeft Supabase nieuwe tabellen geen rechten meer.
grant select, insert, delete on table public.weekly_send_log to service_role;


-- =====================================================================================
-- EENMALIG: WEEK 46 VAN 2026 MARKEREN ALS VERSTUURD
-- De weekmail van maandag 9 november 2026 (ISO-week 46) is al verstuurd buiten dit logboek.
-- Dit blok markeert die week als verstuurd voor alle bestaande gebruikers, zodat er geen
-- herhaling komt. Expliciete waarden, bewust geen now(). Veilig om opnieuw uit te voeren
-- (bestaande regels blijven ongewijzigd).
-- =====================================================================================
insert into public.weekly_send_log (user_email, iso_year, iso_week)
select u.email, 2026, 46
from public.users u
where u.email is not null
on conflict (iso_year, iso_week, user_email) do nothing;
-- ===================================== EINDE BLOK =====================================
