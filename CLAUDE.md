# Instruksjoner til Claude for dette prosjektet

- **Snakk alltid norsk** i svar til brukeren i denne samtalen/prosjektet.

- **Synkroniser mot git-repoet før du svarer på den første meldingen i en
  samtale.** Brukeren jobber på to maskiner (denne Macen og en annen PC), og
  kan ha jobbet videre på den andre maskinen sist. Kjør `git fetch`, sjekk om
  lokal branch ligger bak `origin/main` (f.eks. `git status -uno` eller
  `git rev-list HEAD..origin/main --count`), og hvis den gjør det: si fra til
  brukeren og avklar ønsket fremgangsmåte (typisk `git pull`) før du leser
  kode eller gjør endringer - ikke jobb videre ut fra en lokal kopi som kan
  være foreldet.
  - Dette trenger ikke gjentas for hver eneste melding i en pågående samtale.
  - Gjenta det derimot når det har gått en stund - konkret: hver gang du får
    et system-varsel om at datoen har endret seg midt i samtalen (tegn på at
    det har gått timer/dager siden forrige melding), eller når en samtale
    gjenopptas etter å ha vært inaktiv/pauset en stund. Et helt nytt
    samtaleøkt-oppstart teller alltid som "gått en stund", uavhengig av dato.
