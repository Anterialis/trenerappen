# Trenerappen - prosjektoppsummering

Webapp for André, trener for et guttelag (barnefotball, cup). Holder styr på hvem som er på banen/benken, hvor lenge, og gir rettferdige bytter. Brukes på iPhone som PWA ("Legg til på Hjemskjerm"), live under kamp.

**Drift:** GitHub `Anterialis/trenerappen` (offentlig repo) → Netlify (auto-deploy ved push til `main`, `trenerappen.netlify.app`). Supabase for deling, historikk og kontoer. Arbeidsregler (versjon, sjekker, push) står i `CLAUDE.md`.

## Arkitektur (bevisste valg - respekter dem)

- **Ingen build, ingen npm, ingen bundler.** Statiske filer som Netlify serverer uendret. TypeScript/rammeverk er vurdert og avvist: feilene har vært CSS/arkitektur, ikke typer. I stedet `// @ts-check` + JSDoc i `app.js` (se `CLAUDE.md` for sjekken). Biblioteker ligger som enkeltfiler i `vendor/`, i fast versjon.
- **Vanlig JavaScript i ES5-stil, én IIFE.** Ingen `class`, moduler eller `async/await` (Supabase bruker `.then()`).
- **Tidsbasert state, ikke tellere.** Alle klokker lagrer `{baseElapsedMs, sinceTs}` og regner ut nåverdien ved hver tegning. Derfor overlever de at iOS fryser JS i bakgrunnen. Pause = flytt `sinceTs` inn i `baseElapsedMs` (`stopClockAt`). Delte tidsstempler bruker `nowTs()` (serverens tid), lokale (hjerteslag, utsettelser) `Date.now()`.
- **`localStorage` er primærlagring** (nøkkel `spillerbytte_v4`), lagret ved hver endring + hvert 8. sekund lokalt + når appen skjules. Endres formen på `state` uten bakoverkompatibilitet, bump `STORAGE_KEY`; ellers løses det i `normalizeState()`, som også er eneste port for data utenfra (id-er uten markup, ekte tall, hver spiller i nøyaktig én sone).
- **Endringer er operasjoner.** Alt som endrer kampen går gjennom `recordOp()`/`applyOp()`, så det kan spilles av på nytt oppå en nyere tilstand (se Delt økt). Ny mutasjon = ny `case` i `applyOp`, ikke direkte endring av `state`.
- **Fast telefonramme** (`#viewport-frame`/`#app`, 440×956): fyller skjermen på iPhone, letterboxet "telefon" på desktop. Siden skal ikke kunne scrolles (`touch-action:none` + `touchmove`-sperre, unntatt scrollbare elementer); høyden settes fra `visualViewport` (`applyRealViewportHeight`) pga. iOS-feil ved kaldstart. Begrunnelsene står som kommentarer i `style.css`.
- **`hidden`-fellen:** en klasse som setter `display` ubetinget slår `[hidden]`. Legg til `.klasse[hidden]{display:none}` ved alle nye elementer som veksles med `el.hidden`, og test begge tilstander.

## Filer

