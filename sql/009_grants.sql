-- 009_grants.sql
-- Rechten voor het public-schema. Vanaf 30 oktober 2026 geeft Supabase niet meer automatisch
-- rechten aan nieuwe tabellen; bij een nieuw project, preview-omgeving of db reset zijn deze nodig.
-- Opgesteld naar de live stand van 20 oktober 2026, beperkt tot wat de app gebruikt.
-- Bevat geen REVOKE, kan veilig opnieuw worden uitgevoerd.

-- Publiek leesbare tabellen (RLS bepaalt de rest)
grant select on table public.exercises to anon, authenticated;
grant select on table public.audio_fragments to anon, authenticated;
grant select on table public.audio_intro_fragments to anon, authenticated;
grant select on table public.schema_overrides to anon, authenticated;
grant select on table public.support_faq to anon, authenticated;

-- Gebruikers: eigen rij lezen (RLS)
grant select on table public.users to authenticated;

-- Server (service_role)
grant select, insert, update, delete on table public.exercises to service_role;
grant select, insert, update, delete on table public.audio_fragments to service_role;
grant select, insert, update, delete on table public.audio_intro_fragments to service_role;
grant select, insert, update, delete on table public.support_faq to service_role;
grant select on table public.schema_overrides to service_role;
grant select, insert, update on table public.users to service_role;
grant select, insert on table public.support_log to service_role;

-- Functie
-- get_current_exercise() leest ook schema_overrides, daarom select-rechten daarop voor anon, authenticated en service_role.
grant execute on function public.get_current_exercise() to anon, authenticated, service_role;
