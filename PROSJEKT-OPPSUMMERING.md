# Trenerappen - prosjektoppsummering

Webapp for André, trener for et guttelag (barnefotball, cup). Holder styr på hvem som er på banen/benken, hvor lenge, og gir rettferdige bytteforslag. Brukes på iPhone som PWA ("Legg til på Hjemskjerm"), live under kamp.

**Drift:** GitHub `Anterialis/trenerappen` → Netlify (auto-deploy ved push til `main`, `trenerappen.netlify.app`). Supabase for deling, historikk og kontoer. Arbeidsregler (versjon, sjekker, push) står i `CLAUDE.md`.

## Arkitektur (bevisste valg - respekter dem)

- **Ingen build, ingen npm, ingen bundler.** Statiske filer som Netlify serverer uendret. TypeScript/rammeverk er vurdert og avvist: feilene har vært CSS/arkitektur, ikke typer. I stedet `// @ts-check` + JSDoc i `app.js` (se `CLAUDE.md` for sjekken).
- **Vanlig JavaScript i ES5-stil, én IIFE.** Ingen `class`, moduler eller `async/await` (Supabase bruker `.then()`).
- **Tidsbasert state, ikke tellere.** Alle klokker lagrer `{baseElapsedMs, sinceTs}` og regner ut nåverdien ved hver tegning. Derfor overlever de at iOS fryser JS i bakgrunnen. Pause = flytt `sinceTs` inn i `baseElapsedMs` (`freezeTimersAt`).
- **`localStorage` er primærlagring** (nøkkel `spillerbytte_v4`), lagret ved hver endring + hvert 8. sekund lokalt + når appen skjules. Endres formen på `state` uten bakoverkompatibilitet, bump `STORAGE_KEY`; ellers løses det i `normalizeState()`.
- **Fast telefonramme** (`#viewport-frame`/`#app`, 440×956): fyller skjermen på iPhone, letterboxet "telefon" på desktop. Siden skal ikke kunne scrolles (`touch-action:none` + `touchmove`-sperre, unntatt scrollbare elementer); høyden settes fra `visualViewport` (`applyRealViewportHeight`) pga. iOS-feil ved kaldstart. Begrunnelsene står som kommentarer i `style.css`.
- **`hidden`-fellen:** en klasse som setter `display` ubetinget slår `[hidden]`. Legg til `.klasse[hidden]{display:none}` ved alle nye elementer som veksles med `el.hidden`, og test begge tilstander.

## Filer

| Fil | Innhold |
|---|---|
| `index.html` | Markup: launcher, bane/benk, alle vinduer/modaler. Henter supabase-js fra CDN. |
| `style.css` | All CSS. |
| `app.js` | All logikk (~7000 linjer), delt i seksjoner under. |
| `sw.js` | Service worker: nettverk først, cachet skall som fallback offline. `CACHE_NAME` må følge `APP_VERSION`. |
| `manifest.json`, `icon-*.png` | PWA. |
| `supabase/migrations/` | `team_settings` og `visible_until` (resten av skjemaet: se under). |
| `.github/workflows/keep-supabase-alive.yml` | Man/tor: pinger Supabase (hindrer pause av gratisprosjektet) og sletter `sessions`-rader eldre enn 60 dager. |

**`app.js` i grove trekk:** konfig/konstanter og typedefs → state (`defaultState`, `normalizeState`, lagring, `pushRemoteState`) → delt økt (`createNewSession`, `joinSession`, `subscribeToSession`, `canEdit`, `isMaster`) → konto/historikk/Mitt lag → tidsfunksjoner og rangering → undo/redo → tegning (`renderField/Bench/All`, `updateTimersOnly`) → trykk/dra/bytte → play/pause og glemt kampslutt → innstillinger (modal + skjerm) → mål/kampresultat/Kampslutt/nullstill → `init()` med alle lyttere.

## State (`state`, versjonert i `STORAGE_KEY`)

`players[{id,name}]`, `onField[]`, `onBench[]`, `fieldTimers/benchTimers{id:{baseElapsedMs,sinceTs}}`, `cumulative{id:{fieldMs,benchMs}}` (total på tvers av kamper i økten), `periodStartCumulative` (baseline for "denne kampen"), `matchClock`, `globalRunning`, `matchDurationMs`, `defaultDurationMs` (byttetid), `fieldSize`, `fieldSlotAssignment` (posisjon per plass), `goalLog`, `swapCount`, `opponentName/Abbr`, `matchHistory` (kamper i økten), innstillinger (`rankByCumulative`, `reorgUsesLastMatch`, `swapSuggestionBasis`, `swapSuggestionBenchMode`), deling (`shareEditable`, `sessionOwnerDeviceId`, `participants`), og `rev`, `lastActivityAt`, `lastPlayAt`, `continueCount`.

Andre `localStorage`-nøkler: `*_session_code_v1`, `*_device_id_v1` (stabil enhets-id), `*_coach_defaults_v1`, `*_roster_v1` (navnehistorikk), `*_coinflip_colors_v1`, `*_wakelock_v1` (per enhet), `*_history_login_lock_v1`, `spillerbytte_last_alive` (hjerteslag).