| Fil | Innhold |
|---|---|
| `index.html` | Markup: launcher, bane/benk, alle vinduer/modaler. |
| `style.css` | Grunn-CSS, og hele design A. |
| `designs.css` | Fellesdeler for nye komponenter (tokener `--ui-*`) og design B-E, valgt med `html[data-design]`. |
| `design-init.js` | Setter `data-design` før siden tegnes, så det ikke blinker. |
| `app.js` | All logikk (~8800 linjer), delt i seksjoner under. |
| `sw.js` | Service worker: appen kjører fra en lagret kopi per versjon, og en ny versjon venter til brukeren trykker «Oppdater nå». **`CACHE_NAME` og `APP_VERSION` i `sw.js` må følge `APP_VERSION` i `app.js`: uten endring her oppdager ingen telefon den nye versjonen** (`tests/` sjekker dette). Nye filer må inn i `APP_SHELL`. |
| `vendor/` | `supabase-2.118.0.min.js` og `qrcode-generator-2.0.4.js` (lastes først når QR vises). Oppdateres ved å bytte filen og navnet i `index.html`/`app.js` og `APP_SHELL`. |
| `_headers` | Content-Security-Policy m.m.: bare appens egne filer kan kjøres, data sendes bare til Supabase-prosjektet. Nye eksterne adresser må inn her. |
| `_redirects` | Holder dokumentasjon og SQL unna det offentlige nettstedet (hele mappa publiseres ellers). |
| `manifest.json`, `icon-*.png` | PWA. |
| `supabase/migrations/` | Skjemaet, se under. Kjøres for hånd eller med `supabase db query --linked -f fil`. Ikke `supabase db push`: historikken i databasen er ufullstendig (keepalive ble kjørt for hånd). |
| `tests/` | Testene (`npm test`). Egne avhengigheter, publiseres ikke. |
| `.github/workflows/keep-supabase-alive.yml` | Daglig: holder seg selv påslått, skriver til `keepalive`, sletter økter eldre enn 60 dager. Se Drift. |

**`app.js` i grove trekk:** konfig, `nowTs` og typedefs → state (`defaultState`, `normalizeState`, lagring) → synk (`pushRemoteState`, `sendRemoteState`, `reconcileWithServer`, `applyServerRow`, `mergeOntoServer`) → operasjoner (`applyOp`, `recordOp`, `setShared`) → konto/historikk/Mitt lag → tidsfunksjoner og rangering → angre → tegning (`renderField/Bench/All`, `updateTimersOnly`, `paintStint`) → trykk/dra/bytte → start/stopp og glemt kampslutt → innstillinger → mål, Kampslutt (`openEndSheet`, `endMatchPeriod`, `applyEndMatch`) → stripe, tips, alarmer, Neste bytte, bytteplan, cup, stall, deling, foreldrevisning, rapport, statistikk, design → `init()` med alle lyttere.

## State (`state`, versjonert i `STORAGE_KEY`)

`players[{id,name}]`, `onField[]`, `onBench[]`, `fieldTimers/benchTimers{id:{baseElapsedMs,sinceTs}}`, `cumulative{id:{fieldMs,benchMs}}` (total på tvers av kamper i økten), `periodStartCumulative` (baseline for "denne kampen"), `matchClock`, `globalRunning`, `matchDurationMs`, `defaultDurationMs` (byttetid), `fieldSize`, `hasKeeper`, `fieldSlotAssignment` (posisjon per plass), `goalLog`, `eventLog` (tidslinje), `swapCount`, `opponentName/Abbr`, `homeTeamName/Abbr`, `matchHistory` (kamper i økten), `halves`, `halfStage`, `planEnabled`, `cup`, `keeperMs`, `keeperNow`, innstillinger (`rankByCumulative`, `reorgUsesLastMatch`, `swapSuggestionBasis`, `swapSuggestionBenchMode`), deling (`shareEditable`, `sessionOwnerDeviceId`, `participants`, `sessionUid`), og `rev`, `opIds`, `lastActivityAt`, `lastPlayAt`, `continueCount`.

Andre `localStorage`-nøkler: `*_session_code_v1`, `*_device_id_v1` (stabil enhets-id), `*_coach_defaults_v1`, `*_roster_v1` (stallen), `*_coinflip_colors_v1`, `*_wakelock_v1`, `*_design_v1`, `*_sound_whistle_v1`, `*_sound_prewarn_v1`, `*_tips_seen_v1`, `*_end_prefs_v1`, `*_keeper_history_v1`, `*_pending_ops_v1`, `*_history_queue_v1`, `*_clock_offset_v1`, `spillerbytte_last_alive` (hjerteslag).

## Funksjoner

