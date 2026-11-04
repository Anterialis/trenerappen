-- PERSONVERN, STEG 1 AV 2. Kjøres FØR app 2.4.0 legges ut.
-- Bare tillegg: ingen eksisterende regel, kolonne eller rad fjernes, så telefoner på eldre
-- versjoner virker som før. Steg 2 (som lukker selve tabellen) kjøres når alle er oppdatert.
--
-- Målet: `sessions` inneholder barnas navn, og er i dag åpen for alle. Etter steg 2 når man en
-- økt bare med koden, gjennom funksjonene under. Ingen kan liste, slette eller lese andres økter.

-- Lesekoden til foreldrelenken. Egen kode, så en lenke som deles aldri gir skrivetilgang.
alter table public.sessions add column if not exists view_code text;
create unique index if not exists sessions_view_code_key on public.sessions (view_code) where view_code is not null;

-- Stall og andre lagvalg på kontoen. Felles jsonb-kolonne, så nye valg ikke krever nye kolonner.
alter table public.team_settings add column if not exists extras jsonb not null default '{}'::jsonb;

-- Kamphistorikk kan legges inn av alle (også uten innlogging), så størrelsen begrenses.
-- not valid: gjelder nye rader og rører ikke de som finnes.
alter table public.match_history drop constraint if exists match_history_size;
alter table public.match_history add constraint match_history_size
  check (octet_length(players::text) + octet_length(goals::text) + octet_length(opponent_name) + octet_length(opponent_abbr) < 200000) not valid;

-- Tilfeldig kode uten tegn som er lette å forveksle (0/O, 1/I/L). Første tegn er alltid en
-- bokstav, så en gammel tresifret kode kan fortsatt sendes av seg selv på tredje siffer.
create or replace function public.random_session_code(p_len integer default 6)
returns text language plpgsql volatile set search_path = public as $$
declare
  v_letters text := 'ABCDEFGHJKMNPQRSTUVWXYZ';
  v_all text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  v_out text;
  v_i integer;
begin
  v_out := substr(v_letters, 1 + get_byte(v_bytes, 0) % length(v_letters), 1);
  for v_i in 1 .. p_len - 1 loop
    v_out := v_out || substr(v_all, 1 + get_byte(v_bytes, v_i) % length(v_all), 1);
  end loop;
  return v_out;
end $$;
revoke all on function public.random_session_code(integer) from public, anon, authenticated;

create or replace function public.session_rev(p_data jsonb)
returns numeric language sql immutable set search_path = public as $$
  -- 12 rader i produksjon mangler rev. De regnes som eldst, så de alltid kan oppdateres.
  select case when jsonb_typeof(p_data -> 'rev') = 'number' then (p_data ->> 'rev')::numeric else -1 end;
$$;
revoke all on function public.session_rev(jsonb) from public, anon, authenticated;

create or replace function public.create_session(p_data jsonb, p_origin text)
returns table (code text, view_code text, server_now timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_view text;
  v_try integer := 0;
begin
  if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text) > 500000 then
    raise exception 'ugyldig økt' using errcode = '22023';
  end if;
  loop
    v_try := v_try + 1;
    v_code := public.random_session_code(6);
    v_view := public.random_session_code(8);
    begin
      insert into public.sessions as s (code, data, origin, view_code) values (v_code, p_data, p_origin, v_view);
      exit;
    exception when unique_violation then
      if v_try >= 8 then raise; end if;
    end;
  end loop;
  return query select v_code, v_view, now();
end $$;

create or replace function public.get_session(p_code text)
returns table (code text, data jsonb, origin text, view_code text, updated_at timestamptz, server_now timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  -- Økter fra før denne funksjonen fantes får en lesekode første gang de hentes.
  update public.sessions as s set view_code = public.random_session_code(8)
    where s.code = p_code and s.view_code is null;
  return query
    select s.code, s.data, s.origin, s.view_code, s.updated_at, now() from public.sessions as s where s.code = p_code;
end $$;

-- Strengt nyere rev enn raden: en telefon som har sovet kan ikke rulle kampen tilbake, og to
-- samtidige skrivinger fletter i appen i stedet for at én stille overskriver den andre.
create or replace function public.update_session(p_code text, p_data jsonb, p_origin text)
returns table (updated boolean, row_found boolean, current_rev numeric, server_now timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_new numeric := public.session_rev(p_data);
  v_cur numeric;
begin
  if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text) > 500000 then
    raise exception 'ugyldig økt' using errcode = '22023';
  end if;
  update public.sessions as s set data = p_data, origin = p_origin, updated_at = now()
    where s.code = p_code and public.session_rev(s.data) < v_new;
  if found then
    return query select true, true, v_new, now();
    return;
  end if;
  select public.session_rev(s.data) into v_cur from public.sessions as s where s.code = p_code;
  return query select false, v_cur is not null, v_cur, now();
end $$;

-- Foreldrelenken: bare det visningen trenger, uten enhets-id-er.
create or replace function public.get_session_view(p_view_code text)
returns table (data jsonb, updated_at timestamptz, server_now timestamptz)
language sql stable security definer set search_path = public as $$
  select s.data - 'participants' - 'sessionOwnerDeviceId', s.updated_at, now()
  from public.sessions as s where s.view_code = p_view_code;
$$;

-- Ryddejobben (GitHub Actions). Kan bare slette det som uansett skal bort, så den er ufarlig å åpne.
create or replace function public.cleanup_old_sessions()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  delete from public.sessions as s where s.updated_at < now() - interval '60 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Sletter egen konto. Lagets innstillinger følger med (on delete cascade).
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'ikke innlogget' using errcode = '42501'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- Si fra til andre telefoner at noe er endret. Bare rev og opphav, aldri navn. Feiler dette, skal
-- selve lagringen likevel gå gjennom, og appen henter uansett jevnlig.
create or replace function public.ping_session_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform realtime.send(jsonb_build_object('rev', new.data -> 'rev', 'origin', new.origin), 'changed', 'session-' || new.code, false);
    if new.view_code is not null then
      perform realtime.send(jsonb_build_object('rev', new.data -> 'rev'), 'changed', 'view-' || new.view_code, false);
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;
revoke all on function public.ping_session_change() from public, anon, authenticated;
drop trigger if exists sessions_ping on public.sessions;
create trigger sessions_ping after update of data on public.sessions
  for each row execute function public.ping_session_change();

revoke all on function public.create_session(jsonb, text) from public;
revoke all on function public.get_session(text) from public;
revoke all on function public.update_session(text, jsonb, text) from public;
revoke all on function public.get_session_view(text) from public;
revoke all on function public.cleanup_old_sessions() from public;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.create_session(jsonb, text) to anon, authenticated;
grant execute on function public.get_session(text) to anon, authenticated;
grant execute on function public.update_session(text, jsonb, text) to anon, authenticated;
grant execute on function public.get_session_view(text) to anon, authenticated;
grant execute on function public.cleanup_old_sessions() to anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
