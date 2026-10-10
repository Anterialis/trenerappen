# Instruksjoner til Claude for dette prosjektet

Les `PROSJEKT-OPPSUMMERING.md` for arkitektur, funksjoner og Supabase-oppsett før du endrer kode.

## Samtalen

- **Snakk alltid norsk** til brukeren.
- **Synkroniser mot git før du svarer på første melding i en samtale.** Brukeren jobber på to maskiner (denne Macen og en PC). Kjør `git fetch` og sjekk `git rev-list HEAD..origin/main --count`; ligger lokal branch bak: si fra og avklar (typisk `git pull`) før du leser kode eller endrer noe.
  - Gjenta det når det har gått en stund: ved varsel om at datoen har endret seg midt i samtalen, når en samtale gjenopptas etter pause, og alltid ved ny samtaleøkt.

## Før du endrer og leverer kode

- Appen er statiske filer uten build (`index.html`, `style.css`, `app.js`, `sw.js`). Ikke innfør npm/bundler/TypeScript-kompilering. ES5-stil med `var` og `.then()` i `app.js`.
- Sjekk alltid: `node --check app.js` og `npx --package typescript tsc --allowJs --checkJs --noEmit --noImplicitAny false --target es2020 --lib dom,es2020 app.js` (forventet 0 feil). Nye `var x = null;` trenger `/** @type {...} */`. Bruk `(id: string) => number`-syntaks i JSDoc, ikke `function(string):number`.
- Elementer som veksles med `el.hidden` og har en klasse med ubetinget `display`: legg til `.klasse[hidden]{display:none}`, og test begge tilstander.
- Test funksjonalitet (også delt økt med to enheter) i jsdom med mocket Supabase i scratchpad, ikke i prosjektmappa.

## Versjon, commit og push

- Bump `APP_VERSION` (`app.js`) og `CACHE_NAME` (`sw.js`) til samme versjon, og legg en kort linje øverst i `VERSION_HISTORY` (norsk, for brukere) - ved hver commit som endrer appen. **Alltid patch-økning** (2.3.3 → 2.3.4) med mindre brukeren eksplisitt ber om større.
- **Commit og push bare når brukeren ber om det** (hver runde trenger sin egen beskjed). Netlify deployer ved hver push og har begrenset kreditt: batch endringer, ca. én push per dag med mindre brukeren sier noe annet.
- Commit-meldinger på norsk, med forklaring av hvorfor.

## Hold dokumentasjonen oppdatert

- `PROSJEKT-OPPSUMMERING.md` skal alltid beskrive appen slik den er nå (arkitektur, funksjoner, tall/regler, Supabase). Slett utdatert tekst, hold den kort.
- En hook (`.claude/hooks/doc-reminder.sh`, satt opp i `.claude/settings.json`) legger inn en påminnelse når appen er endret siden dokumentet sist ble oppdatert og det er gått minst én time, maks én gang i timen. Når du ser påminnelsen: oppdater dokumentet i samme svar (les `git log`/`git diff` siden dokumentets siste commit, endre bare det som ikke stemmer). Gjør det også uoppfordret etter større endringer.
- Oppdateringen følger med neste commit. Ingen versjonsøkning og ingen egen push for ren dokumentasjon (hver push gir en Netlify-deploy).
