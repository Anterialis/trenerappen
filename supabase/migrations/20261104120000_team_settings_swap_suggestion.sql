-- De to kolonnene for bytteforslag er allerede lagt til i produksjon (manuelt, da
-- funksjonen kom i v2.2), men manglet her, så en ny database bygget fra disse filene
-- ville feilet ved hver lagring av lagets innstillinger. Ufarlig å kjøre på nytt.
alter table public.team_settings
  add column if not exists swap_suggestion_basis text not null default 'match',
  add column if not exists swap_suggestion_bench_mode text not null default 'waited';