**Bane og bytter**
- Fotballbane med utespillere; innbytterbenk under. 1-11 på banen. Fra 5 på banen har plassene faste posisjoner; en innbytter arver plassen til den som går ut, og to utespillere kan bytte plass. **Keeper:** NFF spiller 3v3 uten keeper, 5v5 og 7v7 med (4+1 og 6+1), og det er standard (`keeperDefaultFor`). Kan overstyres for laget og per økt. Økter fra før 2.4.0 har ikke `hasKeeper` og beholder formasjonen de startet med.
- **Bytte:** dra over en annen spiller, eller trykk én og så en i motsatt sone. «Slipp for å bytte»-kort mens du drar. **multiBytte** for flere samtidig.
- **Neste bytte** står alltid over benken med ett trykk for å utføre: utespiller som har passert byttetiden, ellers den som er nærmest, med nedtelling. Keeperen foreslås ikke. Ved likt trekkes én tilfeldig, og den står til noen faktisk ikke lenger står likt (`nextSwapPick`). Følger bytteplanen hvis den er slått på.
- **Bytteplan** (`computeRotationPlan`): hvem som går ut og inn resten av kampen, med forventet spilletid per spiller. Regnes på nytt fra stillingen nå, så den justerer seg.
- **Rettferdighetslinje:** «Størst forskjell 3:20» under Neste bytte, fra ett minutt.
- **Keeper-rotasjon:** tid i mål føres per spiller (på tvers av kamper på enheten), og Kampslutt/Bytteplan foreslår neste. «Sett i mål nå» i bytteplanen.
- **Spillerinfo** ved trykk: posisjon, spilletid og innbyttertid som K (denne kampen) og T (totalt). Virker også for lesere og foreldre.
- **Angre:** stripe i 5 sekunder etter hver handling, og ↩ øverst (20 trinn, kun lokalt). Gjelder bare kamptilstand, aldri innstillinger, eierskap eller motstander. Start/stopp brukes også på snapshotene, så angre over en pause verken hopper i tid eller starter klokka. Endret spillerliste og endringer fra andre enheter tømmer historikken.

**Tid**
- Stoppeklokke per spiller, kampklokke (fryser på kamptiden) med nedtelling/overtid ved siden av. Trykk på klokka: velg kamptid. Byttemerke oransje ved byttetid, pulserende ved 150 %, med lyd.
- **Omganger:** med to omganger stopper klokka nøyaktig på halvtid (`checkMatchAlarms`). **Fløyte** ved halvtid og full tid, **forvarsel** 30 s før byttetid. Begge kan slås av per enhet. iPhone må ha skjermen på; `audioSession` gjør at lyden går gjennom stillebryteren der det støttes.
- **Rangeringstrekanter** (rød ▲▲/▲ mest, blå ▼/▼▼ minst) etter denne kampen eller total, med buffer mot jevne tider.
- **Auto-pause** av en gående klokke etter 60 min uten hjerteslag. Skjerm-våken per enhet.
- **Felles klokke:** avviket mot serveren måles fra svar med lav svartid og oppdateres ved over 500 ms.

**Mål og resultat**
- Hjemme-mål krever spiller, borte-mål er anonyme. Tallene ved klokka: trykk = legg til, langt trykk = fjern. Bekreftelse bare ved nytt mål innen 8 s; ellers Angre-stripen. Målmerke på spiller, målliste per spiller.
- **Kampslutt på ett ark** (`openEndSheet`): resultat, spilletid K/T, mål, neste keeper, to brytere (Lagre i Historikk, Sett de som spilte minst på banen først) og neste motstander. Én knapp. Etterpå: stripe med «Se rapport». Valgene huskes.
- **Kampresultat:** score, mål, spilletid, antall bytter, tidslinje, og **Del rapport** (tekst og bilde via delearket, ellers kopi).
- **Avslutt økten:** full reset (eier, krever to trykk). **Til hjemskjermen** og **Forlat delt økt** er ren navigasjon.
- «Eksporter spillerdata»: kopierbar tekst.

