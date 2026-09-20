# Trenerappen — prosjektoppsummering

## Hva dette er

En enkel-fil webapp for André, trener for et gutte-G6-lag, som skal hjelpe ham holde
styr på hvem som er ute på banen, hvem som sitter på benken, og hvor lenge — under
en fotballcup. Bygget iterativt gjennom en samtale med Claude (uten Claude Code /
IDE), og skal nå videreføres i VS Code med Claude Code.

**Filer:** `index.html` (markup), `style.css` (all CSS) og `app.js` (all JavaScript) -
delt opp fra én fil til tre i v1.8.4, da index.html hadde vokst forbi 4000 linjer og
ble tungvint å navigere. Fortsatt **ingen build-steg, ingen node_modules, ingen
bundler** - `style.css`/`app.js` er vanlige statiske filer koblet inn med
`<link rel="stylesheet">`/`<script src>`, akkurat som eksterne CDN-scripts allerede
var. Netlify serverer dem uendret, ingen kompilering. Repoet pushes til
`https://github.com/Anterialis/trenerappen.git` → Netlify (auto-deploy), hostet på
`trenerappen.netlify.app`, og brukes på iPhone via "Legg til på Hjemskjerm" (fungerer
som en enkel PWA).

**Nåværende versjon:** v1.8.4 (vises nederst i innstillinger-vinduet i appen selv).

---

## Hvorfor arkitekturen er som den er

Dette er bevisste valg gjort tidlig i prosjektet, ikke tilfeldigheter — verdt å
respektere om dere fortsetter å bygge videre:

- **Én fil, ingen build-verktøy.** André redigerer aldri koden selv — han ber Claude
  om endringer og drar den ferdige filen inn på Netlify. Et build-steg (f.eks.
  TypeScript, bundling) ble vurdert og eksplisitt avvist, siden det ville krevd
  verktøy han ikke har/vil ha, uten å adressere de faktiske feilene som har dukket
  opp underveis (se "Feil vi har funnet" nedenfor — ingen av dem var type-feil).
- **Vanlig JavaScript (ES5-aktig stil), IIFE-innpakket.** Ingen `class`, ingen
  moduler, ingen `async/await` (kun `.then()`-kjeder for Supabase-kall). Dette er et
  bevisst, konsekvent valg gjennom hele filen — ikke inkonsekvens.
- **Tidsbasert tilstand, ikke tellere.** Alle klokker (byttetid, benktid, kampklokke)
  lagrer et `sinceTs`-tidsstempel + en akkumulert base, og regner ut "nåværende verdi"
  live ved hvert render. Dette er *grunnen til* at klokkene overlever at iOS fryser
  JavaScript når skjermen låses eller appen legges i bakgrunnen — når appen våkner
  igjen, regnes riktig forløpt tid ut umiddelbart fra tidsstemplene, uten drift.
- **`localStorage` som primær lagring**, med periodisk lagring (hvert 8. sekund) og
  lagring når appen skjules, som ekstra sikkerhet.
- **Fast sideforhold-ramme** (`#viewport-frame` / `#app`), matchet mot iPhone 17 Pro
  Max (440×956pt). Fyller skjermen kant-til-kant på faktiske iPhoner; på andre
  skjermformer (Mac-nettleser) vises en avrundet, "letterboxed" ramme i stedet for å
  strekke innholdet ut av form.
