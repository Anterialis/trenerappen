-- One row per logged-in coach account, holding the same "coach defaults"
-- the app already keeps in localStorage (see loadCoachDefaults() in app.js)
-- for anyone not logged in. Column names/defaults mirror that local shape
-- 1:1 so the client can treat the two sources interchangeably.
create table if not exists public.team_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  home_team_name text not null default 'Nøtterøy',
  home_team_abbr text not null default 'NØT',
  match_duration_ms integer not null default 900000,
  default_duration_ms integer not null default 180000,
  field_size integer not null default 3,
  rank_by_cumulative boolean not null default false,
  reorg_uses_last_match boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.team_settings enable row level security;

-- Every policy is scoped to auth.uid() = user_id - a coach can only ever
-- see or touch their own single row, never anyone else's.
create policy "Users can view own team settings"
  on public.team_settings for select
  using (auth.uid() = user_id);

create policy "Users can insert own team settings"
  on public.team_settings for insert
  with check (auth.uid() = user_id);

create policy "Users can update own team settings"
  on public.team_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own team settings"
  on public.team_settings for delete
  using (auth.uid() = user_id);