**Cup:** navn, kampoppsett (klokkeslett, motstander), nedtelling til neste kamp over benken, forslag til motstander ved Kampslutt, spilte kamper og total spilletid gjennom dagen. Ligger i `state.cup`, under ⚙.

**Glemt kampslutt** (`forgottenMatchInfo`): kamptiden er ute og det har vært *kontinuerlig* stille i (1 + antall «Fortsett») × 20 % av kamplengden. Da vises arket «Kampen er satt på pause»:
- **Tilbakestill til kampslutt**: klokka og alles live-tider settes til det seneste av kamplengden og siste handling, klokka pauses, kan angres.
- **Fortsett**: neste spørsmål krever lenger stille tid; klokka lyser og en boble peker på den i 10 s.
- **Still manuelt**: «Trekk fra tid» eller «Sett klokka til». «Fjern dødtid siden siste handling» ligger i Korriger tid, og regner klokketid: står klokka, er det ingen dødtid å fjerne.
- Gammelt spørsmål etter 1 t uten aktivitet («avslutt perioden?») og 30 t («nullstill?») bruker samme mål.

**Innstillinger**
- *Hjemskjermen (Innstillinger):* Utseende (fem design), hjemmelag, lagets standarder (kamptid, byttetid, kampformat, keeper, omganger), fast stall, Kampoppførsel, denne enheten (skjerm-våken, fløyte, forvarsel), symbolforklaring, logg ut, slett konto. Lagres lokalt, og i `team_settings` for innlogget konto.
- *Under kampen (⚙, «Denne kampen»):* lagnavn, spillere, byttetid, Kampoppførsel for økten, deling, Korriger tid, bytteplan, cup, eksport. Kamptid og kampformat kun ved oppsett av ny økt (kamptid også på klokka). Navn kan rettes på spillere på banen, men de kan ikke fjernes der. Bytteplan, cup og eksport vises ikke mens et nytt lag settes opp, og legger seg ellers oppå vinduet, så det som er skrevet inn består. Eier-valg er låst for andre.
- **Frammøte:** ved ny økt krysses stallen av med ett trykk, og laget står på banen fra start (de første i lista).
- **Kampoppførsel** = fire to-knapps-valg (venstre = kun aktuell kamp, høyre = alle kamper i økten).
- **Tips** første gang (`maybeTip`), og kort symbolforklaring.

**Launcher:** «Fortsett kampen» øverst når en kamp finnes. Trenerappen (Fortsett / Ny økt / Bli med med kode), Myntkast, Innstillinger, Historikk (kun innlogget), Mitt lag, versjon (trykk: endringslogg `VERSION_HISTORY`).

**Oppdatering/offline** (samme modell som Anestesiappen, `initAppUpdates`): appen starter alltid fra en komplett lagret kopi, så den er rask med dårlig dekning og virker uten nett. Ved oppstart, når den hentes frem, når nettet er tilbake og hvert 30. minutt mens den er synlig, ber den nettleseren se etter ny `sw.js`. En ny versjon lastes ned i bakgrunnen, og banneret «Versjon X er klar» med **Oppdater nå** og × vises nederst. × spør igjen neste oppstart. Lukkes appen helt uten svar, tar nettleseren selv den nye versjonen i bruk ved neste åpning. «Se etter oppdatering» ligger i versjonsvinduet. Service workeren er av på localhost og lokalt nett, så endrede filer vises straks (`?sw=on` slår den på for å teste oppdateringen). Lokal kamp tegnes med en gang ved oppstart; serveren får maks 3 s (`afterSessionSync`).

## Design