- **Siden skal helst ikke kunne scrolles** (verken vertikalt eller horisontalt),
  selv om `html`/`body` fortsatt bruker vanlig dokumentflyt og ikke
  `position:fixed`+`overflow:hidden` (se "hvorfor ikke `position:fixed`" nederst
  i dette punktet).
  - `touch-action:none` på `html,body` i `style.css`, med `touch-action:pan-y`
    eksplisitt satt tilbake på hvert reelt scrollbart element (`#field`, `#bench`,
    `.modal-card`, `.suggest-list`, `.history-list`, `.version-history-list`,
    `.goal-player-list`, `.end-match-summary`) - stopper nettleserens *standard*
    panorerings-/zoom-håndtering av touch. Denne står fast.
  - **Forsøkt, men for nå fjernet igjen (2026-09-20):** en `touchmove`-listener
    på `document` som selv kalte `preventDefault()` (med mindre trykket startet
    inni et reelt scrollbart element). Den stoppet iOS sin elastiske
    "rubber-band"-bounce fullstendig - `touch-action:none` alene lot header
    midlertidig gli opp under iPhone sin halvtransparente statuslinje-overlay
    under selve draget (leste som "diffuse ikoner" helt øverst - ikke noe
    tegnet av oss, det var iOS sin egen live status-bar-dimming som traff
    header mens den var i bevegelse). André ønsket å prøve uten den først -
    en kort, elastisk bounce som alltid spretter tilbake til utgangsposisjonen
    er greit for ham; det som ikke er greit er om siden blir værende forskjøvet.
    Om `touch-action:none` alene viser seg IKKE å sprette tilbake pålitelig
    (bekreftet tidligere med skjermbilder av et vedvarende ~20px offset), er
    denne listeneren (se git-historikk rundt "JS touchmove-sperre mot
    rubber-band-bounce") den neste tingen å legge til igjen.
  - **Hvorfor ikke `position:fixed` på `#app`/`html`/`body` i stedet** (ville
    løst scroll-problemet mer direkte): `#app`/`#viewport-frame` sin høyde er
    `100dvh`, og på iOS i standalone-PWA-modus har det ved kaldstart forekommet
    at `100dvh` måles feil et lite øyeblikk før layouten regnes om - kombinert
    med `position:fixed`+`overflow:hidden` ville et slikt øyeblikk usynlig
    *kuttet av bunnen av appen* ("black bar"-bugen) i stedet for at det bare
    ble en kort, ufarlig scroll-mulighet. Se kommentaren over `#viewport-frame`
    i `style.css` for den fulle begrunnelsen. Scroll-låsen (touch-action +
    touchmove-sperre) løser selve scroll-opplevelsen uten å røre ved den
    avveiningen.

---

## Datamodell (hovedtilstanden, `state`)

```js
{
  players: [{id, name}],           // hele stallen
  onField: [id, id, ...],          // ordnet array, rekkefølge har ingen visuell betydning lenger
  onBench: [id, id, ...],
  fieldTimers: { [id]: {baseElapsedMs, sinceTs} },     // stoppeklokke for utespillere (teller oppover)
  benchTimers: { [id]: {baseElapsedMs, sinceTs} },     // stoppeklokke for benkespillere
  cumulative:  { [id]: {fieldMs, benchMs} },           // livstids-total, tvers av bytter og "Kampslutt"
  matchClock:  { baseElapsedMs, sinceTs },             // overordnet kampklokke
  globalRunning: bool,              // Play/Pause-tilstand, styrer ALLE klokker samtidig
  defaultDurationMs: number,        // standard byttetid, brukervalgt
  fieldSize: number,                // antall utespillere samtidig, låst under aktiv kamp
  wakeLockEnabled: bool             // bruker-valg for skjerm-våken-funksjonen
}
```

Persisteres i `localStorage` under nøkkelen `spillerbytte_v4`. Nøkkelen er
versjonert — den er bumpet manuelt fire ganger tidligere når datastrukturen endret
seg på en måte som ikke var bakoverkompatibel (f.eks. da `onField` gikk fra objekt
med koordinater til et rent array, og senest da `fieldTimers` gikk fra nedtelling
til stoppeklokke). **Viktig regel å videreføre:** enhver endring som endrer formen
på `state` bør bumpe `STORAGE_KEY`, ellers kan gamle lagrede tilstander krasje
appen ved oppstart.

To andre localStorage-nøkler ved siden av:
- `spillerbytte_roster_v1` — historikk over alle navn noensinne brukt (for
  hurtigvalg/autocomplete i innstillinger), uavhengig av `state`.
- `spillerbytte_session_code_v1` — hvilken delt økt-kode (om noen) denne enheten er
  koblet til (se server-delen under).

---

## Full funksjonsliste

**Kjernefunksjon**
- Fotballbane øverst (dynamisk tegnet SVG — sirkel og 16-meter beholder alltid
  riktig form uansett skjermhøyde, se `renderPitchMarkings()`), innbytterbenk
  nederst.
- Dra-og-slipp spillere mellom bane/benk.
- Trykk-trykk-bytte: marker én spiller, trykk en i motsatt sone, de bytter og
  tidene resettes.
- Stoppeklokke på både ute- og benkespillere (teller alltid oppover fra 0, aldri
  nedtelling). Utespillere: rødt utropstegn + lyd + rød skrift på klokka når
  standard byttetid er nådd — klokka fortsetter å telle etter det, ikke stopp.
- Global Play/Pause som fryser/gjenopptar *alle* klokker samtidig (inkl.
  kampklokke).
- Utespillere sortert automatisk: lengst til høyre = spilt lengst (klar for
  bytte). Benkespillere: lengst til høyre = ventet lengst.

**Historikk og rettferdighet**
- Kumulert spillertid/innbyttertid per spiller, på tvers av alle bytter og
  "Kampslutt".
- Fire rangeringssymboler (▲▲ mest, ▲ nest mest, ▼ nest minst, ▼▼ minst) vist på
  riktig spiller uansett sone, for å velge rettferdig neste kamp-oppstilling.
- "Angre"-knapp (ett nivå), gjenoppretter *nøyaktig* forrige tilstand inkl.
  tidsforløp som skjedde mens feilen sto (se `snapshotState`/`restoreState`).
- "Eksporter spillerdata" — kopierbar tekstoppsummering, manuell backup.

**Kampstyring**
- "Avslutt"-knapp (rød) → to valg:
  - **Kampslutt**: beholder lag og kumulerte tall, nullstiller kun aktuell
    periode-tid. Spør i tillegg om å automatisk sette opp neste kamp med de som
    har spilt minst på banen (animert omrokkering, ~2 sek, se
    `animateReorganization`).
  - **Avslutt og nullstill**: full reset, tilbake til navneregistrering.
- "Antall utespillere"-innstilling, låst (grået) under aktiv kamp — kun
  redigerbar rett etter full nullstilling.
- Kampklokke (stadion-look, øverst på banen).

**Robusthet for live bruk**
- Screen Wake Lock (av/på-bryter i innstillinger) — hindrer skjermlås under kamp.
- Lyd ved tid-ute (Web Audio, ingen ekstern fil).
- Periodisk + hendelsesbasert lagring, gjenoppretting ved retur fra bakgrunn.
- Systematisk fuzz-testet bytte-/dra-logikk (Node-simuleringer under utvikling)
  for å luke ut duplisering/data-tap.

**Deling mellom enheter (se egen seksjon under)**
- Ingen valg ved oppstart lenger — appen går alltid rett til navneregistrering
  (lokal, ikke delt, som standard). Deling styres av en av/på-bryter ("Del økt
  med andre") i innstillinger: PÅ oppretter en ny delt økt (tresifret kode vises
  under headeren), AV forlater økten lokalt (raden slettes ikke server-side).
  En egen knapp i innstillinger ("🔗 Bli med i delt økt") lar deg i stedet koble
  til en økt noen andre allerede har startet, via koden deres. Sanntidssynk via
  Supabase.

**Utseende**
- Apple-glasseffekter (`backdrop-filter: blur`) på modaler og info-boble.
- Fast sideforhold-ramme, avrundet/med kant kun når skjermformen ikke matcher
  iPhone.
- Eget PWA-ikon (generert med Pillow, embedet som base64 — se
  `apple-touch-icon`), full web manifest embedet som data-URI.
- Symbolforklaring i innstillinger, forklarer alle badges/symboler i appen.

---

## Server-funksjonen: Supabase (deling mellom enheter)

Dette er det eneste elementet som *ikke* er 100% klient-side. Vi bruker
**Supabase** (Postgres + sanntids-API) som en ren datalagring-i-bakgrunnen — ingen
egen backend-kode, ingen server vi drifter selv.

**Tilkobling** (i `app.js`, øverst):
```js
var SUPABASE_URL = 'https://nueguoxkynwgmynccaro.supabase.co';
var SUPABASE_KEY = 'sb_publishable_1Zsq-zFU3nmqYFrSxXzKGQ_k-peb2bV'; // offentlig nøkkel, trygg i klientkode
```
Lastes via CDN (`@supabase/supabase-js@2` UMD-bygg) — ingen npm-installasjon.

**SQL som er kjørt i Supabase sin SQL Editor** (finnes ikke som fil i repoet — kun
kjørt manuelt av André i Supabase-dashbordet):
```sql
create table if not exists sessions (
  code text primary key,
  data jsonb not null,
  origin text,
  updated_at timestamptz not null default now()
);

alter table sessions enable row level security;

create policy "Public read access" on sessions
  for select using (true);

create policy "Public insert access" on sessions
  for insert with check (true);

create policy "Public update access" on sessions
  for update using (true);

alter publication supabase_realtime add table sessions;
```
Merk: helt åpne RLS-policyer — koden (tresifret) er den eneste "nøkkelen" til en
økt, siden appen ikke har brukerinnlogging. Bevisst forenkling for et lite,
uformelt bruksområde.

**Delete-policy** (kjør denne manuelt om den ikke allerede finnes — kreves for at
opprydding-jobben i `.github/workflows/keep-supabase-alive.yml` faktisk skal
kunne slette noe, se den filen for detaljer):
```sql
create policy "Public delete access" on sessions
  for delete using (true);
```

**`match_history` / `admins`** (satt opp 2026-09-19, samme Supabase-prosjekt som
`sessions` men et helt annet tillitsmodell): den delte, varige "Historikk" på
hjemskjermen — motstander, resultat, spilletid per spiller — lagret i databasen
i stedet for `localStorage`, slik at den overlever på tvers av enheter. Enhver
enhet kan lagre et ferdig kamp-resultat uten innlogging, men **kun en admin kan
lese, endre eller slette** — håndhevet av Postgres RLS, ikke av klientkoden:
```sql
create table if not exists public.match_history (
  id uuid primary key default gen_random_uuid(),
  ended_at timestamptz not null,
  opponent_name text not null default '',
  opponent_abbr text not null default '',
  home_score integer not null default 0,
  away_score integer not null default 0,
  players jsonb not null default '[]'::jsonb,
  origin text,
  created_at timestamptz not null default now()
);
alter table public.match_history enable row level security;

-- Ingen policyer i det hele tatt her - default-deny, kun service_role
-- (aldri klientkoden) kan lese/skrive. auth.uid() alene er IKKE nok til å
-- regnes som admin - måtte også stått i denne tabellen - så et vanlig
-- Supabase Auth-signup (om det noensinne åpnes) gir ikke automatisk tilgang.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;

create policy "Public insert access" on public.match_history
  for insert with check (true);
create policy "Admin select access" on public.match_history
  for select using (exists (select 1 from public.admins where user_id = auth.uid()));
create policy "Admin update access" on public.match_history
  for update using (exists (select 1 from public.admins where user_id = auth.uid()));
create policy "Admin delete access" on public.match_history
  for delete using (exists (select 1 from public.admins where user_id = auth.uid()));
```
Admin-kontoen(e) opprettes manuelt i Supabase-dashbordet (Authentication →
Users) — appen har ingen selvregistrering. Etter å ha opprettet en bruker der,
legg dem til i `admins`:
```sql
insert into public.admins (user_id)
values ((select id from auth.users where email = 'the-admins-email@example.com'));
```
Klienten (`app.js`) logger inn via `sb.auth.signInWithPassword(...)` i
Historikk-skjermen; samme `sb`-klient som gjør de åpne `sessions`-kallene
bærer automatisk med seg admin-brukerens token etter innlogging.

**Hvordan synkroniseringen fungerer:**
- `saveState()` er delt i `saveStateLocally()` (alltid) + `pushRemoteState()` (kun
  hvis enheten er koblet til en økt) — `pushRemoteState` gjør en Supabase
  `update()` på raden med riktig `code`.
- Hver enhet har en tilfeldig generert `deviceOrigin`-streng (per sideinnlasting).
  Denne sendes med hver skriving, og brukes til å **ignorere egne ekko** når
  sanntids-oppdateringer kommer tilbake via `subscribeToSession()` — uten dette
  ville en enhet trigget en unødvendig re-render av sin egen nettopp-sendte
  endring.
- **"Siste skriving vinner"** — ingen konflikthåndtering utover det. Vurdert
  tilstrekkelig for en trener + evt. én assistent, ikke bygget for samtidig bruk
  av mange.
- `createNewSession()` genererer en tilfeldig 3-sifret kode, prøver å sette den
  inn, og prøver på nytt (inntil 5 ganger) ved kollisjon.
- `joinSession(code, onOk, onFail)` henter raden, adopterer dataene som lokal
  `state`, og abonnerer på fremtidige endringer.

**`sessions`-sanntidssynkroniseringen er ikke testet mot ekte Supabase av
Claude** — kun testet grundig med en simulert/mocket backend (se
utviklingshistorikk); bør verifiseres live (åpne appen i to faner/enheter, gjør
en endring i den ene, se at den dukker opp i den andre). `match_history`/`admins`
derimot *er* satt opp og verifisert direkte mot den ekte databasen (Supabase
CLI, `supabase db query --linked`, koblet til prosjektet via `supabase link`) —
tabellene, RLS-policyene og selve lagre/hente/slette-flyten fra appen er alle
bekreftet å faktisk virke, inkludert at en anonym `select`/`delete` blir
blokkert av RLS (tomt resultat, ingen rader slettet).

---

## Kjente begrensninger / ting å huske på videre

- **Ingen ekte konflikthåndtering** i delt økt — siste skriving vinner.
- **Ingen splash-screens** for PWA-oppstart (kun ikon + manifest, ikke egne
  oppstartsbilder per skjermstørrelse) — vurdert, men nedprioritert som lav verdi
  for innsatsen.
- Et forslag som ble diskutert men **ikke bygget**: et gult "snart tid ute"-varsel
  (f.eks. når under 30 sek gjenstår), som et forvarsel før det røde
  utropstegnet.

## Foreslått, ikke bygget

- 30-sekunders forvarsel (nevnt over).
- Splash-screens for PWA.
