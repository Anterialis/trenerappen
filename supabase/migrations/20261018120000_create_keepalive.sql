-- Én rad som GitHub Actions oppdaterer hver dag (se
-- .github/workflows/keep-supabase-alive.yml). En skriving teller som
-- database-aktivitet hos Supabase, en ren select gjorde det ikke nok til å
-- hindre varsler om pausing av gratisprosjektet. Ingen persondata.
create table if not exists public.keepalive (
  id int primary key,
  ts timestamptz not null default now()
);

insert into public.keepalive (id) values (1) on conflict (id) do nothing;

alter table public.keepalive enable row level security;

create policy "Public select access" on public.keepalive for select using (true);
create policy "Public insert access" on public.keepalive for insert with check (true);
create policy "Public update access" on public.keepalive for update using (true);
