-- PERSONVERN, STEG 2 AV 2. Kjøres først når alle telefoner har åpnet app 2.4.0 med nett.
-- Telefoner på 2.3.x mister delingen etter dette (de oppdaterer seg selv neste gang de åpnes).
--
-- Etter dette kan ingen lese, endre, liste eller slette økter direkte. Tilgang går bare gjennom
-- funksjonene fra steg 1, og krever at man kjenner koden.

drop policy if exists "Public read access" on public.sessions;
drop policy if exists "Public insert access" on public.sessions;
drop policy if exists "Public update access" on public.sessions;
drop policy if exists "Public delete access" on public.sessions;
revoke all on public.sessions from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sessions') then
    alter publication supabase_realtime drop table public.sessions;
  end if;
end $$;

-- De tresifrede kodene kan prøves ut på sekunder, så de gamle øktene slettes. Telefoner som fortsatt
-- står i en slik økt får beskjed og beholder kampen lokalt.
delete from public.sessions where length(code) < 6;