## Funksjoner

**Bane og bytter**
- Fotballbane (SVG tegnes dynamisk) med utespillere; innbytterbenk under. 1-11 på banen: 1-5 uten posisjoner, fra 6 med keeper og linjer (7: 1-3-2-1 osv.). Fra 5 har plassene faste posisjoner (K/B/M/S + venstre/midt/høyre); en innbytter arver plassen til den som går ut, og to utespillere kan bytte plass.
- Bytte: dra over en annen spiller, eller trykk én og så en i motsatt sone. «Slipp for å bytte»-kort (navn + pulserende grønn tekst) vises mens du drar over en gyldig partner. **multiBytte** (flere ut/inn samtidig) og **Forslag** (appen foreslår hvem som går ut/inn, bekreftes med nytt trykk).
- Spillerinfo-popup ved trykk: posisjon, spilletid og innbyttertid som K (denne kampen) og T (totalt), og forklaring.
- **Angre/Gjenta** (3 trinn, kun lokalt), nås fra ↩ øverst til venstre sammen med «Gå til hovedmeny».

**Tid**
- Stoppeklokke per spiller (alltid oppover), kampklokke (fryser på kamptiden) med nedtelling/overtid ved siden av. ▶/⏸ styrer alle klokker. Trykk på klokka: velg kamptid (hjul). Byttemerke ⇅: oransje når byttetiden er nådd, rødt og pulserende ved 150 %, med lyd.
- **Rangeringstrekanter** (rød ▲▲/▲ mest, blå ▼/▼▼ minst) etter denne kampen eller total, med buffer mot jevne tider (10 % → 2,5 % utover kampen). Oppdateres på klokketikket (første gang etter 30 s), på plass uten ny tegning.
- **Forslag** velger utespiller (blant dem som har passert byttetiden) etter mest spilletid denne kampen/totalt, og innbytter etter lengst ventetid siden forrige bytte eller minst spilletid denne kampen.
- **Auto-pause** av en gående klokke etter 60 min uten hjerteslag (appen lukket), uten å kreditere gapet som spilletid. Skjerm-våken (per enhet, Innstillinger på hjemskjermen).

**Mål og resultat**
- Hjemme-mål krever spiller (liste: banen først, så innbyttere, gruppert etter posisjon fra 6 på banen), borte-mål er anonyme. Tallene ved klokka: trykk = legg til, langt trykk = fjern. Bekreftelse ved nytt mål innen 30 s og ved mål på innbytter. Målmerke på spiller, målliste per spiller.
- Motstander (navn + forkortelse) spørres ved ny kamp. **Kampresultat**-popup ved Kampslutt/Avslutt: score, mål, spilletid per spiller (K og T), antall bytter.
- **Kampslutt:** beholder lag og kumulert tid, nullstiller periode, mål og klokke; spør om lagring til historikk og om automatisk omrokkering (de som har spilt minst først, etter siste kamp eller totalt). **Avslutt og nullstill:** full reset (eier). **Forlat kampen/økten** er ren navigasjon.
- «Eksporter spillerdata»: kopierbar tekst med kumulert tid og kamper i økten.

**Glemt kampslutt** (`forgottenMatchInfo`): kamptiden er ute og det har vært *kontinuerlig* stille (ingen spillhandling: bytte, mål, flytting, angre, start/pause) i (1 + antall «Fortsett») × 20 % av kamplengden, regnet fra det seneste av full tid og siste handling. Da vises arket «Kampen er satt på pause» (klokka går videre i bakgrunnen) mens appen er i bruk, ved Avslutt og når appen åpnes igjen:
- **Tilbakestill til kampslutt**: klokka og alles live-tider settes til det seneste av kamplengden og siste handling, klokka pauses, kan angres. Allerede avsluttede stints (bytter i overtiden) røres ikke.
- **Fortsett**: neste spørsmål krever 2×, 3× … så lang stille tid; klokka lyser og en boble peker på den i 10 s. Telleren nullstilles ved endret kamptid, manuell justering og Kampslutt.
- **Still manuelt**: «Trekk fra tid» eller «Sett klokka til». Samme vindu fra Korriger tid og overtidsklokka. «Fjern dødtid siden siste handling» ligger i Korriger tid.
- Gammelt spørsmål etter 1 t uten aktivitet («avslutt perioden?»), og 30 t («nullstill?»), bruker samme mål.

**Innstillinger**
- *Hjemskjermen (Innstillinger):* standardverdier for ny økt (lagnavn/forkortelse, kamptid, byttetid, kampformat 3/5/7/11, fire Kampoppførsel-valg), «Denne enheten» (skjerm-våken), symbolforklaring. Lagres lokalt, og i `team_settings` for innlogget konto.
- *Under kampen (⚙):* spillere, byttetid, Kampoppførsel for denne økten (sammenleggbar), deling, Korriger tid, eksport. Kamptid og kampformat kun ved oppsett av ny økt. Eier-valg er låst for andre deltakere.
- **Kampoppførsel** = fire to-knapps-valg (venstre = kun aktuell kamp, høyre = alle kamper i økten): trekantsymboler, «Bytt om» ved Kampslutt, bytteforslag utespiller, bytteforslag innbytter. Lagres som boolske flagg (skjult avkryssingsboks er tilstandsbærer; «Bytt om» er snudd i visningen). Tallvalg (kamptid/byttetid) er knapper i hele minutter, ikke tastatur. Titlene har samme symboler som banen.