Fem design under Innstillinger, per enhet (`*_design_v1`), byttes straks. Samme DOM og funksjoner: forskjellen er CSS, pluss at JS alltid setter `--stint`, `data-level`, `--list-order` og `.level-tag`/`.stint-bar` på spillerne.
- **A Klassisk:** opprinnelig utseende (`style.css`, ingen overstyring).
- **B Forfinet:** samme oppsett, mørke flater, strammere typografi, ring rundt spillerne.
- **C Stadion:** resultattavle over hele bredden, drakter i farge, navneskilt, knappene nederst.
- **D Natt:** svart, store tall, aktivitetsringer, flytende knapperad.
- **E Oversikt:** liste i stedet for bane, sortert etter hvem som står for tur, med tiden som stolper.

B-E: ingen hvite flater, tilstand står også som tekst (BYTT, BYTT NÅ), kontrast minst 4,5:1 på tidene. Nye komponenter bruker `--ui-*`-tokener. `applyFieldDensity` leser padding og `--token-extra` fra `#field`, så designene kan flytte klokka.

**Statuslinjen:** alt innhold øverst (knapper, klokke, tekst) ligger minst 10 px under statuslinjen, mens bakgrunnen går helt opp, så iOS kan tone innholdet ut bak den ved scrolling. Avstanden settes med `max(env(safe-area-inset-top), 20px) + N` i `style.css` og `designs.css`. Nytt innhold øverst må følge samme regel.

## Delt økt (Supabase `sessions`)

- Koden er nøkkelen: 6 tegn fra et alfabet uten 0/O/1/I/L, første tegn er en bokstav (gamle tresifrede koder virker til de er ryddet bort). **Eier** = enheten som opprettet økten. Tilgang for andre: Redigering eller Kun les (`canEdit()`/`isMaster()`, håndheves i appen).
- **Tilgang går gjennom databasefunksjoner:** `create_session`, `get_session`, `update_session`, `get_session_view`. Finnes de ikke (steg 1 ikke kjørt: 404/PGRST202) brukes tabellen direkte som før (`rpcAvailable`), så app og database kan oppdateres i vilkårlig rekkefølge.
- **Skriving er betinget:** serveren tar bare imot en `rev` strengt høyere enn radens (en sovende telefon kan ikke rulle kampen tilbake). Ingenting skrives uten at noe er endret (`remoteDirty`); mislykket skriving prøves igjen av hjerteslaget.
- **Først lese, så bestemme:** etter (gjen)tilkobling, når nettet er tilbake, når appen kommer i forgrunnen, ved ping og jevnlig (30 s, 10 s uten kanal) kjører `reconcileWithServer()`. Gjelder også lesere.
- **To trenere samtidig fletter:** avvises en skriving, hentes raden og egne ubekreftede operasjoner (`pendingOps`) spilles av oppå (`mergeOntoServer`), så begge byttene overlever. `opIds` hindrer dobbel avspilling. Det som ikke er en operasjon (angre): serveren vinner og treneren får beskjed.
- **Ping:** en trigger sender bare `{rev, origin}` over Realtime Broadcast (`session-KODE`, `view-LESEKODE`), aldri navn. Mottakeren henter raden. Uten steg 1: `postgres_changes` som før.
- **Gjenbrukt kode:** `sessionUid` avslører at raden er en annen økt; enheten kobler da fra. Ingen skriving før raden er sammenlignet (`sessionVerified`).
- **Fjernoppdatering under dra** venter til fingeren slippes (`pendingRemoteRow`).
- **Bli med:** ligger det en kamp på enheten, vises hva økten inneholder og det må bekreftes. Koden sendes av seg selv ved 3 siffer eller 6 tegn.
- **Del-arket:** kode, lenke og QR for medtrener (`?okt=KODE`). Lenken åpner nettleseren, som har et annet lager enn appen på hjemskjermen, derfor vises også koden.
- **Foreldrevisning** (`?se=LESEKODE`): egen lesekode som aldri kan skrive, uten enhets-id-er, ingen knapper, ingen lagring (`spectatorCode`). Rører ikke en kamp som ligger på telefonen.

