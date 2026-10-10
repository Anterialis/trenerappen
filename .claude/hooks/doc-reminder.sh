#!/bin/bash
# UserPromptSubmit-hook: minner Claude på å oppdatere PROSJEKT-OPPSUMMERING.md.
# Regel: hvis det er gjort endringer i appen siden dokumentet sist ble oppdatert,
# og det er >= 1 time siden dokumentet ble oppdatert (commit eller ikke-committet
# endring), legges en påminnelse til konteksten. Maks én påminnelse per time.
# Stille (ingen utskrift) i alle andre tilfeller, og aldri feil som stopper en prompt.

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

DOC="PROSJEKT-OPPSUMMERING.md"
APP="app.js index.html style.css sw.js supabase"
HOUR=3600
now=$(date +%s)

# Dokumentet har ikke-committede endringer: det er under arbeid/oppdatert nå.
git diff --quiet HEAD -- "$DOC" 2>/dev/null || exit 0

doc_commit=$(git log -1 --format=%H -- "$DOC" 2>/dev/null)
[ -n "$doc_commit" ] || exit 0
doc_ts=$(git log -1 --format=%ct -- "$DOC")
[ $((now - doc_ts)) -ge $HOUR ] || exit 0

# Er det endret noe i appen siden dokumentet sist ble committet (committet eller ikke)?
changed=$(git rev-list --count "$doc_commit"..HEAD -- $APP 2>/dev/null)
dirty=$(git status --porcelain -- $APP 2>/dev/null | wc -l | tr -d ' ')
[ "${changed:-0}" -gt 0 ] || [ "${dirty:-0}" -gt 0 ] || exit 0

# Maks én påminnelse per time.
marker="$(git rev-parse --git-dir)/doc-reminder-ts"
if [ -f "$marker" ] && [ $((now - $(cat "$marker" 2>/dev/null || echo 0))) -lt $HOUR ]; then exit 0; fi
echo "$now" > "$marker" 2>/dev/null

msg="PÅMINNELSE (automatisk, ca. hver time): PROSJEKT-OPPSUMMERING.md er ikke oppdatert siden appen sist ble endret ($changed commits og $dirty ikke-committede filer siden). Oppdater den nå i dette svaret: les git log og git diff siden dokumentets siste commit, endre bare det som ikke stemmer lenger, slett utdatert tekst, hold teksten kort og informativ. Ikke bump versjon, ikke commit eller push med mindre brukeren ber om det (dokumentet følger med neste commit). Nevn kort for brukeren at du har oppdatert den."
jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$m}}'
exit 0