**Launcher (hjemskjerm):** Trenerappen (Fortsett / Ny økt / Bli med med kode), Myntkast (lagfarger + kast), Innstillinger, Historikk (kun innlogget), konto-ikon (Mitt lag), versjon nederst (trykk: endringslogg `VERSION_HISTORY`).

**Oppdatering/offline:** appen henter `/app.js` uten cache, sammenligner `APP_VERSION` og laster seg selv på nytt ved ny versjon (maks ett forsøk per versjon). Service worker gir offline-oppstart.

## Delt økt (Supabase `sessions`)

- Tresifret kode = eneste "nøkkel" (RLS er åpen, ingen innlogging). **Eier** = enheten som opprettet økten (`sessionOwnerDeviceId`, stabil enhets-id); eier styrer spillere, tider, Kampoppførsel, deling, nullstilling og kan overføre eierskap til den som har vært med lengst. Tilgang for andre: Redigering eller Kun les (`canEdit()`/`isMaster()`).
- `saveState()` → lokalt + `pushRemoteState()` (update av raden). Hver enhet har en `deviceOrigin` per sideinnlasting for å ignorere eget ekko fra realtime.
- **Konflikt:** siste skriving vinner. `state.rev` øker ved hver push og forkaster *foreldede* oppdateringer (en sovende fane kan ikke overskrive en pågående kamp); `resetMatch` bevarer `rev`. Lesere skriver aldri. Angre/Gjenta-historikken tømmes når en enhet får state utenfra.
- Kode velges blant ledige (`pickFreeCode`). Synk-prikk i kodefeltet viser nett/kanal-status.

## Kontoer og historikk

- **Mitt lag:** e-post/passord via Supabase Auth (registrering i appen). Innlogget konto synkroniserer standardverdiene til `team_settings`.
- **Historikk** (delt, varig): ferdige kamper lagres til `match_history` etter spørsmål ved Kampslutt/Avslutt (motstander, resultat, mål med scorer og tid, spilletid og mål per spiller; navn lagres som tekst). Uten innlogging kan enhver enhet *legge til*; kun admin leser/endrer/sletter (RLS mot `admins`). Admin kan dele en kamp med andre innloggede i et antall dager (`visible_until`). Innloggingsforsøk begrenses lokalt (`history_login_lock`). Brukernavnet "Anterialis" er et klientalias for admin-e-posten.

### SQL som ikke ligger i `supabase/migrations/` (kjørt manuelt)

```sql
create table if not exists sessions (code text primary key, data jsonb not null, origin text, updated_at timestamptz not null default now());
alter table sessions enable row level security;
create policy "Public read access"   on sessions for select using (true);
create policy "Public insert access" on sessions for insert with check (true);
create policy "Public update access" on sessions for update using (true);
create policy "Public delete access" on sessions for delete using (true);   -- trengs av opprydding-jobben
alter publication supabase_realtime add table sessions;

create table if not exists public.match_history (
  id uuid primary key default gen_random_uuid(), ended_at timestamptz not null,
  opponent_name text not null default '', opponent_abbr text not null default '',
  home_score integer not null default 0, away_score integer not null default 0,
  players jsonb not null default '[]', goals jsonb not null default '[]',
  visible_until timestamptz, origin text, created_at timestamptz not null default now());
alter table public.match_history enable row level security;
create table if not exists public.admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.admins enable row level security;   -- ingen policyer: kun service_role
create policy "Public insert access" on public.match_history for insert with check (true);
create policy "Admin select access" on public.match_history for select using (exists (select 1 from public.admins where user_id = auth.uid()));
create policy "Admin update access" on public.match_history for update using (exists (select 1 from public.admins where user_id = auth.uid()));
create policy "Admin delete access" on public.match_history for delete using (exists (select 1 from public.admins where user_id = auth.uid()));
-- admin: insert into public.admins (user_id) values ((select id from auth.users where email = '...'));
```

**Når en ny kolonne tas i bruk i `app.js`:** legg den til i SQL/migrasjon *og* kjør `alter table` i Supabase samtidig (en insert med ukjent kolonne feiler hele raden; slik ble ingen kamp lagret til historikk i en periode). Admin-kontoer opprettes manuelt i Supabase.

## Kjente begrensninger

- Ingen felt-for-felt-sammenslåing: to samtidige redigeringer avgjøres av hvem som skriver sist. Gjelder også bytter etter full tid som allerede er lagt til spillernes totaltid (rulles ikke tilbake av «Tilbakestill til kampslutt»).
- Sanntidssynk er testet med en mocket backend og i bruk, ikke med automatiske tester mot ekte Supabase.
- Ingen splash-screens for PWA. Ikke bygget: 30-sekunders forvarsel (gult) før byttemerket.