## Kontoer og historikk

- **Mitt lag:** e-post/passord via Supabase Auth. Innlogget konto synkroniserer standardverdiene til `team_settings`, og stall/omganger/keeper til `extras` (eget kall, så en manglende kolonne aldri velter lagringen). **Glemt passord** (krever riktig Site URL/Redirect URL og e-postoppsett i Supabase) og **Slett konto** (`delete_my_account`).
- **Historikk** (delt, varig): ferdige kamper lagres til `match_history` (motstander, resultat, mål, spilletid og mål per spiller; navn lagres som tekst). Uten nett venter raden i `*_history_queue_v1` og sendes senere (id fra klienten hindrer dobbeltlagring). Alle kan *legge til*; **kun admin kan lese, endre og slette** (RLS mot `admins`). Admin kan dele en kamp med innloggede i et antall dager (`visible_until`). **Statistikk** (spilletid og mål per spiller, eksport) regnes av det brukeren kan lese, altså i praksis bare admin.

### Databasen

`sessions`: `code` (pk), `data` jsonb, `origin`, `updated_at`, `view_code`. `match_history`: `id`, `ended_at`, `opponent_name/abbr`, `home/away_score`, `players`, `goals` (jsonb), `visible_until`, `origin`, `created_at`. `team_settings`: per konto, med `extras` jsonb. `admins`: `user_id`. `keepalive`: én rad.

RLS slik den faktisk er (sjekket mot produksjon 4. november 2026):
- `admins`: «Users can check their own admin status», select for `authenticated` der `auth.uid() = user_id`. Admin-kontoer legges inn for hånd.
- `match_history`: Admin select/update/delete (`exists` i `admins`), Public insert, og select for `authenticated` på delte kamper.
- `team_settings`: bare egen rad.
- `keepalive`: åpen (ingen persondata).
- `sessions`: åpen for alle (les, skriv, slett) og i `supabase_realtime` frem til steg 2 er kjørt.

**Personvern i to steg** (`supabase/migrations/`, nøyaktig denne rekkefølgen):
1. `..._personvern_steg1_rpc.sql`: **kjørt i produksjon 4. november 2026.** Bare tillegg: funksjoner, `view_code`, `extras`, ping-trigger, størrelsesgrense på `match_history`. Gamle telefoner virker som før.
2. `..._personvern_steg2_las.sql`: **ikke kjørt ennå.** Kjøres når alle telefoner har åpnet 2.4.0 med nett. Fjerner all direkte tilgang til `sessions`, tar tabellen ut av Realtime og sletter de tresifrede øktene.

**Når en ny kolonne tas i bruk i `app.js`:** legg den i en migrasjon *og* kjør den samtidig (en insert med ukjent kolonne feiler hele raden; slik ble ingen kamp lagret til historikk i en periode). Nye lagvalg legges i `extras`, ikke som kolonner.

## Drift

- **Keep-alive:** GitHub slår av planlagte jobber etter 60 dager uten aktivitet i repoet. Jobben kaller derfor «enable»-endepunktet for seg selv hver dag, uten commit (en commit gir en Netlify-deploy). At dette faktisk nullstiller 60-dagersklokka kan ikke testes før det har gått 60 dager, så en ekstra ping fra cron-job.org er anbefalt.
- **Rydding:** `cleanup_old_sessions` sletter økter uten endring på 60 dager.

## Kjente begrensninger

- Tilgang til en økt krever bare koden: den som har medtrenerkoden kan skrive, også om økten står på Kun les. Foreldrelenken er den reelle lesetilgangen.
- Testet med mock, med ekte SDK, i WebKit og Chromium, og ende til ende mot ekte Supabase og Realtime (to enheter og en forelder). Ikke på fysisk iPhone.
- Fløyte og forvarsel krever at skjermen er på. Ingen push-varsler.
- Foretrukne posisjoner per spiller og splash-screens for PWA er ikke bygget.
