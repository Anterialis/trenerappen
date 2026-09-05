# Trenerappen — prosjektoppsummering

## Hva dette er

En enkel-fil webapp for André, trener for et gutte-G6-lag, som skal hjelpe ham holde
styr på hvem som er ute på banen, hvem som sitter på benken, og hvor lenge — under
en fotballcup. Bygget iterativt gjennom en samtale med Claude (uten Claude Code /
IDE), og skal nå videreføres i VS Code med Claude Code.

**Fil:** `index.html` — **alt** (HTML, CSS, JavaScript) ligger i denne ene filen.
Ingen build-steg, ingen node_modules, ingen bundler. Filen lastes opp direkte til
Netlify (drag-and-drop, "Netlify Drop"), hostet på `trenerappen.netlify.app`, og
brukes på iPhone via "Legg til på Hjemskjerm" (fungerer som en enkel PWA).

**Nåværende versjon:** v1.1 (vises nederst i innstillinger-vinduet i appen selv).

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

**Tilkobling** (i `index.html`, øverst i scriptet):
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

**Ikke testet mot ekte Supabase-instans av Claude** — kjøremiljøet Claude har
jobbet i har ikke nettverkstilgang til Supabase sine servere. Logikken er testet
grundig med en simulert/mocket backend (se utviklingshistorikk), men selve
nettverks-integrasjonen bør verifiseres live (åpne appen i to faner/enheter, gjør
en endring i den ene, se at den dukker opp i den andre).

---

## Kjente begrensninger / ting å huske på videre

- **Ingen ekte konflikthåndtering** i delt økt — siste skriving vinner.
- **Ingen UI for å forlate/bytte økt** etter at man først har koblet seg til en
  (kun mulig ved full "Avslutt og nullstill", som beholder samme kode).
- **Ingen splash-screens** for PWA-oppstart (kun ikon + manifest, ikke egne
  oppstartsbilder per skjermstørrelse) — vurdert, men nedprioritert som lav verdi
  for innsatsen.
- **Ingen automatisk sletting av gamle Supabase-rader** — økter blir liggende i
  databasen for alltid med mindre noen rydder manuelt.
- Et forslag som ble diskutert men **ikke bygget**: et gult "snart tid ute"-varsel
  (f.eks. når under 30 sek gjenstår), som et forvarsel før det røde
  utropstegnet.

## Foreslått, ikke bygget

- 30-sekunders forvarsel (nevnt over).
- Splash-screens for PWA.
- Automatisk opprydding av gamle Supabase-økter.
- UI for å bytte/forlate en delt økt uten full reset.
