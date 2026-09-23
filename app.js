// @ts-check
// Editor-only type checking (VS Code / tsserver reads the JSDoc types below
// and the plain-JS shapes throughout this file) - purely a dev-time safety
// net. No build step, no TypeScript compiler in the deploy path: this stays
// plain JavaScript that ships to Netlify byte-for-byte as written.
(function(){
  'use strict';

  /**
   * @typedef {Object} Player
   * @property {string} id
   * @property {string} name
   *
   * @typedef {Object} FieldTimer
   * @property {number} baseElapsedMs
   * @property {number} sinceTs
   *
   * @typedef {Object} BenchTimer
   * @property {number} baseElapsedMs
   * @property {number} sinceTs
   *
   * @typedef {Object} Cumulative
   * @property {number} fieldMs
   * @property {number} benchMs
   *
   * @typedef {Object} MatchClock
   * @property {number} baseElapsedMs
   * @property {number} sinceTs
   *
   * @typedef {Object} GoalEntry
   * @property {string} id
   * @property {'home'|'away'} team
   * @property {string|null} playerId
   * @property {number} at
   * @property {number} matchMs
   *
   * @typedef {Object} Participant
   * @property {string} deviceId
   * @property {number} joinedAt
   *
   * @typedef {Object} MatchGoalEntry
   * @property {string} playerId
   * @property {string} playerName
   * @property {number} matchMs
   *
   * @typedef {Object} MatchHistoryEntry
   * @property {string} id
   * @property {string} opponentName
   * @property {string} opponentAbbr
   * @property {number} homeScore
   * @property {number} awayScore
   * @property {number} endedAt
   * @property {Object<string, number>} playerMs
   * @property {MatchGoalEntry[]} goals
   *
   * @typedef {Object} HistoryPlayerEntry
   * @property {string} id
   * @property {string} name
   * @property {number} ms
   * @property {number} [totalMs] - lifetime cumulative field time (T), set only on the entry built by buildHistoryArchiveEntry() right when a match ends (see lastMatchSummary); local-only like durationMs/swapCount on HistoryMatchEntry, never persisted to Supabase
   * @property {number} goals
   *
   * @typedef {Object} HistoryGoalEntry
   * @property {'home'|'away'} team
   * @property {string} scorerName
   * @property {number} matchMs
   *
   * @typedef {Object} HistoryMatchEntry
   * @property {string} id
   * @property {number} endedAt
   * @property {string} opponentName
   * @property {string} opponentAbbr
   * @property {number} homeScore
   * @property {number} awayScore
   * @property {HistoryPlayerEntry[]} players
   * @property {HistoryGoalEntry[]} goals
   * @property {number} [durationMs] - only set on the entry built by buildHistoryArchiveEntry() right when a match ends (see lastMatchSummary); never persisted to Supabase, so absent on anything fetched back via fetchMatchHistory()
   * @property {number} [swapCount] - number of field<->bench swaps during this match, snapshotted the same way as durationMs (local-only, never persisted to Supabase)
   * @property {number|null} [visibleUntil] - set by the admin (see setMatchVisibility()) to share this match with signed-in non-admin accounts until this timestamp; absent/null means admin-only, the default for every match
   *
   * @typedef {Object} AppState
   * @property {Player[]} players
   * @property {string[]} onField
   * @property {string[]} onBench
   * @property {Object<string, FieldTimer>} fieldTimers
   * @property {Object<string, BenchTimer>} benchTimers
   * @property {Object<string, Cumulative>} cumulative
   * @property {Object<string, Cumulative>} periodStartCumulative
   * @property {MatchClock} matchClock
   * @property {boolean} wakeLockEnabled
   * @property {number} fieldSize
   * @property {string[]|null} fieldSlotAssignment - index = formation slot (see fieldSlotList()), value = the onField player id standing there; null when fieldHasPositions() is false (fieldSize < 5, no fixed positions) or not yet reconciled - see syncFieldSlots()
   * @property {boolean} globalRunning
   * @property {number} defaultDurationMs
   * @property {number} matchDurationMs
   * @property {boolean} rankByCumulative
   * @property {boolean} reorgUsesLastMatch
   * @property {boolean} shareEditable
   * @property {string|null} sessionOwnerDeviceId
   * @property {Participant[]} participants
   * @property {GoalEntry[]} goalLog
   * @property {number} swapCount - count of field<->bench swaps in the match/period in progress right now, reset alongside goalLog (see endMatchPeriod/resetMatch)
   * @property {number} lastActivityAt
   * @property {string} opponentName
   * @property {string} opponentAbbr
   * @property {MatchHistoryEntry[]} matchHistory
   * @property {number} rev
   *
   * @typedef {{id: string, zone: 'field'|'bench'}} Selection
   */

  var SUPABASE_URL = 'https://nueguoxkynwgmynccaro.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_1Zsq-zFU3nmqYFrSxXzKGQ_k-peb2bV';
  // window.supabase comes from the CDN script tag above, not a module import,
  // so the type checker has no declaration for it - treat it as untyped here.
  var supabaseGlobal = /** @type {any} */ (window).supabase;
  var sb = (supabaseGlobal && supabaseGlobal.createClient)
    ? supabaseGlobal.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;
  var SESSION_CODE_KEY = 'spillerbytte_session_code_v1';
  var deviceOrigin = 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  // Stable per-device id (survives reloads, unlike deviceOrigin above which
  // is fresh every page load) - used to recognize "this device created the
  // session" for the read-only sharing mode, so the owner keeps edit rights
  // even after e.g. checkForUpdate's auto-reload.
  var DEVICE_ID_KEY = 'spillerbytte_device_id_v1';
  var deviceId = '';
  try {
    deviceId = localStorage.getItem(DEVICE_ID_KEY) || '';
    if (!deviceId){ deviceId = uid(); localStorage.setItem(DEVICE_ID_KEY, deviceId); }
  } catch(e){ deviceId = uid(); }
  /** @type {string|null} */
  var sessionCode = null;
  /** @type {any} */
  var realtimeChannel = null;

  // Reassigned by loadCoachDefaults()/the Settings screen's "Lagre" - starts
  // out matching the scoreboard's original hardcoded "NØT"/"Nøtterøy" values
  // for anyone who's never opened Settings, so nothing changes for them.
  var HOME_TEAM_NAME = 'Nøtterøy';
  var HOME_TEAM_ABBR = 'NØT';
  var STORAGE_KEY = 'spillerbytte_v4';
  // Local-only "coach defaults" - what a new session/Ny økt starts prefilled
  // with (home team, kamptid, byttetid, kampformat, kumulert rangering,
  // "bytt om" sort rule), edited from the Innstillinger screen. Deliberately
  // separate from STORAGE_KEY's synced session `state`: these are per-device
  // preferences that should survive Ny økt/Avslutt, not match data. No
  // Supabase table exists yet for these (see the "Mitt lag" placeholders
  // below) - this is the promised "local cache first" layer underneath that,
  // built to work fully standalone before any account system exists.
  var COACH_DEFAULTS_KEY = 'spillerbytte_coach_defaults_v1';
  /**
   * @typedef {Object} CoachDefaults
   * @property {string} homeTeamName
   * @property {string} homeTeamAbbr
   * @property {number} matchDurationMs
   * @property {number} defaultDurationMs
   * @property {number} fieldSize
   * @property {boolean} rankByCumulative
   * @property {boolean} reorgUsesLastMatch
   */
  /** @returns {CoachDefaults} */
  function loadCoachDefaults(){
    // Matches today's actual defaultState() values exactly, except
    // matchDurationMs - explicitly asked to be 15 min instead of the old
    // 20 min baseline, for anyone who's never touched Settings too.
    var fallback = {
      homeTeamName: 'Nøtterøy', homeTeamAbbr: 'NØT',
      matchDurationMs: 900000, defaultDurationMs: 180000, fieldSize: 3,
      rankByCumulative: false, reorgUsesLastMatch: false
    };
    try {
      var raw = localStorage.getItem(COACH_DEFAULTS_KEY);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return {
        homeTeamName: typeof parsed.homeTeamName === 'string' && parsed.homeTeamName ? parsed.homeTeamName : fallback.homeTeamName,
        homeTeamAbbr: typeof parsed.homeTeamAbbr === 'string' && parsed.homeTeamAbbr ? parsed.homeTeamAbbr : fallback.homeTeamAbbr,
        matchDurationMs: typeof parsed.matchDurationMs === 'number' && parsed.matchDurationMs > 0 ? parsed.matchDurationMs : fallback.matchDurationMs,
        defaultDurationMs: typeof parsed.defaultDurationMs === 'number' && parsed.defaultDurationMs > 0 ? parsed.defaultDurationMs : fallback.defaultDurationMs,
        fieldSize: typeof parsed.fieldSize === 'number' && parsed.fieldSize > 0 ? parsed.fieldSize : fallback.fieldSize,
        rankByCumulative: !!parsed.rankByCumulative,
        reorgUsesLastMatch: !!parsed.reorgUsesLastMatch
      };
    } catch(e){ return fallback; }
  }
  /** @param {CoachDefaults} defaults */
  function saveCoachDefaults(defaults){
    try { localStorage.setItem(COACH_DEFAULTS_KEY, JSON.stringify(defaults)); }
    catch(e){ console.warn('Kunne ikke lagre standardverdier', e); }
    applyHomeTeamName(defaults.homeTeamName, defaults.homeTeamAbbr);
  }
  // Updates the scoreboard's "NØT"/"Nøtterøy" and the Kampresultat popup's
  // headline together - the two places HOME_TEAM_NAME/HOME_TEAM_ABBR feed,
  // see their own declaration comment above.
  /** @param {string} name @param {string} abbr */
  function applyHomeTeamName(name, abbr){
    HOME_TEAM_NAME = name;
    HOME_TEAM_ABBR = abbr;
    if (els.homeTeamLabel) els.homeTeamLabel.textContent = abbr;
    if (els.homeScoreBtn) els.homeScoreBtn.setAttribute('aria-label', 'Registrer mål for ' + name);
  }
  var ROSTER_KEY = 'spillerbytte_roster_v1';
  var COINFLIP_COLORS_KEY = 'spillerbytte_coinflip_colors_v1';
  var LAST_ALIVE_KEY = 'spillerbytte_last_alive'; // plain heartbeat, not synced state - see checkIdleAutoPause()
  var IDLE_AUTO_PAUSE_MS = 60 * 60 * 1000; // auto-pause a running match after this long with no heartbeat
  // Thresholds for checkLongIdleSuggestion() below - based on state.lastActivityAt
  // (synced, stamped on every real mutation - see saveState()), not the local
  // heartbeat above, so a device that was simply closed for a while doesn't
  // suggest ending/resetting a match someone else kept playing in the meantime.
  var IDLE_END_PERIOD_SUGGEST_MS = 60 * 60 * 1000; // 1t uten hendelser -> foreslå Kampslutt
  // 30t (ikke 24t) - en cupdag kan ha flere kamper med mange timer, eller
  // til og med til neste dag, mellom hver: "Kampslutt" i seg selv teller
  // som aktivitet (stempler lastActivityAt), så denne terskelen bare
  // beskytter mot at en økt glemt i ukesvis ligger og venter forgjeves.
  var IDLE_RESET_SUGGEST_MS = 30 * 60 * 60 * 1000; // 30t uten hendelser -> foreslå nullstilling
  // "Ikke spør igjen på en stund" (see idleSuggestSnoozeBtn) - deliberately
  // local-only (localStorage, not synced state): a per-device "I heard you,
  // stop asking" preference, same as LAST_ALIVE_KEY above, not something
  // that should propagate to other devices in a shared session.
  var IDLE_SUGGEST_SNOOZE_MS = 24 * 60 * 60 * 1000;
  var IDLE_SUGGEST_SNOOZE_KEY_PREFIX = 'spillerbytte_idle_snooze_';

  // Single source of truth for the version shown on the launcher - bump on
  // every push (see checkForUpdate below, which parses this same line back
  // out of the live deployed file to detect when a newer version exists).
  var APP_VERSION = '2.1.17';
  var UPDATE_ATTEMPT_KEY = 'spillerbytte_update_attempt_v1';

  // Changelog shown in #versionHistoryModal (tapped from the short "vX.Y"
  // footer on the launcher) - newest first, one entry per version bump.
  // Keep each note short (roughly 10-15 words); it's a footnote, not
  // release notes.
  var VERSION_HISTORY = [
    { version: '2.1.15', text: 'Mer luft mellom midtforsvareren og keeperen ved 7v7/11v11 osv. - flyttet forsvarsraden opp i stedet for keeperen ned, så den ikke kommer nær målstreken.' },
    { version: '2.1.14', text: 'Målscorer-listen viser nå utespillerne øverst (sortert etter posisjon ved 6+ på banen, ellers alfabetisk) og innbyttere under en delelinje.' },
    { version: '2.1.13', text: 'Justert spillerinfo-vinduet: smalere, ryddigere tidsvisning, mer luft under navnet, og et rent rødt lukkesymbol uten sirkel.' },
    { version: '2.1.12', text: 'Spillerinfo-vinduet dekker nå klokka i stedet for banen, så et trykk der aldri lenger treffer en spiller under det ved et uhell. Rød lukkeknapp, trykk utenfor for å lukke.' },
    { version: '2.1.11', text: 'Faste posisjoner fra 5v5 og oppover - dra spillere direkte til en posisjon (f.eks. høyre midtbane), eller bytt to på banen direkte. Fjernet pil opp/ned i tallfelt.' },
    { version: '2.1.10', text: 'Spillerne på banen står nå i ekte formasjon (forsvar/midtbane/angrep, keeper nederst) i stedet for en løs klynge - tilpasset antall på banen.' },
    { version: '2.1.9', text: 'Fikset at «Ny økt»/«Avslutt og nullstill» beholdt gamle kamptid/byttetid/antall-på-banen-verdier i stedet for de nye fra Innstillinger.' },
    { version: '2.1.8', text: 'Fikset at Mitt lag/Historikk-innloggingsvinduet vises lyst i stedet for mørkt (en CSS-spesifisitetsfeil holdt den tiltenkte mørke bakgrunnen nede).' },
    { version: '2.1.7', text: 'Mer luft under tilbake-knappen i Innstillinger, og litt mer klaring fra toppen for alle knapper/varsler nær statuslinjen.' },
    { version: '2.1.6', text: 'Innloggingsfelt er nå lyse med mørk tekst (iOS lot seg ikke overstyre til mørkt). Innlogging på «Mitt lag» går nå rett videre til Innstillinger.' },
    { version: '2.1.5', text: 'Fikset uleselig hvit tekst på hvit bakgrunn i innloggingsfelter når iOS/Safari autofyller e-post eller passord.' },
    { version: '2.1.4', text: 'Fikset at «Mitt lag» viste innlogging selv om du var innlogget, og at «Logg ut»-knappen i Innstillinger ikke oppdaterte seg synlig.' },
    { version: '2.1.3', text: 'Fikset at innstillingsvinduet ble klemt sammen og avskåret når tastaturet dukket opp (kolliderte med en eldre viewport-justering).' },
    { version: '2.1.2', text: 'Innstillingsvinduet før kampstart har fått mørkt design (samme stil som Innstillinger-siden). Fikset ødelagt scroll og gjennomsiktig bakgrunn der.' },
    { version: '2.1.1', text: 'Uavgjort får nå eget symbol i Kampresultat. Fikset at spilletid kunne telles dobbelt ved Kampslutt, og to visningsfeil (Mitt lag, vær-symbol).' },
    { version: '2.1', text: 'Nytt Kampresultat-vindu med seier/tap-symboler. «Mitt lag»-innlogging og Innstillinger for lagets standardverdier. Historikk kan nå deles med innloggede brukere.' },
    { version: '2.0.7', text: 'Målene i Historikk viser nå tidspunkt for hver scoring. Ny "Kampen er ferdig"-oppsummering vises rett etter Kampslutt/Avslutt.' },
    { version: '2.0.6', text: 'Sikret delt økt mot at en inaktiv enhet kan overskrive en aktiv kamp med gamle data. Innlogging til Historikk kan nå også skje med brukernavn.' },
    { version: '2.0.5', text: 'Fikset blått felt nederst ved første åpning i portrettmodus (iOS-kaldstart målte skjermhøyden litt for lavt før den rettet seg selv ved rotasjon).' },
    { version: '2.0.4', text: 'Lagt touchmove-sperren mot rubber-band-scroll tilbake - touch-action alene holdt ikke siden fikset.' },
    { version: '2.0.3', text: 'Forsøk: fjernet touchmove-sperren igjen (beholder kun touch-action-CSS-en) for å se om den alene holder siden fra å scrolle.' },
    { version: '2.0.2', text: 'Stoppet at siden fortsatt kunne "gynge" opp/ned ved dra-forbi-kant (touch-action alene var ikke nok til å hindre iOS sin egen elastiske bounce).' },
    { version: '2.0.1', text: 'Mer klaring mellom header-knappene og iPhone sin statuslinje (var diffuse i toppen). Fikset at valg fra spillernavn-listen fortsatt kunne hoppe til feil navnefelt.' },
    { version: '2.0', text: 'Full gjennomgang av Symbolforklaring og om appen - alle ikoner (mål, "i", Bytt) er nå forklart. Presisert at "Kumulert rangering" kun styrer trekant-symbolene, ikke selve tidsberegningen.' },
    { version: '1.9.13', text: 'Spillerboblen viser nå både total og kamp-tid (T/K), med forklaring via "i". Nytt "Bytt"-symbol viser hvordan man bytter valgt spiller med en annen.' },
    { version: '1.9.12', text: 'Nytt målsymbol (fotballmål) i stedet for fotballen. Fikset at spillernavn-listen kunne hoppe over navnefelt ved valg fra forslagslisten.' },
    { version: '1.9.11', text: 'Innlogging til Historikk er nå en egen popup med lås-ikon og begrenset antall forsøk. Ny lås/åpen-badge på Historikk-fliken.' },
    { version: '1.9.10', text: 'Historikk er nå delt i skyen (ikke bare denne enheten) - alle kan lagre en kamp, men kun admin kan logge inn for å se eller slette.' },
    { version: '1.9.9', text: 'Spør nå om lagring til historikk ved Kampslutt/Avslutt/Ny økt, i stedet for en fast innstilling. Kun én "Er du sikker?"-knapp av gangen. Kampslutt/Avslutt omdøpt.' },
    { version: '1.9.8', text: 'Fikset at OK-knappen kunne flytte seg ved utfylling av spillernavn. Fjernet sirkelen rundt info-/×-symbolene. Oppdatert symbolforklaring og eksport.' },
    { version: '1.9.7', text: '"Er du sikker?"-bekreftelse med kryss lagt til på Kampslutt, Avslutt og nullstill, Overfør økt-eier og Ny økt.' },
    { version: '1.9.6', text: 'Info-knappene flyttet inn i selve Avslutt-knappene. Versjonsnummer og endringslogg lagt til på hjemskjermen.' },
    { version: '1.9.5', text: 'Ny "Historikk" på hjemskjermen som lagrer gamle kamper lokalt. Automatisk innlogging med kode og tastatur som lukkes selv.' },
    { version: '1.9.4', text: 'Nytt merke-design på snarveiknappene på innbytterbenken. Redesignet motstander-vindu og større Trenerappen-ikon.' },
    { version: '1.9.3', text: 'Fikset trang knapperad i liggende modus. La til "Lukk Trenerappen" for økt-eiere.' },
    { version: '1.9.2', text: 'Fikset avkuttet knappetekst på iPad i liggende modus og en låsning ved "bli med i økt".' },
    { version: '1.9.1', text: 'La til eier/deltaker-roller for delte økter, med mulighet til å overføre eierskap til en annen.' },
    { version: '1.9', text: 'Fikset gammel innstillingsvisning ved å bli med i en økt. La til tidsstempel per registrert mål.' },
    { version: '1.8.5', text: 'Fikset flere mindre logikkfeil, blant annet i "Fjern siste mål" og oppstart av en ny økt.' },
    { version: '1.7', text: 'Redesignet multiBytte- og avbryt-knappene på innbytterbenken for bedre synlighet.' }
  ];

  // Runs at startup (and when iOS restores a suspended PWA tab from its
  // back-forward cache instead of doing a real reload) to make sure the
  // device isn't stuck on a cached copy from before the last Netlify
  // deploy. Fetches this same URL bypassing HTTP cache, reads the
  // APP_VERSION the *live* file declares, and if it differs, navigates to
  // a cache-busted URL so the browser/PWA is forced to fetch fresh HTML.
  // Guarded by sessionStorage so a mismatch that persists after one
  // reload attempt (e.g. slow CDN propagation) can't loop forever.
  function checkForUpdate(){
    // APP_VERSION lives in this file now (index.html just <script src>'s
    // it), so the version-check fetch has to target app.js, not the page.
    fetch('/app.js', { cache: 'no-store' })
      .then(function(res){ return res.ok ? res.text() : null; })
      .then(function(js){
        if (!js) return;
        var m = js.match(/APP_VERSION\s*=\s*'([^']+)'/);
        if (!m || m[1] === APP_VERSION) return;
        var target = m[1];
        /** @type {string|null} */
        var lastAttempt = null;
        try { lastAttempt = sessionStorage.getItem(UPDATE_ATTEMPT_KEY); } catch(e){}
        if (lastAttempt === target) return;
        try { sessionStorage.setItem(UPDATE_ATTEMPT_KEY, target); } catch(e){}
        location.href = location.pathname + '?v=' + encodeURIComponent(target) + '&_=' + Date.now();
      })
      .catch(function(){ /* offline or network hiccup - keep running the current version */ });
  }

  // Lets the app open from the home screen (or a browser tab) with zero
  // connectivity, once it's been loaded successfully at least once - see
  // sw.js. Bump the cache name in sw.js alongside APP_VERSION on every
  // deploy that changes index.html, style.css or app.js.
  if ('serviceWorker' in navigator){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('/sw.js').catch(function(){ /* offline shell just won't be available */ });
    });
  }

  /** @type {AppState} */
  var state = /** @type {AppState} */ (/** @type {unknown} */ (null)); // set by loadState()/joinSession() before any function below runs
  /** @type {Selection|null} */
  var selected = null; // {id, zone} of the currently tap-selected token, if any
  /** @type {string|null} */
  var suggestedPartnerId = null; // bench player id a "Forslag" tap recommends completing the swap with - see computeSwapSuggestion()
  var swapSuggestionArmed = false; // true once a suggestion is marked (selected+suggestedPartnerId set) and awaiting a 2nd "Forslag" tap to confirm - same 2-tap pattern as multiBytte, see onSwapSuggestionBtnClick()
  /** @type {string[]} */
  var roster = []; // remembered player names, alphabetical
  /** @type {AppState[]} */
  var undoStack = []; // snapshots, oldest first; capped at UNDO_MAX
  /** @type {AppState[]} */
  var redoStack = []; // snapshots stepped back past via undo, oldest first; capped at UNDO_MAX
  var UNDO_MAX = 3;
  var settingsDirty = false; // true once anything that only takes effect on "OK" (names, kampvarighet, byttetid, first-run feltstørrelse) has been touched since openSettings() - drives the × close button's "save changes?" prompt
  // Draft values for the new Innstillinger screen's steppers - only written
  // to COACH_DEFAULTS_KEY when "Lagre" is pressed (see saveSettingsScreen()).
  var settingsDraftMatchDurationMin = 15;
  var settingsDraftSwapDurationMin = 3;
  var settingsDraftFieldSize = 3;
  /** @type {Object<string, boolean>} */
  var timeUpNotified = {}; // id -> true once the expiry sound has fired for their current stint
  var multiMode = false; // bulk "send several bench players to field" mode
  /** @type {string[]} */
  var multiSelected = []; // ids currently checked while in multiMode
  var OVERTIME_FACTOR = 1.5; // the red, gently-pulsing badge kicks in once elapsed reaches this multiple of byttetiden (defaultDurationMs) - the orange, still badge covers everything from byttetiden itself up to that point

  // Explanations shown by the small "i" info buttons in settings, keyed by
  // their data-info attribute.
  var INFO_TEXTS = {
    playerTime: {
      title: 'Spillertid',
      text: 'K = kamptid, tid kun for denne kampen. T = totaltid gjennom alle kamper (kumulativ).'
    },
    byttetid: {
      title: 'Standard byttetid',
      text: 'Tiden en utespiller skal spille før et oransje byttemerke (⇅) varsler at byttetiden er nådd. Spiller vedkommende 50 % lenger enn byttetiden, begynner merket å pulsere forsiktig. Klokka fortsetter å telle etter det - spilleren byttes ikke automatisk ut.'
    },
    wakelock: {
      title: 'Hold skjermen våken',
      text: 'Hindrer at skjermen låser seg selv mens appen er åpen, slik at klokkene alltid er synlige under kampen.'
    },
    share: {
      title: 'Del økt med andre',
      text: 'Slår på sanntidsdeling med en tresifret kode. Du velger om andre får redigeringsrettighet (standard) - alle i økten kan gjøre byttinger og styre kampen - eller kun "les", hvor andre kun kan se hovedskjermen (kampen) live, uten å kunne gjøre endringer selv.'
    },
    rankCumulative: {
      title: 'Kumulert rangering (trekanter)',
      text: 'Gjelder kun trekant-symbolene som viser mest/minst spilletid - selve tidene kumuleres alltid uansett, se «i» i spillerboblen. AV: trekantene ser kun på inneværende kamp. PÅ: trekantene ser på kumulert spilletid på tvers av kamper, siden siste nullstilling (Avslutt og nullstill).'
    },
    endPeriod: {
      title: 'Kampslutt, ny kamp',
      text: 'Avslutter denne kampen, men beholder laget og de kumulerte tallene til neste kamp. Du blir spurt om denne kampen skal lagres til historikk.'
    },
    endReset: {
      title: 'Avslutt',
      text: 'Starter helt på nytt - nullstiller spilletid, mål og kamptelling for alle. Krever et andre trykk for å bekrefte. Du blir spurt om den pågående kampen skal lagres til historikk.'
    },
    leaveMatch: {
      title: 'Forlat kampen',
      text: 'Går til hjemskjermen, akkurat som tilbake-pilen øverst til venstre. Kampen røres ikke - den fortsetter nøyaktig som den er, og "Fortsett" fra hjemskjermen henter deg rett tilbake. Deler du økten med andre, er du fortsatt med i den i bakgrunnen; bruk "Forlat delt økt" under om du faktisk vil koble fra den.'
    },
    closeSession: {
      title: 'Forlat delt økt',
      text: 'Kobler denne enheten fra den delte økten for godt - kampen selv røres ikke. Om du ikke er økt-eier fortsetter kampen som normalt for de andre. Er du økt-eier og noen andre er med, overføres økten til dem; er du alene, forblir kampen som den er til du fortsetter den igjen fra hjemskjermen.'
    }
  };
  // "Trykk igjen for å bekrefte"-mønsteret, brukt for enhver handling som
  // er vanskelig/umulig å angre (Kampslutt, Avslutt og nullstill, Overfør
  // økt-eier, Ny økt når det finnes noe å miste) - assigned once els exist,
  // inside init(), see createConfirmArm() below. Holding these as plain
  // module vars (not re-declared locally) keeps disarm() reachable from
  // functions defined outside init(), like openSettings().
  var kampsluttConfirm, avsluttConfirm, transferOwnerConfirm;
  // Coach's answer from the "lagre denne kampen?" prompt (see
  // askSaveToHistory), read by reorgNoBtn/reorgYesBtn once the reorg prompt
  // that follows it closes - the two questions are independent, but ask
  // order puts the save question first.
  var pendingSaveToHistory = false;
  // The just-ended match's full summary (score, duration, goal timeline,
  // player times) - set by endMatchPeriod()/archiveInProgressMatch() right
  // as a match ends, read by showMatchSummaryThen() to render the "Kampen
  // er ferdig" popup shown right after, regardless of whether the coach
  // also chose to save it to the shared Historikk.
  /** @type {HistoryMatchEntry|null} */
  var lastMatchSummary = null;
  /** @type {AudioContext|null} */
  var audioCtx = null;
  var els = {};

  function qs(id){ return document.getElementById(id); }

  var CONFIRM_TIMEOUT_MS = 2500;

  /**
   * Creates one "press again to confirm" state machine: first press arms
   * (saturated fill via .armed on every el in armedEls, shake via
   * .shake-btn on every el in shakeEls; label switches to "Er du
   * sikker?"), second press on the main button confirms. Auto-disarms
   * after CONFIRM_TIMEOUT_MS. Where a button already has an info-btn
   * (Kampslutt, Avslutt og nullstill), that same circle is repurposed as
   * the cancel "×" while armed via onArm/onDisarm instead of a separate
   * cancel element - see .stack-btn-split .info-btn.is-cancel in
   * style.css. armedEls and shakeEls are kept separate (not just one
   * list) because "Overfør økt-eier"/"Ny økt" need .armed on both their
   * outer .confirm-wrap (colors the divider/× - see #transferOwnerWrap.
   * armed in style.css) AND their own button (the pre-existing
   * .export-link-btn.armed/.glass-choice-btn.armed background), but
   * should only shake ONCE as a single unit (the wrap) - shaking both
   * would visibly double the motion, since the button sits inside the wrap.
   * @param {Object} opts
   * @param {HTMLElement[]} opts.armedEls
   * @param {HTMLElement[]} [opts.shakeEls] - defaults to armedEls
   * @param {HTMLElement} opts.labelEl
   * @param {string} opts.restingLabel
   * @param {string} [opts.confirmLabel]
   * @param {function} [opts.onArm]
   * @param {function} [opts.onDisarm]
   */
  // Every confirm-arm created so far (see createConfirmArm below) - only one
  // may ever be armed ("Er du sikker?") at once, so arming one disarms the
  // rest first. Module-scope for the same reason as kampsluttConfirm etc.
  // above: createConfirmArm() runs several times across init(), each call
  // needs to see every arm created before it.
  var allConfirmArms = [];
  function createConfirmArm(opts){
    var armed = false;
    var shakeEls = opts.shakeEls || opts.armedEls;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    var timer;
    /** @type {{disarm: function, isArmed: function, press: function}} */
    var api;
    function disarm(){
      clearTimeout(timer);
      if (!armed) return;
      armed = false;
      opts.labelEl.textContent = opts.restingLabel;
      opts.armedEls.forEach(function(el){ el.classList.remove('armed'); });
      shakeEls.forEach(function(el){ el.classList.remove('shake-btn'); });
      if (opts.onDisarm) opts.onDisarm();
    }
    function arm(){
      // Only one button is ever allowed to read "Er du sikker?" at a time -
      // pressing this one fades any other back to its resting state first
      // (see the lengthened .15s->.5s background/color transitions in
      // style.css for that fade).
      allConfirmArms.forEach(function(other){ if (other !== api) other.disarm(); });
      armed = true;
      opts.labelEl.textContent = opts.confirmLabel || 'Er du sikker?';
      opts.armedEls.forEach(function(el){ el.classList.add('armed'); });
      shakeEls.forEach(function(el){ el.classList.remove('shake-btn'); });
      void shakeEls[0].offsetWidth; // restart the shake if pressed again quickly
      shakeEls.forEach(function(el){ el.classList.add('shake-btn'); });
      if (opts.onArm) opts.onArm();
      clearTimeout(timer);
      timer = setTimeout(disarm, CONFIRM_TIMEOUT_MS);
    }
    api = {
      disarm: disarm,
      isArmed: function(){ return armed; },
      // Call from the main button's click handler: true the moment it
      // actually confirms (was already armed), so the caller can proceed;
      // false the first time, when it only just armed and should wait.
      press: function(){
        if (!armed){ arm(); return false; }
        disarm();
        return true;
      }
    };
    allConfirmArms.push(api);
    return api;
  }

  function uid(){
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  /** @returns {AppState} */
  function defaultState(){
    // Read fresh every time (not cached in a module-level var) so a coach
    // who edits Innstillinger mid-day sees it reflected in the very next
    // Ny økt/Avslutt, not just after a reload.
    var coachDefaults = loadCoachDefaults();
    return {
      players: [],
      onField: [],
      onBench: [],
      fieldTimers: {},
      benchTimers: {},
      cumulative: {},
      periodStartCumulative: {},
      matchClock: { baseElapsedMs: 0, sinceTs: Date.now() },
      wakeLockEnabled: true,
      fieldSize: coachDefaults.fieldSize,
      fieldSlotAssignment: null,
      globalRunning: false,
      defaultDurationMs: coachDefaults.defaultDurationMs,
      matchDurationMs: coachDefaults.matchDurationMs,
      rankByCumulative: coachDefaults.rankByCumulative,
      reorgUsesLastMatch: coachDefaults.reorgUsesLastMatch,
      shareEditable: true,
      sessionOwnerDeviceId: null,
      participants: [],
      goalLog: [],
      swapCount: 0,
      lastActivityAt: Date.now(),
      opponentName: '',
      opponentAbbr: '',
      matchHistory: [],
      // Bumped by 1 on every pushRemoteState() call (see there) - lets a
      // receiving device tell a genuinely newer shared update apart from a
      // stale one arriving late (e.g. a read-only viewer's phone whose tab
      // sat suspended for an hour reconnecting and re-sending the state it
      // still had in memory from back then). See isNewerRevision().
      rev: 0
    };
  }

  // Backfills/validates a state object regardless of where it came from
  // (localStorage or a Supabase row) - returns null if it's too malformed
  // to safely render (e.g. missing players/onField/onBench arrays), so
  // callers can fall back instead of letting renderField/renderBench throw.
  /**
   * @param {any} raw
   * @returns {AppState|null}
   */
  function normalizeState(raw){
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.players)) return null;
    if (!Array.isArray(raw.onField)) raw.onField = [];
    if (!Array.isArray(raw.onBench)) raw.onBench = [];
    if (!raw.fieldTimers || typeof raw.fieldTimers !== 'object') raw.fieldTimers = {};
    if (!raw.benchTimers || typeof raw.benchTimers !== 'object') raw.benchTimers = {};
    if (!raw.cumulative || typeof raw.cumulative !== 'object') raw.cumulative = {};
    if (!raw.periodStartCumulative || typeof raw.periodStartCumulative !== 'object') raw.periodStartCumulative = {};
    if (!raw.matchClock) raw.matchClock = { baseElapsedMs: 0, sinceTs: Date.now() };
    if (raw.wakeLockEnabled === undefined) raw.wakeLockEnabled = true;
    if (!raw.fieldSize) raw.fieldSize = 3;
    if (!Array.isArray(raw.fieldSlotAssignment)) raw.fieldSlotAssignment = null;
    if (typeof raw.defaultDurationMs !== 'number' || raw.defaultDurationMs <= 0) raw.defaultDurationMs = 180000;
    if (typeof raw.matchDurationMs !== 'number' || raw.matchDurationMs <= 0) raw.matchDurationMs = 1200000;
    if (raw.globalRunning === undefined) raw.globalRunning = false;
    if (raw.rankByCumulative === undefined) raw.rankByCumulative = false;
    if (raw.reorgUsesLastMatch === undefined) raw.reorgUsesLastMatch = false;
    if (raw.shareEditable === undefined) raw.shareEditable = true;
    if (raw.sessionOwnerDeviceId === undefined) raw.sessionOwnerDeviceId = null;
    if (!Array.isArray(raw.participants)) raw.participants = [];
    if (!Array.isArray(raw.goalLog)) raw.goalLog = [];
    if (typeof raw.swapCount !== 'number') raw.swapCount = 0;
    if (typeof raw.lastActivityAt !== 'number') raw.lastActivityAt = Date.now();
    if (typeof raw.opponentName !== 'string') raw.opponentName = '';
    if (typeof raw.opponentAbbr !== 'string') raw.opponentAbbr = '';
    if (!Array.isArray(raw.matchHistory)) raw.matchHistory = [];
    if (typeof raw.rev !== 'number') raw.rev = 0;
    return raw;
  }

  // Drops timeUpNotified entries that no longer match reality after `state`
  // was replaced wholesale by data from another device: a player who is off
  // the field, or back on the field with time still remaining (a fresh
  // stint someone else gave them), should be able to trigger the beep again
  // next time their timer actually hits zero on this device.
  function resyncTimeUpNotified(){
    var now = Date.now();
    Object.keys(timeUpNotified).forEach(function(id){
      if (state.onField.indexOf(id) === -1 || fieldElapsed(id, now) < state.defaultDurationMs){
        delete timeUpNotified[id];
      }
    });
  }

  /** @returns {AppState} */
  function loadState(){
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw){
        var normalized = normalizeState(JSON.parse(raw));
        if (normalized) return normalized;
      }
    } catch(e){ console.warn('Kunne ikke lese lagret tilstand', e); }
    return defaultState();
  }

  function saveStateLocally(){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch(e){ console.warn('Kunne ikke lagre tilstand', e); }
  }

  function saveState(){
    // Stamped here (not in saveStateLocally, which the 8s heartbeat also
    // calls on its own) so this only reflects real mutations - swaps,
    // goals, settings changes, period ends - not just "the app happened to
    // be open". Synced like the rest of state, so checkLongIdleSuggestion
    // below can tell whether ANY device did something recently, not just
    // this one - important in a shared session, where this device being
    // closed for weeks says nothing about whether someone else kept using it.
    state.lastActivityAt = Date.now();
    saveStateLocally();
    pushRemoteState();
  }

  // Same as saveState() but without touching lastActivityAt - for flushing
  // already-current state (e.g. right before the tab backgrounds) without
  // that flush itself counting as "activity". Backgrounding happens every
  // time the screen locks, so if this stamped lastActivityAt too, the idle
  // clock checkLongIdleSuggestion() relies on would never actually advance.
  function flushState(){
    saveStateLocally();
    // canEdit() gate - a read-only viewer's device runs this same code path
    // (backgrounding the tab, or the idle-auto-pause correction below) and
    // has no business writing to the shared session at all, regardless of
    // whether its in-memory `state` happens to be stale at that moment or
    // not. (isNewerRevision() on the receiving end would also catch a
    // genuinely stale write, but "read-only" should mean no writes, full
    // stop, not just "no writes that happen to be old".)
    if (canEdit()) pushRemoteState();
  }

  function pushRemoteState(){
    if (!sessionCode || !sb) return;
    state.rev = (typeof state.rev === 'number' ? state.rev : 0) + 1;
    sb.from('sessions')
      .update({ data: state, origin: deviceOrigin, updated_at: new Date().toISOString() })
      .eq('code', sessionCode)
      .then(function(res){
        if (res && res.error) console.warn('Kunne ikke synkronisere', res.error);
      });
  }

  // True if `incoming` is safe to adopt as this device's new state - i.e.
  // it isn't an OLDER snapshot than what this device already has. Guards
  // against exactly what caused a real incident: a read-only viewer's phone
  // whose tab sat suspended for an hour (with a shared session open) woke
  // back up, reconnected, and re-sent the state it still had in memory from
  // back then - silently overwriting an actively-running match with a
  // stale one. state.rev (bumped on every pushRemoteState() call) is a
  // simple, clock-skew-proof "how many pushes has this session line seen"
  // counter.
  //
  // Deliberately >= , not > : two editors both pushing right after the
  // same starting rev (a genuine, if rare, simultaneous-edit collision)
  // would land on equal rev numbers - rejecting an equal rev on BOTH
  // devices would make each stubbornly keep its own edit and reject the
  // other's forever, leaving them silently diverged. Accepting it instead
  // just means the later-arriving of the two wins, same as today's
  // behavior for that narrow case - still converges both devices to the
  // same state, which a dormant device's push (whose rev is far behind,
  // never merely equal) was never going to do anyway.
  /** @param {AppState} incoming @returns {boolean} */
  function isNewerRevision(incoming){
    if (!state || typeof state.rev !== 'number') return true;
    return typeof incoming.rev === 'number' && incoming.rev >= state.rev;
  }

  // True only while both the browser reports a network connection AND the
  // Supabase realtime channel is actually subscribed - either one being
  // false means changes on this device may not be reaching the other
  // device (or vice versa), which is worth surfacing rather than letting
  // the session-code bar imply "synced" when it silently isn't.
  var networkOnline = true;
  var realtimeSubscribed = false;

  // Whether THIS device is allowed to change anything right now: always
  // true outside a shared session; inside one, true unless the session
  // owner switched sharing to read-only AND this isn't the owner's device
  // (owner is recognized by the stable deviceId, not the per-load
  // deviceOrigin, so it survives reloads).
  function canEdit(){
    if (!sessionCode) return true;
    if (!state || state.shareEditable !== false) return true;
    return state.sessionOwnerDeviceId === deviceId;
  }

  // Distinct from canEdit(): this gates SESSION ADMINISTRATION (player
  // names, kampvarighet, byttetid, sharing controls, full reset) to
  // whichever device created the session, regardless of shareEditable -
  // an "editor" in a shared session can still swap players/register
  // goals/run the clock (canEdit() covers that), just not reconfigure the
  // match or its sharing settings out from under the owner. Outside a
  // shared session (or before one exists), this device is trivially its
  // own master.
  function isMaster(){
    if (!sessionCode) return true;
    return state.sessionOwnerDeviceId === deviceId;
  }

  // Registers this device as a participant (first-seen timestamp only - a
  // later rejoin doesn't bump it) so "overfør økt-eier" can later offer the
  // person who's actually been around the longest, not whoever happens to
  // be looking at settings when the owner decides to hand it off. Returns
  // whether it actually added anything, so callers know to push the change.
  function ensureParticipant(){
    if (!Array.isArray(state.participants)) state.participants = [];
    var already = state.participants.some(function(p){ return p.deviceId === deviceId; });
    if (already) return false;
    state.participants.push({ deviceId: deviceId, joinedAt: Date.now() });
    return true;
  }

  // The hand-off target for "overfør økt-eier": among every OTHER device
  // that's ever joined this session, whoever's been in it the longest
  // (earliest joinedAt) - deliberately not "most recently active", since
  // there's no presence/heartbeat system telling us who's actually still
  // there right now (see isMaster()'s comment - this feature is a manual,
  // owner-initiated action, not automatic failover). Null when nobody else
  // has ever joined.
  function longestTenuredOtherParticipant(){
    if (!Array.isArray(state.participants)) return null;
    var others = state.participants.filter(function(p){ return p.deviceId !== deviceId; });
    if (others.length === 0) return null;
    others.sort(function(a,b){ return a.joinedAt - b.joinedAt; });
    return others[0];
  }

  // "ble med for 12 min siden" style caption for the transfer-owner button -
  // there's no display name to show (devices aren't accounts), so how long
  // ago they joined is the only thing that helps the current owner judge
  // whether this candidate still makes sense to hand off to.
  /** @param {number} joinedAt @returns {string} */
  function formatJoinedAgo(joinedAt){
    var mins = Math.max(0, Math.round((Date.now() - joinedAt) / 60000));
    if (mins < 1) return 'ble med for under 1 min siden';
    if (mins < 60) return 'ble med for ' + mins + ' min siden';
    var hours = Math.round(mins / 60);
    if (hours < 24) return 'ble med for ' + hours + ' t siden';
    return 'ble med for ' + Math.round(hours / 24) + ' d siden';
  }

  // Greys out / disables the controls that mutate state when this device
  // is a read-only participant in a shared session - called from renderAll
  // so it stays in sync with every state change (including a remote one
  // that flips shareEditable).
  function applyEditPermissionUI(){
    var editable = canEdit();
    els.appEl.classList.toggle('view-only', !editable);
  }

  function updateSessionCodeUI(){
    if (!els.sessionCodeBar) return;
    if (sessionCode){
      var readOnly = state && state.shareEditable === false && state.sessionOwnerDeviceId !== deviceId;
      els.sessionCodeText.textContent = sessionCode + (readOnly ? ' · kun visning' : '');
      els.sessionCodeBar.style.display = '';
      var healthy = networkOnline && realtimeSubscribed;
      els.sessionCodeBar.classList.toggle('offline', !healthy);
      if (els.syncDot){
        els.syncDot.classList.toggle('offline', !healthy);
        els.syncDot.title = healthy ? 'Synkronisert' : 'Ikke synkronisert – sjekk nettforbindelsen';
      }
    } else {
      els.sessionCodeBar.style.display = 'none';
    }
    if (els.appEl) applyEditPermissionUI();
  }

  function subscribeToSession(code){
    if (!sb) return;
    if (realtimeChannel) sb.removeChannel(realtimeChannel);
    realtimeSubscribed = false;
    realtimeChannel = sb.channel('session-' + code)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: 'code=eq.' + code },
        function(payload){
          if (!payload.new || payload.new.origin === deviceOrigin) return;
          var normalized = normalizeState(payload.new.data);
          if (!normalized){ console.warn('Mottok ugyldig delt tilstand fra økt, ignorerer'); return; }
          if (!isNewerRevision(normalized)){ console.warn('Ignorerte en foreldet delt tilstand (rev ' + normalized.rev + ' < ' + state.rev + ')'); return; }
          var wasMaster = isMaster();
          state = normalized;
          saveStateLocally();
          resyncTimeUpNotified();
          renderAll();
          if (!wasMaster && isMaster()) showOwnerTransferredNotice();
        }
      )
      .subscribe(function(status){
        realtimeSubscribed = (status === 'SUBSCRIBED');
        updateSessionCodeUI();
        // Only an editor's own reconnect should ever re-push its in-memory
        // state - a read-only viewer has no business writing at all (this
        // used to run unconditionally, which was exactly how a dormant
        // read-only phone once clobbered an active match - see
        // isNewerRevision's comment). canEdit() alone isn't quite enough on
        // its own though (an editor's phone can go just as stale), which is
        // why isNewerRevision() above is the real backstop.
        if (realtimeSubscribed && canEdit()) pushRemoteState(); // catch up on anything queued while disconnected
      });
  }

  // Detaches this device from its shared session without touching the
  // Supabase row itself (no server-side cleanup, matching how the rest of
  // this app treats sessions) - triggered by switching "Del økt med andre"
  // off in settings.
  function leaveSession(){
    if (realtimeChannel && sb){ sb.removeChannel(realtimeChannel); realtimeChannel = null; }
    realtimeSubscribed = false;
    sessionCode = null;
    try { localStorage.removeItem(SESSION_CODE_KEY); } catch(e){}
    updateSessionCodeUI();
  }

  function generateCode(){
    return String(Math.floor(Math.random()*1000)).padStart(3,'0');
  }

  // Shows/hides the "Redigering / Kun les" segmented control (only
  // meaningful while actually sharing) and reflects the current mode.
  function updateShareModeUI(){
    if (!els.shareModeRow) return;
    els.shareModeRow.hidden = !sessionCode || !isMaster();
    var editable = !state || state.shareEditable !== false;
    Array.prototype.forEach.call(els.shareModeSegmented.querySelectorAll('.segmented-btn'), function(btn){
      var isEdit = btn.dataset.mode !== 'read';
      btn.classList.toggle('active', isEdit === editable);
    });
  }

  function createNewSession(callback){
    if (!sb){ callback(null); return; }
    state.sessionOwnerDeviceId = deviceId;
    ensureParticipant();
    var attempts = 0;
    function tryInsert(){
      attempts++;
      var code = generateCode();
      sb.from('sessions').insert({ code: code, data: state, origin: deviceOrigin }).then(function(res){
        if (res && res.error){
          if (attempts < 5) { tryInsert(); return; }
          callback(null);
          return;
        }
        sessionCode = code;
        try { localStorage.setItem(SESSION_CODE_KEY, code); } catch(e){}
        subscribeToSession(code);
        updateSessionCodeUI();
        callback(code);
      });
    }
    tryInsert();
  }

  function joinSession(code, onSuccess, onNotFound){
    if (!sb){ onNotFound(); return; }
    sb.from('sessions').select('*').eq('code', code).maybeSingle().then(function(res){
      if (!res || res.error || !res.data){ onNotFound(); return; }
      var normalized = normalizeState(res.data.data);
      if (!normalized){ console.warn('Økten fantes, men data var ugyldig'); onNotFound(); return; }
      state = normalized;
      sessionCode = code;
      try { localStorage.setItem(SESSION_CODE_KEY, code); } catch(e){}
      // Register as a participant before the very first save so the owner
      // (and anyone else) sees this device as a hand-off candidate - pushed
      // remotely right away rather than waiting for the next real edit.
      var joinedAsNewParticipant = ensureParticipant();
      saveStateLocally();
      resyncTimeUpNotified();
      subscribeToSession(code);
      updateSessionCodeUI();
      if (joinedAsNewParticipant) pushRemoteState();
      onSuccess();
    });
  }

  function loadRoster(){
    try {
      var raw = localStorage.getItem(ROSTER_KEY);
      if (raw){
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch(e){ console.warn('Kunne ikke lese spillerhistorikk', e); }
    return [];
  }

  function saveRoster(){
    try { localStorage.setItem(ROSTER_KEY, JSON.stringify(roster)); }
    catch(e){ console.warn('Kunne ikke lagre spillerhistorikk', e); }
  }

  function addNamesToRoster(names){
    var existingLower = roster.map(function(n){ return n.toLowerCase(); });
    names.forEach(function(name){
      var lower = name.toLowerCase();
      if (existingLower.indexOf(lower) === -1){
        roster.push(name);
        existingLower.push(lower);
      }
    });
    roster.sort(function(a,b){ return a.localeCompare(b,'nb'); });
    saveRoster();
  }

  // Shared, cross-device match archive (see "Historikk" on the launcher) -
  // lives in Supabase's match_history table, not localStorage: any device
  // can INSERT a finished match (no login needed - see saveMatchToHistory),
  // but only an admin (an authenticated user listed in the admins table,
  // enforced by Postgres row-level security, not just this client-side
  // check) can SELECT/UPDATE/DELETE. Parents/other coaches can never read
  // it without an admin's login - see PROSJEKT-OPPSUMMERING.md.
  /** @param {HistoryMatchEntry} entry */
  function saveMatchToHistory(entry){
    if (!sb) return;
    sb.from('match_history').insert({
      ended_at: new Date(entry.endedAt).toISOString(),
      opponent_name: entry.opponentName || '',
      opponent_abbr: entry.opponentAbbr || '',
      home_score: entry.homeScore || 0,
      away_score: entry.awayScore || 0,
      players: entry.players || [],
      goals: entry.goals || [],
      origin: deviceOrigin
    }).then(function(res){
      if (res.error) console.warn('Kunne ikke lagre kamp til historikk', res.error);
    });
  }

  // ---------------- "Mitt lag" team_settings sync ----------------
  // Column names/defaults mirror CoachDefaults 1:1 (see loadCoachDefaults())
  // so converting either direction is a flat rename, no reshaping.
  /** @param {CoachDefaults} d @returns {Object<string, any>} */
  function coachDefaultsToRow(d){
    return {
      home_team_name: d.homeTeamName,
      home_team_abbr: d.homeTeamAbbr,
      match_duration_ms: d.matchDurationMs,
      default_duration_ms: d.defaultDurationMs,
      field_size: d.fieldSize,
      rank_by_cumulative: d.rankByCumulative,
      reorg_uses_last_match: d.reorgUsesLastMatch
    };
  }
  /** @param {any} row @returns {CoachDefaults} */
  function rowToCoachDefaults(row){
    return {
      homeTeamName: row.home_team_name,
      homeTeamAbbr: row.home_team_abbr,
      matchDurationMs: row.match_duration_ms,
      defaultDurationMs: row.default_duration_ms,
      fieldSize: row.field_size,
      rankByCumulative: !!row.rank_by_cumulative,
      reorgUsesLastMatch: !!row.reorg_uses_last_match
    };
  }
  /** @param {string} userId @returns {Promise<CoachDefaults|null>} */
  function fetchTeamSettings(userId){
    if (!sb) return Promise.resolve(null);
    return sb.from('team_settings').select('*').eq('user_id', userId).maybeSingle().then(function(res){
      if (res.error){ console.warn('Kunne ikke hente lagets innstillinger', res.error); return null; }
      return res.data ? rowToCoachDefaults(res.data) : null;
    });
  }
  /** @param {string} userId @param {CoachDefaults} defaults @returns {Promise<boolean>} */
  function upsertTeamSettings(userId, defaults){
    if (!sb) return Promise.resolve(false);
    var row = coachDefaultsToRow(defaults);
    row.user_id = userId;
    row.updated_at = new Date().toISOString();
    return sb.from('team_settings').upsert(row).then(function(res){
      if (res.error){ console.warn('Kunne ikke lagre lagets innstillinger', res.error); return false; }
      return true;
    });
  }

  /** @returns {Promise<HistoryMatchEntry[]>} */
  function fetchMatchHistory(){
    if (!sb) return Promise.resolve([]);
    return sb.from('match_history').select('*').order('ended_at', { ascending: false }).then(function(res){
      if (res.error){ console.warn('Kunne ikke hente historikk', res.error); return []; }
      return (res.data || []).map(function(row){
        return {
          id: row.id,
          endedAt: new Date(row.ended_at).getTime(),
          opponentName: row.opponent_name || '',
          opponentAbbr: row.opponent_abbr || '',
          homeScore: row.home_score || 0,
          awayScore: row.away_score || 0,
          players: row.players || [],
          goals: row.goals || [],
          // null/absent for anything not currently flagged visible - RLS
          // (see the migration) already means a non-admin viewer only ever
          // gets rows where this is set and still in the future, so its
          // mere presence isn't itself sensitive to read back.
          visibleUntil: row.visible_until ? new Date(row.visible_until).getTime() : null
        };
      });
    });
  }

  /** @param {string} id @param {number|null} days - null clears visibility (hides it again); a number sets it visible for that many days from now */
  function setMatchVisibility(id, days){
    if (!sb) return Promise.resolve(false);
    var visibleUntil = typeof days === 'number' ? new Date(Date.now() + days * 86400000).toISOString() : null;
    return sb.from('match_history').update({ visible_until: visibleUntil }).eq('id', id).then(function(res){
      if (res.error){ console.warn('Kunne ikke endre synlighet', res.error); return false; }
      return true;
    });
  }

  /** @param {string[]} ids @returns {Promise<boolean>} */
  function deleteHistoryEntries(ids){
    if (!sb) return Promise.resolve(false);
    return sb.from('match_history').delete().in('id', ids).then(function(res){
      historySelected = {};
      historyDeleteArmedId = null;
      if (res.error){ console.warn('Kunne ikke slette fra historikk', res.error); return false; }
      return true;
    });
  }

  /** @param {number} ts @returns {string} */
  function formatHistoryDate(ts){
    return new Date(ts).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ---------------- Historikk admin login ----------------
  // Supabase JS persists the session in localStorage itself and restores it
  // on load - adminUser here just mirrors that for synchronous UI checks
  // (isHistoryAdmin()) without awaiting getSession() everywhere it's read.
  /** @type {any} */
  var adminUser = null;
  // "Mitt lag" (see initAccountAndSettings) and Historikk-login share the
  // exact same sb.auth session - there's only one Supabase Auth per project,
  // so any signed-in team account IS, technically, a session here too.
  // isHistoryAdmin() below gates the extra, separate Historikk admin
  // capability (viewing everyone's matches, deleting, flagging visibility)
  // on real membership in the "admins" table - the same table the
  // database's own RLS policies already check - not just "is signed in".
  // Without this, every self-registered "Mitt lag" account would silently
  // also become a Historikk admin the moment self-service registration
  // shipped. Resolved async (see refreshAdminStatus()) since it's a real
  // query - isHistoryAdmin() just reads whatever that last resolved to, the
  // same "may be a beat stale right after a session change" tradeoff
  // adminUser itself already has (see onAuthStateChange's own comments).
  var dbAdminConfirmed = false;
  function isHistoryAdmin(){ return !!adminUser && dbAdminConfirmed; }
  /** @returns {Promise<void>} */
  function refreshAdminStatus(){
    if (!sb || !adminUser){ dbAdminConfirmed = false; return Promise.resolve(); }
    return sb.from('admins').select('user_id').eq('user_id', adminUser.id).maybeSingle().then(function(res){
      dbAdminConfirmed = !res.error && !!res.data;
    });
  }
  // Any signed-in session at all counts as "a team account" - unlike
  // isHistoryAdmin() above, there's no allowlist here, self-registration is
  // the whole point of "Mitt lag".
  function isTeamAccountSignedIn(){ return !!adminUser; }

  // Historikk tile is only in the DOM at all for a signed-in "Mitt lag"
  // account now - no lock/unlock badge needed to distinguish admin vs
  // visitor state on it any more (that badge's markup is gone from
  // index.html; #lockClosedSymbol/#lockOpenSymbol themselves are still
  // there and still used by the login popup's own icon, just not this).
  function updateHistoryTileVisibility(){
    if (!els.historyTile) return;
    els.historyTile.hidden = !isTeamAccountSignedIn();
  }

  if (sb){
    sb.auth.onAuthStateChange(function(_event, session){
      var wasAdmin = isHistoryAdmin();
      var wasTeamAccount = isTeamAccountSignedIn();
      adminUser = (session && session.user) || null;
      // Re-derived below (refreshAdminStatus) - reset first so a switch
      // from one account to another never reads as still-admin in between.
      dbAdminConfirmed = false;
      updateHistoryTileVisibility();
      // A logout while the (admin-only) Historikk screen is open would
      // otherwise leave it sitting open with no way to show its now-
      // unauthorized list - there's no non-admin view left inside it to
      // fall back to (see openHistoryLoginModal() - login now gates entry
      // from the launcher instead of living inside this screen).
      if (wasAdmin && !isHistoryAdmin() && els.historyScreen && els.historyScreen.classList.contains('open')){
        els.historyScreen.classList.remove('open');
      }
      if (adminUser){
        refreshAdminStatus().then(function(){
          // Only matters if it flips isHistoryAdmin() - re-render whatever
          // that affects, now that the real answer is in.
          if (els.historyScreen && els.historyScreen.classList.contains('open')) renderHistoryList();
        });
      }
      // Pulls the account's own team_settings row down into the local
      // cache the moment a sign-in is detected (a fresh login, or a
      // session restoring on page load) - covers both without duplicating
      // this in two places. Only on the actual signed-out -> signed-in
      // transition, not every token refresh in between.
      if (!wasTeamAccount && isTeamAccountSignedIn()){
        fetchTeamSettings(adminUser.id).then(function(remote){
          if (remote) saveCoachDefaults(remote);
          // No row yet (a Historikk-admin-only login, or an account that
          // predates this feature) - leave the local cache as the seed and
          // push it up, so the account has something from here on.
          else upsertTeamSettings(adminUser.id, loadCoachDefaults());
          if (els.settingsScreen && els.settingsScreen.classList.contains('open')) openSettingsScreen();
          else if (els.settingsStorageNote) updateSettingsStorageNote();
        });
      } else if (wasTeamAccount && !isTeamAccountSignedIn() && els.settingsStorageNote){
        updateSettingsStorageNote();
      }
    });
  }

  // ---------------- Historikk login lockout ----------------
  // Client-side throttle only, not real brute-force protection - Supabase
  // Auth already rate-limits sign-in attempts server-side regardless. This
  // exists purely for the UX the coach asked for (a visible "wait 5
  // minutes" instead of unlimited silent retries), stored locally so it
  // survives closing/reopening the popup.
  var HISTORY_LOGIN_LOCK_KEY = 'spillerbytte_history_login_lock_v1';
  var HISTORY_LOGIN_MAX_ATTEMPTS = 3;
  // First lockout is 5 minutes; every one after that is 1 hour (stage
  // clamps at the last entry, so it never escalates past that).
  var HISTORY_LOGIN_LOCK_DURATIONS_MS = [5 * 60 * 1000, 60 * 60 * 1000];

  function loadHistoryLoginLock(){
    try {
      var raw = localStorage.getItem(HISTORY_LOGIN_LOCK_KEY);
      var s = raw ? JSON.parse(raw) : null;
      if (!s || typeof s !== 'object') return { fails: 0, stage: 0, lockUntil: 0 };
      return { fails: s.fails || 0, stage: s.stage || 0, lockUntil: s.lockUntil || 0 };
    } catch(e){ return { fails: 0, stage: 0, lockUntil: 0 }; }
  }
  /** @param {{fails: number, stage: number, lockUntil: number}} s */
  function saveHistoryLoginLock(s){
    try { localStorage.setItem(HISTORY_LOGIN_LOCK_KEY, JSON.stringify(s)); } catch(e){}
  }
  function historyLoginLockRemainingMs(){
    var remaining = loadHistoryLoginLock().lockUntil - Date.now();
    return remaining > 0 ? remaining : 0;
  }
  // @returns the lock state AFTER recording this failure, so the caller can
  // read .fails (attempts used so far this cycle) without a second load.
  function recordFailedHistoryLogin(){
    var s = loadHistoryLoginLock();
    s.fails += 1;
    if (s.fails >= HISTORY_LOGIN_MAX_ATTEMPTS){
      var idx = Math.min(s.stage, HISTORY_LOGIN_LOCK_DURATIONS_MS.length - 1);
      s.lockUntil = Date.now() + HISTORY_LOGIN_LOCK_DURATIONS_MS[idx];
      s.stage += 1;
      s.fails = 0;
    }
    saveHistoryLoginLock(s);
    return s;
  }
  function recordSuccessfulHistoryLogin(){
    saveHistoryLoginLock({ fails: 0, stage: 0, lockUntil: 0 });
  }
  /** @param {number} ms @returns {string} */
  function formatLockRemaining(ms){
    var totalSec = Math.ceil(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) return h + ' t ' + m + ' min';
    if (m > 0) return m + ' min ' + s + ' sek';
    return s + ' sek';
  }

  /** @type {ReturnType<typeof setInterval>|undefined} */
  var historyLoginCountdownTimer;

  function openHistoryLoginModal(){
    els.historyLoginEmail.value = '';
    els.historyLoginPassword.value = '';
    els.historyLoginError.style.display = 'none';
    clearFieldInvalid(els.historyLoginEmailWrap);
    clearFieldInvalid(els.historyLoginPasswordWrap);
    els.historyLoginModal.classList.add('open');
    updateHistoryLoginLockUI();
    if (!historyLoginLockRemainingMs()){
      setTimeout(function(){ els.historyLoginEmail.focus(); }, 350);
    }
  }

  // Supabase Auth only knows email/password - there's no real "username"
  // concept server-side. This is a purely client-side alias table so André
  // can type "Anterialis" instead of his email; resolved to the real email
  // before ever calling signInWithPassword. Fine at this scale (a single
  // admin) - would need a real username->email lookup (e.g. a small public
  // table) if there were ever more than a couple of admins to remember.
  var HISTORY_LOGIN_USERNAME_ALIASES = {
    'anterialis': 'andre.nanbjor@gmail.com'
  };

  function resolveHistoryLoginEmail(input){
    var alias = HISTORY_LOGIN_USERNAME_ALIASES[input.toLowerCase()];
    return alias || input;
  }

  function closeHistoryLoginModal(){
    els.historyLoginModal.classList.remove('open');
    clearInterval(historyLoginCountdownTimer);
  }

  // Toggles the form vs. the "prøv igjen om ..." note, and keeps that
  // note's countdown ticking live for as long as the modal stays open.
  function updateHistoryLoginLockUI(){
    var remaining = historyLoginLockRemainingMs();
    clearInterval(historyLoginCountdownTimer);
    if (remaining <= 0){
      els.historyLoginFormFields.hidden = false;
      els.historyLoginLockedNote.hidden = true;
      return;
    }
    els.historyLoginFormFields.hidden = true;
    els.historyLoginLockedNote.hidden = false;
    var tick = function(){
      var left = historyLoginLockRemainingMs();
      if (left <= 0){
        clearInterval(historyLoginCountdownTimer);
        updateHistoryLoginLockUI();
        return;
      }
      els.historyLoginLockedText.textContent = 'For mange feilede forsøk. Prøv igjen om ' + formatLockRemaining(left) + '.';
    };
    tick();
    historyLoginCountdownTimer = setInterval(tick, 1000);
  }

  function attemptHistoryLogin(){
    if (historyLoginLockRemainingMs() > 0){ updateHistoryLoginLockUI(); return; }
    var email = resolveHistoryLoginEmail(els.historyLoginEmail.value.trim());
    var password = els.historyLoginPassword.value;
    els.historyLoginError.style.display = 'none';
    clearFieldInvalid(els.historyLoginEmailWrap);
    clearFieldInvalid(els.historyLoginPasswordWrap);
    if (!sb){
      els.historyLoginError.textContent = 'Ingen tilkobling til databasen akkurat nå.';
      els.historyLoginError.style.display = '';
      return;
    }
    if (!email || !password){
      if (!email) markFieldInvalid(els.historyLoginEmailWrap);
      if (!password) markFieldInvalid(els.historyLoginPasswordWrap);
      return;
    }
    els.historyLoginBtn.disabled = true;
    sb.auth.signInWithPassword({ email: email, password: password }).then(function(res){
      els.historyLoginBtn.disabled = false;
      if (res.error){
        var lock = recordFailedHistoryLogin();
        shakeElement(els.historyLoginModal.querySelector('.modal-card'));
        if (historyLoginLockRemainingMs() > 0){
          updateHistoryLoginLockUI();
        } else {
          var left = HISTORY_LOGIN_MAX_ATTEMPTS - lock.fails;
          els.historyLoginError.textContent = 'Feil e-post eller passord. ' + left + ' forsøk igjen.';
          els.historyLoginError.style.display = '';
          els.historyLoginPassword.value = '';
          els.historyLoginPassword.focus();
        }
        return;
      }
      recordSuccessfulHistoryLogin();
      closeHistoryLoginModal();
      openHistoryScreen();
      // adminUser/badge are already updated via onAuthStateChange, which
      // fires synchronously off this same signInWithPassword call.
    });
  }

  // ---------------- Historikk screen ----------------
  var historySelectMode = false;
  /** @type {Object<string, boolean>} */
  var historySelected = {};
  /** @type {string|null} */
  var historyExpandedId = null;
  // Delete is a double-tap-to-confirm per row (same pattern as "Avslutt og
  // nullstill"/"Overfør økt-eier" elsewhere) rather than a confirm modal -
  // a modal per single delete in a scrolling list would be a lot of
  // friction for what's meant to be a quick, low-stakes cleanup action.
  /** @type {string|null} */
  var historyDeleteArmedId = null;
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  var historyDeleteArmTimer;
  /** @type {string[]|null} */
  var pendingHistoryDeleteIds = null;
  /** @type {HistoryMatchEntry[]} */
  var historyListCache = [];
  var historyListLoading = false;


  function fetchAndRenderHistoryList(){
    historyListLoading = true;
    renderHistoryList();
    fetchMatchHistory().then(function(list){
      historyListLoading = false;
      historyListCache = list;
      renderHistoryList();
    });
  }

  function renderHistoryList(){
    var list = historyListCache;
    if (historyListLoading){
      els.historyEmpty.hidden = false;
      els.historyEmpty.textContent = 'Laster...';
      els.historyList.innerHTML = '';
      els.historySelectBar.hidden = true;
      return;
    }
    var admin = isHistoryAdmin();
    els.historyEmpty.textContent = admin
      ? 'Ingen kamper lagret ennå. De dukker opp her etter "Kampslutt".'
      : 'Ingen kamper er delt med deg ennå.';
    els.historyEmpty.hidden = list.length > 0;
    if (list.length === 0){
      els.historyList.innerHTML = '';
      els.historySelectBar.hidden = true;
      return;
    }
    els.historyList.innerHTML = list.map(function(m){
      var selected = !!historySelected[m.id];
      var expanded = historyExpandedId === m.id;
      var armed = historyDeleteArmedId === m.id;
      var visible = !!(m.visibleUntil && m.visibleUntil > Date.now());
      var opponent = m.opponentName || (m.opponentAbbr ? m.opponentAbbr : 'Ukjent motstander');
      var players = (m.players || []).slice().sort(function(a,b){ return b.ms - a.ms; });
      var playerRows = players.map(function(p){
        return '<div class="history-row-player">' +
          '<span class="history-row-player-name">' + escapeHtml(p.name) + (p.goals > 0 ? ' (' + p.goals + ' mål)' : '') + '</span>' +
          '<span class="history-row-player-stats">' + formatCumulative(p.ms) + '</span>' +
        '</div>';
      }).join('') || '<div class="history-row-player"><span class="history-row-player-name">Ingen spillerdata registrert.</span></div>';
      var goalRows = (m.goals || []).map(function(g){
        return '<div class="history-row-goal history-row-goal-' + g.team + '">' +
          '<span class="history-row-goal-time">' + formatMs(g.matchMs) + '</span>' +
          '<span class="history-row-goal-scorer">' + escapeHtml(g.scorerName) + '</span>' +
        '</div>';
      }).join('');
      var goalsBlock = goalRows
        ? '<div class="history-row-goals-title">Mål</div><div class="history-row-goals">' + goalRows + '</div>'
        : '';
      var daysLeft = visible ? Math.max(1, Math.ceil((m.visibleUntil - Date.now()) / 86400000)) : 0;
      // Only ever rendered for isHistoryAdmin() - a non-admin signed-in
      // viewer only ever sees matches the admin already chose to share
      // (see the RLS policy in the visibility migration), with no controls
      // of their own to change that.
      var visibilityBtn = admin ?
        '<button type="button" class="history-row-visibility' + (visible ? ' visible' : '') + '" aria-label="' +
          (visible ? 'Skjul for innloggede brukere' : 'Vis for innloggede brukere') + '" title="' +
          (visible ? daysLeft + ' dag' + (daysLeft === 1 ? '' : 'er') + ' igjen - trykk for å skjule' : 'Ikke synlig for andre - trykk for å dele') + '">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" stroke="' + (visible ? '#32d74b' : 'rgba(255,255,255,.6)') + '" stroke-width="1.6"/>' +
            '<circle cx="12" cy="12" r="3.2" fill="' + (visible ? '#32d74b' : 'none') + '" stroke="' + (visible ? '#32d74b' : 'rgba(255,255,255,.6)') + '" stroke-width="1.6"/>' +
          '</svg>' +
        '</button>' : '';
      return '<div class="history-row' + (expanded ? ' expanded' : '') + '" data-id="' + m.id + '">' +
        '<div class="history-row-main">' +
          (historySelectMode ? '<input type="checkbox" class="history-row-check"' + (selected ? ' checked' : '') + '>' : '') +
          '<div class="history-row-text">' +
            '<div class="history-row-top">' +
              '<span class="history-row-opponent">vs ' + escapeHtml(opponent) + '</span>' +
              '<span class="history-row-score">' + m.homeScore + ' - ' + m.awayScore + '</span>' +
            '</div>' +
            '<div class="history-row-date">' + formatHistoryDate(m.endedAt) + '</div>' +
          '</div>' +
          (historySelectMode ? '' :
            visibilityBtn +
            (admin ? '<button type="button" class="history-row-delete' + (armed ? ' armed' : '') + '" aria-label="Slett kamp">🗑</button>' : '') +
            '<span class="history-row-chevron" aria-hidden="true">⌄</span>') +
        '</div>' +
        (historySelectMode ? '' : '<div class="history-row-detail"' + (expanded ? '' : ' hidden') + '>' + playerRows + goalsBlock + '</div>') +
      '</div>';
    }).join('');

    Array.prototype.forEach.call(els.historyList.querySelectorAll('.history-row'), function(row){
      var id = row.getAttribute('data-id');
      row.querySelector('.history-row-main').addEventListener('click', function(){
        if (historySelectMode){
          historySelected[id] = !historySelected[id];
          renderHistoryList();
          return;
        }
        historyExpandedId = (historyExpandedId === id) ? null : id;
        renderHistoryList();
      });
      var visBtn = row.querySelector('.history-row-visibility');
      if (visBtn){
        visBtn.addEventListener('click', function(e){
          e.stopPropagation();
          var m = historyListCache.filter(function(x){ return x.id === id; })[0];
          if (!m) return;
          var currentlyVisible = !!(m.visibleUntil && m.visibleUntil > Date.now());
          if (currentlyVisible){
            setMatchVisibility(id, null).then(function(ok){
              if (ok){ m.visibleUntil = null; renderHistoryList(); }
            });
            return;
          }
          // A plain prompt() rather than a custom modal - this is an
          // admin-only, occasional-use control, not a flow other coaches
          // ever see, so the extra UI weight of a bespoke input didn't seem
          // worth it. Easy to swap out later if that changes.
          var input = window.prompt('Synlig for innloggede brukere i hvor mange dager?', '7');
          if (input === null) return;
          var days = parseInt(input, 10);
          if (!days || days <= 0) return;
          setMatchVisibility(id, days).then(function(ok){
            if (ok){ m.visibleUntil = Date.now() + days * 86400000; renderHistoryList(); }
          });
        });
      }
      var delBtn = row.querySelector('.history-row-delete');
      if (delBtn){
        delBtn.addEventListener('click', function(e){
          e.stopPropagation(); // don't also toggle the row's own expand/collapse
          if (historyDeleteArmedId === id){
            deleteHistoryEntries([id]).then(function(ok){
              if (ok) historyListCache = historyListCache.filter(function(m){ return m.id !== id; });
              renderHistoryList();
            });
            return;
          }
          historyDeleteArmedId = id;
          clearTimeout(historyDeleteArmTimer);
          historyDeleteArmTimer = setTimeout(function(){ historyDeleteArmedId = null; renderHistoryList(); }, 2500);
          renderHistoryList();
        });
      }
    });

    els.historySelectBar.hidden = !historySelectMode;
    if (historySelectMode){
      var selectedCount = Object.keys(historySelected).filter(function(id){ return historySelected[id]; }).length;
      els.historySelectCount.textContent = selectedCount + ' valgt';
      els.historyDeleteSelectedBtn.disabled = selectedCount === 0;
      els.historySelectAllBtn.textContent = (selectedCount === list.length) ? 'Fjern alle' : 'Velg alle';
    }
  }

  // Only ever reached already authenticated - either historyTile's click
  // handler found an existing admin session, or openHistoryLoginModal()
  // just established one (see attemptHistoryLogin()). Login itself gates
  // entry from the launcher now, so this screen has nothing to fall back
  // to if it weren't - see the onAuthStateChange listener above, which
  // closes it again on logout rather than leaving it stranded.
  function openHistoryScreen(){
    historySelectMode = false;
    historySelected = {};
    historyExpandedId = null;
    historyDeleteArmedId = null;
    els.historySelectModeBtn.textContent = 'Velg flere';
    els.historySelectModeBtn.classList.remove('active');
    // "Velg flere" only exists to delete matches - nothing for a non-admin
    // signed-in visitor to do with it, since they only ever see admin-
    // shared, read-only rows (see renderHistoryList()'s own admin gating).
    els.historySelectModeBtn.hidden = !isHistoryAdmin();
    fetchAndRenderHistoryList();
    els.historyScreen.classList.add('open');
  }

  /** @param {string} name @param {boolean} [singleLetter] @returns {string} */
  function initials(name, singleLetter){
    var parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (singleLetter) return parts[0].slice(0,1).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0,2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function formatMs(ms){
    var neg = ms < 0;
    var abs = Math.max(0, Math.round(Math.abs(ms)/1000));
    var m = Math.floor(abs/60);
    var s = abs % 60;
    return (neg ? '+' : '') + m + ':' + String(s).padStart(2,'0');
  }

  // Field timers are a plain stopwatch (elapsed time since the stint
  // started), same shape as benchTimers - the "time's up" warning is a
  // threshold check against this (see renderField/updateTimersOnly), not a
  // countdown, so the clock keeps climbing in red past the default duration
  // instead of stopping at zero.
  /** @param {string} id @param {number} now @returns {number} */
  function fieldElapsed(id, now){
    var t = state.fieldTimers[id];
    if (!t || typeof t.baseElapsedMs !== 'number') return 0;
    return state.globalRunning ? t.baseElapsedMs + (now - t.sinceTs) : t.baseElapsedMs;
  }

  /** @param {string} id @param {number} now @returns {number} */
  function benchElapsed(id, now){
    var t = state.benchTimers[id];
    if (!t) return 0;
    if (state.globalRunning) return t.baseElapsedMs + (now - t.sinceTs);
    return t.baseElapsedMs;
  }

  /** @param {number} now @returns {number} */
  function matchClockElapsed(now){
    var t = state.matchClock;
    if (!t) return 0;
    return state.globalRunning ? t.baseElapsedMs + (now - t.sinceTs) : t.baseElapsedMs;
  }

  // How much of kampvarighet is left to show on the big clock: it freezes
  // at the full duration once reached, rather than counting past it - the
  // small countdown beside it (see matchCountdownMs) keeps going instead.
  /** @param {number} now @returns {number} */
  function matchClockDisplayMs(now){
    return Math.min(matchClockElapsed(now), state.matchDurationMs);
  }

  // Small always-visible companion to the (frozen) big clock: counts down
  // to 0:00 same as before, then goes negative - formatMs already renders
  // negative values with a "+" prefix, so it reads as "+MM:SS" overtime
  // once kampvarighet is exceeded, with no separate show/hide state needed.
  /** @param {number} now @returns {number} */
  function matchCountdownMs(now){
    return state.matchDurationMs - matchClockElapsed(now);
  }

  /** @param {string} id @returns {Cumulative} */
  function ensureCumulative(id){
    if (!state.cumulative[id]) state.cumulative[id] = { fieldMs: 0, benchMs: 0 };
    return state.cumulative[id];
  }

  // Call BEFORE resetting/deleting the player's current fieldTimers/benchTimers
  // entry, so the just-finished stint gets folded into their running total.
  /** @param {string} id @param {number} now */
  function commitFieldStint(id, now){
    var elapsed = fieldElapsed(id, now);
    if (elapsed > 0) ensureCumulative(id).fieldMs += elapsed;
  }
  /** @param {string} id @param {number} now */
  function commitBenchStint(id, now){
    var elapsed = benchElapsed(id, now);
    if (elapsed > 0) ensureCumulative(id).benchMs += elapsed;
  }

  /** @param {string} id @param {number} now @returns {number} */
  function cumulativeFieldMs(id, now){
    var base = (state.cumulative[id] && state.cumulative[id].fieldMs) || 0;
    if (state.onField.indexOf(id) !== -1){
      base += fieldElapsed(id, now);
    }
    return Math.max(0, base);
  }
  /** @param {string} id @param {number} now @returns {number} */
  function cumulativeBenchMs(id, now){
    var base = (state.cumulative[id] && state.cumulative[id].benchMs) || 0;
    if (state.onBench.indexOf(id) !== -1){
      base += benchElapsed(id, now);
    }
    return Math.max(0, base);
  }

  function formatCumulative(ms){
    var abs = Math.max(0, Math.round(ms/1000));
    var h = Math.floor(abs/3600);
    var m = Math.floor((abs%3600)/60);
    var s = abs%60;
    if (h > 0) return h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    return m + ':' + String(s).padStart(2,'0');
  }

  // Field time since the CURRENT period started (i.e. since the last
  // "Kampslutt"), rather than the lifetime cumulative - the difference
  // between the two is exactly what state.periodStartCumulative snapshots
  // at the start of each period (see endMatchPeriod).
  /** @param {string} id @param {number} now @returns {number} */
  function currentPeriodFieldMs(id, now){
    var baseline = (state.periodStartCumulative[id] && state.periodStartCumulative[id].fieldMs) || 0;
    return Math.max(0, cumulativeFieldMs(id, now) - baseline);
  }

  // Same as currentPeriodFieldMs, but for time on the bench.
  /** @param {string} id @param {number} now @returns {number} */
  function currentPeriodBenchMs(id, now){
    var baseline = (state.periodStartCumulative[id] && state.periodStartCumulative[id].benchMs) || 0;
    return Math.max(0, cumulativeBenchMs(id, now) - baseline);
  }

  // Returns {playerId: 'most'|'most2'|'least2'|'least'} across the whole squad
  // (both zones), so it's easy to see who to start next match with. Basis is
  // either the current period only (default) or the full cross-match
  // cumulative total, per the "Kumulert rangering" setting.
  function computeRankBadges(now){
    var badges = {};
    var msFor = state.rankByCumulative ? cumulativeFieldMs : currentPeriodFieldMs;
    var all = state.players.map(function(p){ return { id: p.id, ms: msFor(p.id, now) }; });
    var n = all.length;
    if (n < 2) return badges;
    all.sort(function(a,b){ return b.ms - a.ms; });
    if (all[0].ms === all[n-1].ms) return badges;
    badges[all[0].id] = 'most';
    badges[all[n-1].id] = 'least';
    if (n >= 4){
      badges[all[1].id] = 'most2';
      badges[all[n-2].id] = 'least2';
    }
    return badges;
  }

  // Picks the swap the "Forslag" button recommends: whoever on the field
  // has the most playtime (same metric/toggle as computeRankBadges above)
  // AMONG those who have actually exceeded the defined swap time (byttetid)
  // in their current stint - not just whoever has the most playtime
  // overall, since that player might have only just come on - paired with
  // whoever has waited longest on the bench. Returns null when nobody on
  // the field is actually due yet, or the bench is empty.
  /** @param {number} now @returns {{fieldId:string, benchId:string}|null} */
  function computeSwapSuggestion(now){
    if (state.onBench.length === 0) return null;
    var msFor = state.rankByCumulative ? cumulativeFieldMs : currentPeriodFieldMs;
    var due = state.onField.filter(function(id){ return fieldElapsed(id, now) >= state.defaultDurationMs; });
    if (due.length === 0) return null;
    due.sort(function(a,b){ return msFor(b, now) - msFor(a, now); });
    var benchSorted = state.onBench.slice().sort(function(a,b){ return benchElapsed(b, now) - benchElapsed(a, now); });
    return { fieldId: due[0], benchId: benchSorted[0] };
  }

  /** @template T @param {T} value @returns {T} */
  function cloneStateValue(value){
    try { return JSON.parse(JSON.stringify(value)); }
    catch(e){ return value; }
  }

  /** @returns {AppState} */
  function snapshotState(){
    return {
      players: cloneStateValue(state.players),
      onField: (state.onField || []).slice(),
      onBench: (state.onBench || []).slice(),
      fieldTimers: cloneStateValue(state.fieldTimers),
      benchTimers: cloneStateValue(state.benchTimers),
      cumulative: cloneStateValue(state.cumulative),
      periodStartCumulative: cloneStateValue(state.periodStartCumulative || {}),
      matchClock: cloneStateValue(state.matchClock || { baseElapsedMs: 0, sinceTs: Date.now() }),
      globalRunning: !!state.globalRunning,
      defaultDurationMs: state.defaultDurationMs,
      matchDurationMs: state.matchDurationMs,
      fieldSize: state.fieldSize,
      fieldSlotAssignment: cloneStateValue(state.fieldSlotAssignment || null),
      wakeLockEnabled: !!state.wakeLockEnabled,
      rankByCumulative: !!state.rankByCumulative,
      reorgUsesLastMatch: !!state.reorgUsesLastMatch,
      shareEditable: !!state.shareEditable,
      sessionOwnerDeviceId: state.sessionOwnerDeviceId,
      participants: cloneStateValue(state.participants || []),
      goalLog: cloneStateValue(state.goalLog || []),
      swapCount: typeof state.swapCount === 'number' ? state.swapCount : 0,
      lastActivityAt: state.lastActivityAt,
      opponentName: state.opponentName || '',
      opponentAbbr: state.opponentAbbr || '',
      matchHistory: cloneStateValue(state.matchHistory || []),
      rev: typeof state.rev === 'number' ? state.rev : 0
    };
  }

  /** @param {AppState} snap */
  function restoreState(snap){
    if (!snap) return;
    state.players = cloneStateValue(snap.players || state.players || []);
    state.onField = (snap.onField || []).slice();
    state.onBench = (snap.onBench || []).slice();
    state.fieldTimers = cloneStateValue(snap.fieldTimers || {});
    state.benchTimers = cloneStateValue(snap.benchTimers || {});
    state.cumulative = cloneStateValue(snap.cumulative || {});
    state.periodStartCumulative = cloneStateValue(snap.periodStartCumulative || {});
    state.matchClock = cloneStateValue(snap.matchClock || { baseElapsedMs: 0, sinceTs: Date.now() });
    state.globalRunning = !!snap.globalRunning;
    state.defaultDurationMs = typeof snap.defaultDurationMs === 'number' ? snap.defaultDurationMs : state.defaultDurationMs;
    state.matchDurationMs = typeof snap.matchDurationMs === 'number' ? snap.matchDurationMs : state.matchDurationMs;
    state.fieldSize = typeof snap.fieldSize === 'number' ? snap.fieldSize : state.fieldSize;
    state.fieldSlotAssignment = Array.isArray(snap.fieldSlotAssignment) ? cloneStateValue(snap.fieldSlotAssignment) : null;
    state.wakeLockEnabled = snap.wakeLockEnabled !== undefined ? !!snap.wakeLockEnabled : state.wakeLockEnabled;
    state.rankByCumulative = snap.rankByCumulative !== undefined ? !!snap.rankByCumulative : state.rankByCumulative;
    state.reorgUsesLastMatch = snap.reorgUsesLastMatch !== undefined ? !!snap.reorgUsesLastMatch : state.reorgUsesLastMatch;
    state.shareEditable = snap.shareEditable !== undefined ? !!snap.shareEditable : state.shareEditable;
    state.sessionOwnerDeviceId = snap.sessionOwnerDeviceId !== undefined ? snap.sessionOwnerDeviceId : state.sessionOwnerDeviceId;
    state.participants = cloneStateValue(snap.participants || state.participants || []);
    state.goalLog = cloneStateValue(snap.goalLog || []);
    state.swapCount = typeof snap.swapCount === 'number' ? snap.swapCount : state.swapCount;
    state.lastActivityAt = typeof snap.lastActivityAt === 'number' ? snap.lastActivityAt : state.lastActivityAt;
    state.opponentName = snap.opponentName !== undefined ? snap.opponentName : state.opponentName;
    state.opponentAbbr = snap.opponentAbbr !== undefined ? snap.opponentAbbr : state.opponentAbbr;
    state.matchHistory = cloneStateValue(snap.matchHistory || state.matchHistory || []);
  }

  // Call BEFORE mutating state for any undoable action - pushes the
  // pre-mutation snapshot onto the undo stack, capped at UNDO_MAX so
  // undoLastAction() can be pressed repeatedly to step back that many moves.
  // A genuine new action invalidates any pending redo (standard undo/redo
  // semantics), so this also clears redoStack.
  function pushUndoSnapshot(){
    undoStack.push(snapshotState());
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = [];
    updateUndoUI();
  }

  // Drives the back-button's badge (how many steps currently stepped back
  // from live state) - the button itself always opens the action sheet now,
  // so it's never disabled here; the sheet's own Undo/Redo items reflect
  // whether their stack has anything in it.
  function updateUndoUI(){
    if (!els.undoCountBadge) return;
    var n = redoStack.length;
    els.undoCountBadge.textContent = String(n);
    els.undoCountBadge.hidden = n === 0;
  }

  function undoLastAction(){
    if (!canEdit()) return;
    var snap = undoStack.pop();
    if (!snap) return;
    redoStack.push(snapshotState());
    if (redoStack.length > UNDO_MAX) redoStack.shift();
    restoreState(snap);
    selected = null;
    suggestedPartnerId = null;
    swapSuggestionArmed = false;
    saveState();
    updateUndoUI();
    renderAll();
  }

  function redoLastAction(){
    if (!canEdit()) return;
    var snap = redoStack.pop();
    if (!snap) return;
    undoStack.push(snapshotState());
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    restoreState(snap);
    selected = null;
    suggestedPartnerId = null;
    swapSuggestionArmed = false;
    saveState();
    updateUndoUI();
    renderAll();
  }

  // Re-shows the launcher screen over the still-live app - no state/timer
  // changes, since clocks are timestamp-based (sinceTs/baseElapsedMs) and
  // keep advancing correctly regardless of what's on screen.
  function showLauncherMenu(){
    els.launcherTile.classList.remove('lifted');
    els.launcherScreen.classList.remove('hidden');
  }

  /** @param {string} id @returns {Player|null} */
  function playerById(id){
    for (var i=0;i<state.players.length;i++){ if (state.players[i].id === id) return state.players[i]; }
    return null;
  }

  function escapeHtml(str){
    return str.replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  /* ---------------- Rendering ---------------- */

  // More utespillere sharing the same pitch means smaller icons, so they
  // still all fit without crowding. Sets CSS custom properties consumed by
  // .field-token/.avatar/.badge-warning/label/timer - see those rules.
  // Bench tokens are unaffected (fixed size), only the field gets denser.
  //
  // Used to be 4 static size tiers keyed only on fieldSize, tuned for the
  // old free-wrapping layout where any number of tokens could flow across
  // as many lines as needed with no visual penalty. Once renderField()
  // started grouping tokens into real formation rows (see
  // fieldFormationRows()), that stopped being the actual constraint - a
  // fixed preset that happened to fit a loose wrapped blob of e.g. 7 tokens
  // does NOT guarantee the widest single ROW in a formation (up to 4
  // players standing shoulder to shoulder) fits the screen width without
  // wrapping to a second line, which then silently doubles that row's
  // height and overflows the pitch vertically too - a real bug this
  // shipped as, only caught by actually measuring a formation against a
  // narrow-phone viewport (iPhone SE width), not by eyeballing a wider
  // simulator. Computed dynamically from the real #field-wrap box instead,
  // so it's correct for whatever formation/screen combination actually
  // occurs rather than a guessed preset.
  // Last avatar px size applyFieldDensity() computed - fieldUsesSingleLetter()
  // below reads this instead of guessing from fieldSize alone, since the
  // dynamic sizing means the actual rendered avatar no longer maps 1:1 to
  // fieldSize (a narrow phone can shrink it earlier, a wide one later).
  var lastFieldAvatarSize = 68;
  function applyFieldDensity(){
    var formation = fieldFormationRows(state.fieldSize);
    var rowCount = formation.rows.length;
    var maxRowLen = 1;
    formation.rows.forEach(function(c){ if (c > maxRowLen) maxRowLen = c; });

    var wrapW = (els.fieldWrap && els.fieldWrap.clientWidth) || 360;
    var wrapH = (els.fieldWrap && els.fieldWrap.clientHeight) || 420;

    // Width constraint: the widest row's tokens (+ the gaps between them)
    // side by side, inside #field's own horizontal padding (see
    // style.css), plus a small safety margin for the safe-area insets
    // baked into that padding on notched devices.
    var colGap = 14;
    var availW = Math.max(140, wrapW - (16 + 16) - 20);
    var tokenFromWidth = Math.floor((availW - (maxRowLen - 1) * colGap) / maxRowLen);

    // Height constraint: one token's full height (avatar + label + timer)
    // per row, stacked with the row gap between them. Treats the
    // goalkeeper row as a full row too even though .field-row-keeper's
    // negative margin actually lets it overlap into the row above - that
    // makes this a slight overestimate of the space needed, i.e. errs
    // toward a smaller/safer size instead of risking overflow. The 98
    // matches #field's own padding-top in style.css exactly (clearance for
    // .match-clock-wrap sitting on top of the pitch) - keep both in sync.
    var rowGap = 6;
    // The extra 6 (only when there's a keeper row) reserves room for
    // .field-row-pre-keeper's own fixed margin-bottom - see its comment in
    // style.css for why that exists instead of just nudging the keeper
    // further up. Keep both this and that 6px in sync.
    var availH = Math.max(140, wrapH - (98 + 16) - 12 - rowGap * (rowCount - 1) - (formation.hasKeeper ? 6 : 0));
    var perRowH = availH / rowCount;
    // avatar + label (margin-top 8 + ~1.2 line-height) + timer (margin-top
    // 3 + ~1.2 line-height), with label/timer font sizes both ~0.23x the
    // avatar (matches the old tiers' own ratios) - solves perRowH for the
    // avatar size that makes the whole stack fit exactly. (Used to also
    // budget room for a .field-pos-tag pill above the avatar - that moved
    // into #selectionInfo's popup instead, see updateSelectionInfo(), so
    // tokens on the pitch itself are back to just avatar+label+timer.)
    var avatarFromHeight = (perRowH - 11) / 1.546;

    // Avatar sits inside the token box at roughly 0.70x its width across
    // every old tier (68/96, 58/84, 50/74, 44/66) - reusing that ratio
    // keeps the same visual proportions at any computed size.
    var avatarFromWidth = tokenFromWidth * 0.70;

    var avatar = Math.round(Math.min(avatarFromHeight, avatarFromWidth));
    // Only capped from above (70px, purely cosmetic - no need for jumbo
    // icons on a spacious tablet) - NOT forced up from below past whatever
    // the fit math above actually solved for. A forced-up floor here was a
    // real bug: on the smallest common phone with a full 4-row formation
    // (keeper included) plus .field-pos-tag's own height, the math solves
    // for ~21px, and forcing that up to a nicer-looking 34px silently
    // overlapped the keeper row into the row above it - only caught by
    // measuring actual rendered token positions against each other on that
    // exact viewport, not by testing on a bigger phone where 34px fits
    // fine. 20px is the true last-resort floor (below that a circle with
    // one letter in it stops being legible at all) - #field's own
    // overflow-y:auto remains the final safety net for anything smaller
    // still, same as it always was.
    avatar = Math.max(20, Math.min(70, avatar));
    lastFieldAvatarSize = avatar;
    var token = Math.round(avatar / 0.70);

    // The keeper row (.field-row-keeper) pulls itself up toward the row
    // above via a negative margin, so it reads as "just behind the back
    // line" instead of a full 4th row - but how far it can safely move
    // depends on how much slack this avatar size actually left inside its
    // row's own budget (perRowH above). A fixed ratio of avatar size (what
    // this used to be) doesn't account for that - real bug this shipped
    // as once, only caught by measuring actual rendered
    // getBoundingClientRect()s against each other, not by eyeballing one
    // screenshot. Capped at 12px and 60% of the leftover slack so it can
    // never eat into space the row above actually needs. Capped at 6 (not
    // the original 12) now that .field-row-pre-keeper's own fixed margin
    // also contributes real, guaranteed clearance above the keeper -
    // between the two, the defense row moves up rather than the keeper
    // needing to be pulled up as aggressively on its own.
    var contentH = avatar + 11;
    var slack = Math.max(0, perRowH - contentH);
    var keeperNudge = Math.round(Math.min(6, slack * 0.6));

    var t = {
      avatar: avatar,
      avatarFont: Math.round(avatar * 0.28),
      token: token,
      label: Math.round(avatar * 0.22),
      labelW: token,
      timer: Math.round(avatar * 0.235),
      badge: Math.round(avatar * 0.34),
      badgeFont: Math.round(avatar * 0.205),
      keeperNudge: keeperNudge
    };
    var s = document.documentElement.style;
    s.setProperty('--field-avatar-size', t.avatar + 'px');
    s.setProperty('--field-avatar-font', t.avatarFont + 'px');
    s.setProperty('--field-token-width', t.token + 'px');
    s.setProperty('--field-label-font', t.label + 'px');
    s.setProperty('--field-label-max-w', t.labelW + 'px');
    s.setProperty('--field-timer-font', t.timer + 'px');
    s.setProperty('--field-badge-size', t.badge + 'px');
    s.setProperty('--field-keeper-nudge', t.keeperNudge + 'px');
    s.setProperty('--field-badge-font', t.badgeFont + 'px');
  }

  // Once the field avatar is too small to comfortably show two letters,
  // fall back to one - reads the size applyFieldDensity() actually landed
  // on (see lastFieldAvatarSize) rather than fieldSize directly, since a
  // narrow phone can hit that threshold earlier than a wide one would at
  // the same fieldSize.
  function fieldUsesSingleLetter(){
    return lastFieldAvatarSize <= 50;
  }

  // Real-football row shapes per fieldSize (1-11), bottom-to-top (keeper/
  // back line first, forward line last) - renderField() slices the
  // time-sorted onField list into these bands instead of just letting them
  // wrap freely, so e.g. 5v5 reads as a back three + front two rather than
  // a loose cluster. No dedicated keeper line under 6 (a lone extra token
  // in a 5-a-side game isn't meaningfully "a goalkeeper" the way it is once
  // there's a real back line in front of it) - from 6 up, one slot peels
  // off as keeper and the rest split into defence/midfield/forward using
  // the same 3/2/1 (7), 3/3/1 (8), 3/3/2 (9), 4/3/2 (10), 4/4/2 (11) shapes
  // real small-sided/11-a-side football actually uses, not an even split.
  var FIELD_FORMATIONS = {
    1: { rows:[1],         roles:['B'],         hasKeeper:false },
    2: { rows:[1,1],       roles:['B','S'],     hasKeeper:false },
    3: { rows:[2,1],       roles:['B','S'],     hasKeeper:false },
    4: { rows:[2,2],       roles:['B','S'],     hasKeeper:false },
    5: { rows:[3,2],       roles:['B','S'],     hasKeeper:false },
    6: { rows:[1,2,2,1],   roles:['K','B','M','S'], hasKeeper:true },
    7: { rows:[1,3,2,1],   roles:['K','B','M','S'], hasKeeper:true },
    8: { rows:[1,3,3,1],   roles:['K','B','M','S'], hasKeeper:true },
    9: { rows:[1,3,3,2],   roles:['K','B','M','S'], hasKeeper:true },
    10:{ rows:[1,4,3,2],   roles:['K','B','M','S'], hasKeeper:true },
    11:{ rows:[1,4,4,2],   roles:['K','B','M','S'], hasKeeper:true }
  };
  /** @returns {{rows:number[], roles:string[], hasKeeper:boolean}} */
  function fieldFormationRows(fieldSize){
    var n = Math.max(1, Math.min(11, fieldSize || 3));
    return FIELD_FORMATIONS[n] || FIELD_FORMATIONS[3];
  }

  // Positions only mean anything from 5v5 up - at 3v3 (and the in-between
  // 4v4) the kids are too young for fixed spots and just chase the ball
  // everywhere, so the field stays the old free-for-all (see renderField()'s
  // branch on this). From 5v5 up, every field slot has a genuine identity
  // (see fieldSlotTags below) that a sub inherits when swapped on, and that
  // two on-field players can trade directly by dragging one onto the other.
  function fieldHasPositions(){
    return (state.fieldSize || 3) >= 5;
  }

  // Left/center/right tag(s) for one row of `count` players at one role
  // letter (K=keeper, B=back/forsvar, M=midtbane, S=spiss/angrep) - "V"/"H"
  // prefixes (venstre/høyre) only kick in once there's more than one player
  // to actually tell apart; a lone keeper or lone forward just gets the
  // bare letter. Max row length in any formation here is 4 (see
  // FIELD_FORMATIONS), so 3 and 4-wide rows are the only cases that need a
  // center/split-center variant.
  /** @param {number} count @param {string} letter @returns {string[]} */
  function positionTags(count, letter){
    if (count <= 1) return [letter];
    if (count === 2) return ['V'+letter, 'H'+letter];
    if (count === 3) return ['V'+letter, letter, 'H'+letter];
    if (count === 4) return ['V'+letter, 'VS'+letter, 'HS'+letter, 'H'+letter];
    var out = [];
    for (var i = 0; i < count; i++) out.push(letter + (i+1));
    return out;
  }

  // Flat list of {tag, name} for every slot in a fieldSize's formation,
  // bottom-to-top / left-to-right - same order state.fieldSlotAssignment
  // uses (see syncFieldSlots()), so index i here always names slot i there.
  var FIELD_SLOT_NAMES = { K:'Keeper', B:'Forsvar', M:'Midtbane', S:'Angrep' };
  /** @returns {{tag:string, role:string}[]} */
  function fieldSlotList(fieldSize){
    var formation = fieldFormationRows(fieldSize);
    var out = [];
    formation.rows.forEach(function(count, i){
      var role = formation.roles[i];
      positionTags(count, role).forEach(function(tag){ out.push({ tag: tag, role: role }); });
    });
    return out;
  }

  // Keeps state.fieldSlotAssignment (an array of player ids, index = slot,
  // same order as fieldSlotList()) in sync with the real membership in
  // state.onField, without caring HOW onField changed - a normal bench<->
  // field swap, resetMatch(), joining someone else's shared session, a
  // roster edit that removed a player, all just fall out of the same
  // reconciliation. A departing id's slot is freed; any onField id missing
  // from the array lands in the first free slot - which, for the common
  // "one player swapped for another" case, is exactly the slot the
  // departing player just vacated, so a substitute naturally inherits the
  // position of whoever they replaced (real substitution behavior) without
  // any drag/tap code needing to know that on purpose. Call before reading
  // fieldSlotAssignment anywhere it matters (renderField() does, every
  // render) - idempotent and cheap, so calling it defensively costs nothing.
  function syncFieldSlots(){
    if (!fieldHasPositions()){ state.fieldSlotAssignment = null; return; }
    var totalSlots = fieldSlotList(state.fieldSize).length;
    var arr = Array.isArray(state.fieldSlotAssignment) ? state.fieldSlotAssignment.slice(0, totalSlots) : [];
    while (arr.length < totalSlots) arr.push(null);
    var seen = {};
    arr = arr.map(function(id){
      if (!id || state.onField.indexOf(id) === -1) return null;
      if (seen[id]) return null; // defensive: never let one id occupy two slots
      seen[id] = true;
      return id;
    });
    state.onField.forEach(function(id){
      if (arr.indexOf(id) !== -1) return;
      var emptyIdx = arr.indexOf(null);
      if (emptyIdx !== -1) arr[emptyIdx] = id; else arr.push(id);
    });
    state.fieldSlotAssignment = arr;
  }

  // Short position tag (e.g. "HB") for a player currently on the field, or
  // null if positions aren't active for this fieldSize or the id isn't on
  // the field at all - used by updateSelectionInfo() to show it inside the
  // spillerinfo popup (see that function's own comment for why it lives
  // there now instead of on the token itself).
  /** @param {string} id @returns {string|null} */
  function fieldPositionTagFor(id){
    if (!fieldHasPositions()) return null;
    syncFieldSlots();
    var arr = state.fieldSlotAssignment;
    if (!arr) return null;
    var idx = arr.indexOf(id);
    if (idx === -1) return null;
    var slots = fieldSlotList(state.fieldSize);
    return slots[idx] ? slots[idx].tag : null;
  }

  // Same lookup as fieldPositionTagFor() but the bare role letter (K/B/M/S)
  // instead of the full tag (e.g. "VM") - used by renderGoalPlayerList() to
  // group the goal-scorer picker by line (angrep/midtbane/forsvar) once
  // there are enough players on the field for that grouping to mean
  // anything (see GOAL_PICKER_GROUP_BY_ROLE_MIN_FIELD_SIZE below).
  /** @param {string} id @returns {string|null} */
  function fieldPositionRoleFor(id){
    if (!fieldHasPositions()) return null;
    syncFieldSlots();
    var arr = state.fieldSlotAssignment;
    if (!arr) return null;
    var idx = arr.indexOf(id);
    if (idx === -1) return null;
    var slots = fieldSlotList(state.fieldSize);
    return slots[idx] ? slots[idx].role : null;
  }

  // Pure position trade - both players stay on the field the whole time
  // (no field/bench membership change, no timer interruption), so this is
  // deliberately NOT swapFieldAndBench()/performSwap(), which both commit a
  // field or bench stint as part of the mutation. pushUndoSnapshot() runs
  // BEFORE the actual swap (it snapshots current state as the "undo to"
  // point - performSwap() above is the same order), so undoing this
  // reliably restores the pre-swap positions rather than being a no-op.
  /** @param {string} idA @param {string} idB */
  function performPositionSwap(idA, idB){
    syncFieldSlots();
    var arr = state.fieldSlotAssignment;
    if (!arr) return;
    var ia = arr.indexOf(idA), ib = arr.indexOf(idB);
    if (ia === -1 || ib === -1) return;
    pushUndoSnapshot();
    arr[ia] = idB;
    arr[ib] = idA;
    saveState();
    renderAll();
    flashSwapped(/** @type {HTMLElement|null} */ (els.field.querySelector('[data-id="' + idA + '"]')));
    flashSwapped(/** @type {HTMLElement|null} */ (els.field.querySelector('[data-id="' + idB + '"]')));
  }

  function renderAll(){
    applyFieldDensity();
    applyEditPermissionUI();
    renderField();
    renderBench();
    updatePlayPauseUI();
    updateTimersOnly();
    updateUndoUI();
    updateMultiSelectUI();
    updateSwapSuggestionUI();
    renderScore();
  }

  function renderScore(){
    els.homeScoreBtn.textContent = String(teamGoalCount('home'));
    els.awayScoreBtn.textContent = String(teamGoalCount('away'));
    if (els.awayTeamLabel){
      els.awayTeamLabel.textContent = state.opponentAbbr || '?';
      els.awayTeamLabel.classList.toggle('unset', !state.opponentAbbr);
    }
  }

  // Best-effort 3-letter code from a full opponent name, for someone who
  // typed the name but skipped the abbreviation field - first letter of up
  // to the first 3 words (e.g. "Sandefjord BK" -> "SB", "Nøtterøy 2" ->
  // "N2"), falling back to the first 3 letters of one long word.
  /** @param {string} name @returns {string} */
  function deriveAbbrFromName(name){
    var words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length > 1){
      return words.slice(0, 3).map(function(w){ return w[0]; }).join('').toUpperCase();
    }
    return (words[0] || '').slice(0, 3).toUpperCase();
  }

  // "Lurt sted" for the opponent prompt: called right as a genuinely new,
  // not-yet-started match begins - after the very first roster save (see
  // saveSettings) and after every "Kampslutt" (see endMatchPeriod's call
  // sites below), since a cup day is several matches, likely against
  // different opponents, back to back. Also reachable any time by tapping
  // the "?"/abbreviation on the scoreboard itself, so a wrong automatic
  // guess about *when* to ask is never more than one tap to fix.
  function openOpponentModal(){
    if (!canEdit()) return;
    els.opponentNameInput.value = state.opponentName || '';
    els.opponentAbbrInput.value = state.opponentAbbr || '';
    els.opponentModal.classList.add('open');
    setTimeout(function(){ els.opponentNameInput.focus(); }, 50);
  }

  function saveOpponent(){
    var name = els.opponentNameInput.value.trim();
    var abbr = els.opponentAbbrInput.value.trim().toUpperCase();
    if (!abbr && name) abbr = deriveAbbrFromName(name);
    state.opponentName = name;
    state.opponentAbbr = abbr;
    saveState();
    els.opponentModal.classList.remove('open');
    renderScore();
  }

  /** @param {'home'|'away'} team */
  function teamGoalCount(team){
    var n = 0;
    state.goalLog.forEach(function(g){ if (g.team === team) n++; });
    return n;
  }

  /** @param {'home'|'away'} team @returns {GoalEntry|null} */
  function lastGoalEntry(team){
    for (var i = state.goalLog.length - 1; i >= 0; i--){
      if (state.goalLog[i].team === team) return state.goalLog[i];
    }
    return null;
  }

  // Per-player home-team tallies (for the avatar badge and the top-scorer
  // highlight) - computed once per render, same pattern as
  // computeRankBadges above. Away goals are never attributed to a player
  // (see onAwayScoreTap), so only 'home' entries with a playerId count.
  function computeGoalBadges(){
    var counts = {};
    var max = 0;
    state.goalLog.forEach(function(g){
      if (g.team !== 'home' || !g.playerId) return;
      counts[g.playerId] = (counts[g.playerId] || 0) + 1;
      if (counts[g.playerId] > max) max = counts[g.playerId];
    });
    return { counts: counts, max: max };
  }

  // Match-clock time (not wall-clock) each of a player's goals was
  // registered at, in the order they were scored - kampklokka resets each
  // "Kampslutt", so a second-period goal can legitimately show an earlier
  // time than a first-period one; that's accurate, not a bug. Entries
  // logged before matchMs existed fall back to 0 rather than "NaN:NaN".
  /** @param {string} playerId @returns {number[]} */
  function goalTimesForPlayer(playerId){
    return state.goalLog
      .filter(function(g){ return g.team === 'home' && g.playerId === playerId; })
      .map(function(g){ return typeof g.matchMs === 'number' ? g.matchMs : 0; });
  }

  // A goal is undoable the same way a substitution is (see pushUndoSnapshot
  // above togglePlayPause) - both just mutate `state` before saving, so the
  // generic snapshot-based undo stack covers this for free.
  var GOAL_CONFIRM_WINDOW_MS = 30000;
  // A goal on a player who JUST got subbed off (≤15s ago) is almost always
  // the normal "scored, then subbed, then registered the goal" order done
  // in the other sequence - not worth a warning. Past that, it's more
  // likely to be a mis-tap (wrong player) or a goal attributed after the
  // fact to someone no longer even in play, so it's worth a confirm.
  var BENCH_GOAL_WARNING_MS = 15000;
  /** @type {'home'|'away'|null} */
  var pendingGoalTeam = null;
  /** @type {string|null} */
  var pendingGoalPlayerId = null;

  /** @param {'home'|'away'} team @param {string|null} playerId */
  function registerGoal(team, playerId){
    pushUndoSnapshot();
    var now = Date.now();
    state.goalLog.push({ id: uid(), team: team, playerId: playerId || null, at: now, matchMs: matchClockElapsed(now) });
    saveState();
    renderAll();
  }

  // Returns the confirm-dialog text to show before actually registering a
  // goal, or null if it can go straight through. Two independent reasons to
  // ask first - registered right after another goal for the same team
  // (probably a duplicate tap), or attributed to a player currently on the
  // bench (probably the wrong player, or a goal logged well after the sub)
  // - combined into one message when both apply, rather than stacking two
  // separate confirms back to back.
  /** @param {'home'|'away'} team @param {string|null} playerId @param {number} now @returns {string|null} */
  function goalConfirmMessage(team, playerId, now){
    var last = lastGoalEntry(team);
    var duplicate = !!(last && (now - last.at) < GOAL_CONFIRM_WINDOW_MS);
    var onBench = !!(playerId && state.onBench.indexOf(playerId) !== -1 && benchElapsed(playerId, now) > BENCH_GOAL_WARNING_MS);
    if (duplicate && onBench) return 'Mål registrert på en innbytter, kort tid etter forrige mål. Korrekt?';
    if (onBench) return 'Mål registrert på innbytter. Korrekt?';
    if (duplicate) return 'Et mål ble nettopp registrert. Er du sikker?';
    return null;
  }

  // Away goals stay anonymous (see onHomePlayerPicked for the home flow),
  // so only the duplicate-goal check applies here - gated by the same
  // shared-state 30s window, keyed on the synced goalLog rather than a
  // local timer, so it also catches a second device registering the same
  // goal.
  function onAwayScoreTap(){
    if (!canEdit()) return;
    var msg = goalConfirmMessage('away', null, Date.now());
    if (msg){
      pendingGoalTeam = 'away';
      pendingGoalPlayerId = null;
      els.goalConfirmText.textContent = msg;
      els.goalConfirmModal.classList.add('open');
      return;
    }
    registerGoal('away', null);
  }

  /** @param {string} playerId */
  function onHomePlayerPicked(playerId){
    var msg = goalConfirmMessage('home', playerId, Date.now());
    if (msg){
      pendingGoalTeam = 'home';
      pendingGoalPlayerId = playerId;
      els.goalConfirmText.textContent = msg;
      els.goalConfirmModal.classList.add('open');
      return;
    }
    registerGoal('home', playerId);
  }

  function closeGoalConfirm(){
    pendingGoalTeam = null;
    pendingGoalPlayerId = null;
    els.goalConfirmModal.classList.remove('open');
  }

  // Long-press correction for a mis-registered goal - deliberately NOT
  // routed through the 10s duplicate check (a correction isn't a new
  // goal), and reachable at any point during the match rather than only
  // while the mistake is still within reach of the (3-deep) undo stack.
  // For home goals this removes a SPECIFIC player's most recent goal (see
  // openGoalPlayerModal('remove')) rather than guessing which one was wrong.
  /** @param {'home'|'away'} team @param {string|null} playerId */
  function removeLastGoal(team, playerId){
    if (!canEdit()) return;
    var idx = -1;
    for (var i = state.goalLog.length - 1; i >= 0; i--){
      var g = state.goalLog[i];
      if (g.team !== team) continue;
      if (team === 'home' && g.playerId !== playerId) continue;
      idx = i;
      break;
    }
    if (idx === -1) return;
    pushUndoSnapshot();
    state.goalLog.splice(idx, 1);
    saveState();
    renderAll();
  }

  // Quick-remove shortcut (see .goal-quick-remove) - removes whichever
  // goal was actually registered last for the team, from whichever player
  // it's attributed to, without having to pick that player from the list.
  /** @param {'home'|'away'} team */
  function removeLastGoalOverall(team){
    if (!canEdit()) return;
    var last = lastGoalEntry(team);
    if (!last) return;
    pushUndoSnapshot();
    state.goalLog.splice(state.goalLog.indexOf(last), 1);
    saveState();
    renderAll();
  }

  var SCORE_LONG_PRESS_MS = 550;
  /** @param {HTMLElement} btn @param {() => void} onTap @param {() => void} onLongPress */
  function bindScoreButton(btn, onTap, onLongPress){
    var timer = /** @type {ReturnType<typeof setTimeout>|undefined} */ (undefined);
    var longPressed = false;
    btn.addEventListener('pointerdown', function(){
      longPressed = false;
      clearTimeout(timer);
      timer = setTimeout(function(){
        longPressed = true;
        onLongPress();
      }, SCORE_LONG_PRESS_MS);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function(evt){
      btn.addEventListener(evt, function(){ clearTimeout(timer); });
    });
    btn.addEventListener('click', function(){
      if (longPressed){ longPressed = false; return; } // swallow the click firing right after the long-press
      onTap();
    });
  }

  /** @type {'add'|'remove'|'view'} */
  var goalPlayerMode = 'add';

  // Angrep/midtbane/forsvar order for the goal-scorer picker's on-field
  // group (see renderGoalPlayerList()) - only applied once there are
  // enough players on the field for lines to mean anything (fieldSize >=
  // 6, same cutoff fieldHasPositions()/FIELD_FORMATIONS already use for
  // "real" back/mid/front lines vs. the free-for-all under that). Below
  // that, and always within one line, alphabetical.
  var GOAL_PICKER_ROLE_ORDER = { S:0, M:1, B:2, K:3 };
  /** @param {Player[]} list @param {boolean} groupByRole @returns {Player[]} */
  function sortGoalPickerGroup(list, groupByRole){
    return list.slice().sort(function(a, b){
      if (groupByRole){
        var ra = GOAL_PICKER_ROLE_ORDER[fieldPositionRoleFor(a.id) || ''];
        var rb = GOAL_PICKER_ROLE_ORDER[fieldPositionRoleFor(b.id) || ''];
        if (ra === undefined) ra = 9;
        if (rb === undefined) rb = 9;
        if (ra !== rb) return ra - rb;
      }
      return a.name.localeCompare(b.name, 'nb');
    });
  }

  function renderGoalPlayerList(){
    var goalBadges = computeGoalBadges();
    var singleLetter = fieldUsesSingleLetter();
    var rows = state.players.slice();
    // Where to insert the "these are substitutes" divider, in the
    // interactive (add/remove) modes only - null means no divider (view
    // mode's own sort below doesn't group by field/bench at all).
    var dividerBeforeIndex = null;
    if (goalPlayerMode === 'view'){
      rows = rows.filter(function(p){ return (goalBadges.counts[p.id] || 0) > 0; });
      rows.sort(function(a,b){ return (goalBadges.counts[b.id] || 0) - (goalBadges.counts[a.id] || 0); });
    } else {
      var onFieldSet = {};
      state.onField.forEach(function(id){ onFieldSet[id] = true; });
      var onFieldPlayers = rows.filter(function(p){ return onFieldSet[p.id]; });
      var benchPlayers = rows.filter(function(p){ return !onFieldSet[p.id]; });
      var groupByRole = fieldHasPositions() && (state.fieldSize || 3) >= 6;
      onFieldPlayers = sortGoalPickerGroup(onFieldPlayers, groupByRole);
      benchPlayers = sortGoalPickerGroup(benchPlayers, false);
      rows = onFieldPlayers.concat(benchPlayers);
      if (onFieldPlayers.length > 0 && benchPlayers.length > 0) dividerBeforeIndex = onFieldPlayers.length;
    }
    if (rows.length === 0){
      els.goalPlayerList.innerHTML = '<p class="goal-player-empty">Ingen mål registrert ennå.</p>';
      return;
    }
    var interactive = goalPlayerMode !== 'view';
    var tag = interactive ? 'button' : 'div';
    els.goalPlayerList.innerHTML = rows.map(function(p, i){
      var n = goalBadges.counts[p.id] || 0;
      var disabled = goalPlayerMode === 'remove' && n === 0;
      var openTag = '<' + tag + ' class="goal-player-row"' +
        (interactive ? ' type="button" data-id="' + p.id + '"' + (disabled ? ' disabled' : '') : '') + '>';
      return (i === dividerBeforeIndex ? '<div class="goal-player-divider"></div>' : '') +
        openTag +
        '<span class="goal-player-row-avatar">' + initials(p.name, singleLetter) + '</span>' +
        '<span class="goal-player-row-name">' + escapeHtml(p.name) + '</span>' +
        (n > 0 ? '<span class="goal-player-row-count">' + n + '</span>' : '') +
        (goalPlayerMode === 'view' && n > 0
          ? '<button type="button" class="goal-time-btn" data-id="' + p.id + '" aria-label="Vis måltidspunkt for ' + escapeHtml(p.name) + '">🕐</button>'
          : '') +
      '</' + tag + '>';
    }).join('');
    if (interactive){
      Array.prototype.forEach.call(els.goalPlayerList.querySelectorAll('.goal-player-row'), function(row){
        row.addEventListener('click', function(){
          var id = row.getAttribute('data-id');
          closeGoalPlayerModal();
          if (goalPlayerMode === 'add') onHomePlayerPicked(id);
          else removeLastGoal('home', id);
        });
      });
    } else {
      Array.prototype.forEach.call(els.goalPlayerList.querySelectorAll('.goal-time-btn'), function(btn){
        btn.addEventListener('click', function(e){
          e.stopPropagation();
          openGoalTimesModal(btn.getAttribute('data-id'));
        });
      });
    }
  }

  /** @param {'add'|'remove'|'view'} mode */
  function openGoalPlayerModal(mode){
    goalPlayerMode = mode;
    els.goalPlayerModalTitle.textContent =
      mode === 'add' ? 'Hvem scoret?' : mode === 'remove' ? 'Fjern mål fra hvem?' : 'Målskårere';
    els.goalRemoveLastBtn.hidden = mode !== 'remove';
    if (mode === 'remove'){
      els.goalRemoveLastBtn.disabled = teamGoalCount('home') === 0;
      var lastHome = lastGoalEntry('home');
      var lastHomePlayer = lastHome && lastHome.playerId ? playerById(lastHome.playerId) : null;
      els.goalRemoveLastTarget.textContent = lastHomePlayer ? '(' + lastHomePlayer.name + ')' : '';
    }
    renderGoalPlayerList();
    els.goalPlayerModal.classList.add('open');
  }

  function closeGoalPlayerModal(){
    els.goalPlayerModal.classList.remove('open');
  }

  // Behind the small clock icon on a scorer's row (target-list) and in the
  // end-match summary - a popup instead of showing every timestamp inline
  // keeps those lists readable even for a player with 7-8 goals.
  /** @param {string} playerId */
  function openGoalTimesModal(playerId){
    var p = playerById(playerId);
    if (!p) return;
    var times = goalTimesForPlayer(playerId);
    els.goalTimesTitle.textContent = p.name;
    els.goalTimesText.textContent = times.length > 0
      ? times.length + ' mål - ' + times.map(function(ms){ return formatMs(ms); }).join(', ')
      : 'Ingen mål registrert.';
    els.goalTimesModal.classList.add('open');
  }

  /* Draws pitch markings using the field-wrap's real pixel size, so 1 SVG
     unit = 1 real pixel. The circle and boxes are sized purely from width,
     so they're never stretched into ellipses - a taller screen just adds
     empty space between the fixed-size boxes and the center circle,
     exactly like a longer real pitch would look. */
  function renderPitchMarkings(){
    var rect = els.fieldWrap.getBoundingClientRect();
    var W = rect.width, H = rect.height;
    if (W <= 0 || H <= 0) return;
    var svg = els.pitchLines;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    var lc = 'rgba(255,255,255,.5)';
    var stroke = Math.max(1, W * 0.0035);
    var margin = W * 0.035;
    var circleR = W * 0.16;
    var dotR = Math.max(1.5, W * 0.007);
    var boxW = W * 0.58;
    var boxH = Math.min(W * 0.16, H * 0.28);
    var goalW = W * 0.26;
    var goalH = Math.min(W * 0.065, H * 0.12);
    var boxX = (W - boxW) / 2;
    var goalX = (W - goalW) / 2;

    svg.innerHTML =
      '<rect x="' + margin + '" y="' + margin + '" width="' + (W - 2*margin) + '" height="' + (H - 2*margin) + '" fill="none" stroke="' + lc + '" stroke-width="' + stroke + '"/>' +
      '<line x1="' + margin + '" y1="' + (H/2) + '" x2="' + (W-margin) + '" y2="' + (H/2) + '" stroke="' + lc + '" stroke-width="' + stroke + '"/>' +
      '<circle cx="' + (W/2) + '" cy="' + (H/2) + '" r="' + circleR + '" fill="none" stroke="' + lc + '" stroke-width="' + stroke + '"/>' +
      '<circle cx="' + (W/2) + '" cy="' + (H/2) + '" r="' + dotR + '" fill="' + lc + '"/>' +
      '<rect x="' + boxX + '" y="' + margin + '" width="' + boxW + '" height="' + boxH + '" fill="none" stroke="' + lc + '" stroke-width="' + stroke + '"/>' +
      '<rect x="' + boxX + '" y="' + (H - margin - boxH) + '" width="' + boxW + '" height="' + boxH + '" fill="none" stroke="' + lc + '" stroke-width="' + stroke + '"/>' +
      '<rect x="' + goalX + '" y="' + margin + '" width="' + goalW + '" height="' + goalH + '" fill="none" stroke="' + lc + '" stroke-width="' + stroke + '"/>' +
      '<rect x="' + goalX + '" y="' + (H - margin - goalH) + '" width="' + goalW + '" height="' + goalH + '" fill="none" stroke="' + lc + '" stroke-width="' + stroke + '"/>';
  }

  // Plain full-bleed is the CSS default now (see #viewport-frame) - a
  // real phone needs this function to do nothing at all to look right.
  // Its only job is deciding whether to ADD .desktop-preview (the
  // letterboxed phone mockup), for a non-touch window that isn't already
  // phone-shaped - e.g. a resized Mac browser. Touch + no-hover is a
  // direct, reliable signal for "this is an actual phone" (never gets
  // the preview class, ever, regardless of window size).
  function updateFrameFit(){
    var isTouchDevice = window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches;
    if (isTouchDevice){
      els.viewportFrame.classList.remove('desktop-preview');
      return;
    }
    var vw = window.innerWidth, vh = window.innerHeight;
    if (!vw || !vh) return;
    var targetRatio = vw > vh ? 956/440 : 440/956;
    var actualRatio = vw/vh;
    var diff = Math.abs(actualRatio - targetRatio) / targetRatio;
    els.viewportFrame.classList.toggle('desktop-preview', diff >= 0.04);
  }

  // #app/#viewport-frame size themselves with CSS 100dvh normally, which is
  // meant to be self-correcting - but on a cold PWA launch on iOS, the very
  // first 100dvh the engine reports can land a bit short (before Safari's
  // own chrome/status-bar has finished settling), and unlike renderPitchMarkings
  // (which already re-measures on the same settle signals below), nothing
  // was forcing #app to pick up the corrected value - it just silently kept
  // rendering at that first, too-short height, leaving a gap of bare navy
  // background under the pitch/bench until something else (any resize,
  // e.g. rotating the device) happened to invalidate its layout. Setting an
  // explicit inline pixel height here - re-applied on the exact same settle
  // signals as renderPitchMarkings - replaces that silent trust with an
  // active correction. Skipped entirely on non-touch (desktop-preview) so
  // it never fights that mode's own letterboxed width/height calc.
  function applyRealViewportHeight(){
    var isTouchDevice = window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches;
    if (!isTouchDevice) return;
    // Skipped while a text field has focus - visualViewport shrinking here
    // almost always means the on-screen keyboard just opened, not a
    // genuine cold-launch/rotation correction (this function's actual
    // purpose, see its own comment above). Actively clamping #app to that
    // shorter height fights iOS's own "scroll the focused input above the
    // keyboard" behavior instead of cooperating with it - the two together
    // is what produced the cropped-looking modal (title sliced off at the
    // very top) reported against a name field in Innstillinger. The app is
    // deliberately normal document flow, not position:fixed (see #app's
    // own comment) specifically so it can just scroll instead of us having
    // to hard-clamp its height for every viewport change.
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    var h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    if (!h) return;
    els.viewportFrame.style.height = h + 'px';
    els.appEl.style.height = h + 'px';
  }

  // SVG (not a CSS border-triangle) specifically so the white outline
  // is a true, uniform stroke - the old border-trick + drop-shadow-stack
  // outline came out thick at the point but thin along flat edges,
  // looking "cut off" on the pitch's white lines.
  function rankBadgeHtml(rank){
    if (!rank) return '';
    var up = (rank === 'most' || rank === 'most2');
    var points = up ? '7,2 12,12 2,12' : '2,2 12,2 7,12';
    return '<svg class="badge-rank rank-' + rank + '" viewBox="0 0 14 14" width="14" height="14">' +
      '<polygon points="' + points + '" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>' +
    '</svg>';
  }

  /** @param {string} playerId @param {{counts:Object<string,number>, max:number}} goalBadges */
  function goalBadgeHtml(playerId, goalBadges){
    var n = goalBadges.counts[playerId] || 0;
    if (n <= 0) return '';
    var top = goalBadges.max > 0 && n === goalBadges.max;
    return '<div class="badge-goals' + (top ? ' top-scorer' : '') + '">' + n + '</div>';
  }

  // Builds one .field-token element - shared by both renderField() branches
  // below (fixed positions vs. the old free time-sorted grouping) so the
  // actual token markup (avatar/badges/label/timer) only lives in one place.
  // The position tag (e.g. "HB") used to render as a pill above the avatar
  // here, but that's what caused the "tap a player, the popup opens, tap
  // near it, the tap falls through onto a token underneath" bug - moved
  // into #selectionInfo's own popup instead (see updateSelectionInfo() and
  // fieldPositionTagFor()), which no longer sits over the pitch at all.
  /** @param {string} id @param {number} now @param {Object} rankBadges @param {Object} goalBadges @param {boolean} singleLetter */
  function buildFieldTokenEl(id, now, rankBadges, goalBadges, singleLetter){
    var p = playerById(id);
    if (!p) return null;
    var elapsed = fieldElapsed(id, now);
    var timeUp = elapsed >= state.defaultDurationMs;
    var farOver = timeUp && elapsed >= state.defaultDurationMs * OVERTIME_FACTOR;
    var isChecked = multiMode && multiSelected.indexOf(id) !== -1;
    var el = document.createElement('div');
    el.className = 'token field-token token-enter' + (isChecked ? ' multi-checked' : '');
    el.dataset.id = id;
    el.innerHTML =
      '<div class="avatar' + (timeUp ? ' time-up' : '') + '">' + initials(p.name, singleLetter) +
        rankBadgeHtml(rankBadges[id]) +
        goalBadgeHtml(id, goalBadges) +
        (farOver ? '<div class="badge-warning overtime">⇅</div>' : timeUp ? '<div class="badge-warning due">⇅</div>' : '') +
        (isChecked ? '<div class="badge-check">✓</div>' : '') +
      '</div>' +
      '<div class="label">' + escapeHtml(p.name) + '</div>' +
      '<div class="timer' + (farOver ? ' overtime' : timeUp ? ' due' : '') + '">' + formatMs(elapsed) + '</div>';
    attachTokenEvents(el, id, 'field');
    return el;
  }

  function renderField(){
    els.field.innerHTML = '';
    var now = Date.now();
    var rankBadges = computeRankBadges(now);
    var goalBadges = computeGoalBadges();
    var singleLetter = fieldUsesSingleLetter();
    var formation = fieldFormationRows(state.fieldSize);
    var rowEls = [];

    if (fieldHasPositions()){
      // Fixed positions (5v5 and up, see fieldHasPositions()): each slot
      // keeps its own identity across swaps (see syncFieldSlots()/
      // performPositionSwap()) instead of being re-sorted by time on field
      // every render - a sub inherits the exact slot of whoever they
      // replaced, and dragging one on-field player onto another trades
      // their two positions directly without touching anyone else.
      syncFieldSlots();
      var slotIdx = 0;
      formation.rows.forEach(function(count, rowIndex){
        var rowEl = document.createElement('div');
        rowEl.className = 'field-row' +
          (formation.hasKeeper && rowIndex === 0 ? ' field-row-keeper' : '') +
          // The row directly above the keeper (always defense - rows[1]
          // whenever hasKeeper) - see .field-row-pre-keeper in style.css
          // for why this needs its own small nudge separate from the
          // keeper's own negative margin.
          (formation.hasKeeper && rowIndex === 1 ? ' field-row-pre-keeper' : '');
        for (var k = 0; k < count; k++, slotIdx++){
          var id = state.fieldSlotAssignment[slotIdx];
          if (!id) continue;
          var el = buildFieldTokenEl(id, now, rankBadges, goalBadges, singleLetter);
          if (el) rowEl.appendChild(el);
        }
        rowEls.push(rowEl);
      });
    } else {
      // No fixed positions (3v3/4v4 - too young for a back line to mean
      // anything, see fieldHasPositions()) - same free grouping as before:
      // whoever's been on field longest fills the back row first.
      var sorted = state.onField.filter(function(id, i){ return state.onField.indexOf(id) === i; }).sort(function(a,b){
        var diff = fieldElapsed(a, now) - fieldElapsed(b, now);
        if (diff !== 0) return diff;
        var pa = playerById(a), pb = playerById(b);
        if (!pa || !pb) return 0;
        return pa.name.localeCompare(pb.name, 'nb');
      });
      var idx = 0;
      formation.rows.forEach(function(count){
        var rowEl = document.createElement('div');
        rowEl.className = 'field-row';
        for (var k = 0; k < count && idx < sorted.length; k++, idx++){
          var el = buildFieldTokenEl(sorted[idx], now, rankBadges, goalBadges, singleLetter);
          if (el) rowEl.appendChild(el);
        }
        rowEls.push(rowEl);
      });
    }

    // Row wrapper elements are built bottom-to-top (keeper/back line
    // first) either way - append to #field top-to-bottom (forward line
    // first), see the DOM-order comment on #field in style.css.
    for (var r = rowEls.length - 1; r >= 0; r--) els.field.appendChild(rowEls[r]);
    applySelectionStyles();
  }

  function renderBench(){
    els.bench.innerHTML = '';
    var now = Date.now();
    var rankBadges = computeRankBadges(now);
    var goalBadges = computeGoalBadges();
    var sorted = state.onBench.filter(function(id, i){ return state.onBench.indexOf(id) === i; }).sort(function(a,b){
      var diff = benchElapsed(a, now) - benchElapsed(b, now);
      if (diff !== 0) return diff;
      var pa = playerById(a), pb = playerById(b);
      if (!pa || !pb) return 0;
      return pa.name.localeCompare(pb.name, 'nb');
    });
    sorted.forEach(function(id){
      var p = playerById(id);
      if (!p) return;
      var isChecked = multiMode && multiSelected.indexOf(id) !== -1;
      var el = document.createElement('div');
      el.className = 'token bench-token token-enter' + (isChecked ? ' multi-checked' : '');
      el.dataset.id = id;
      el.innerHTML =
        '<div class="avatar bench-avatar">' + initials(p.name) +
          rankBadgeHtml(rankBadges[id]) +
          goalBadgeHtml(id, goalBadges) +
          (isChecked ? '<div class="badge-check">✓</div>' : '') +
        '</div>' +
        '<div class="label">' + escapeHtml(p.name) + '</div>' +
        '<div class="stopwatch">' + formatMs(benchElapsed(id, now)) + '</div>';
      attachTokenEvents(el, id, 'bench');
      els.bench.appendChild(el);
    });
    applySelectionStyles();
  }

  function updateTimersOnly(){
    var now = Date.now();
    Array.prototype.forEach.call(els.field.querySelectorAll('.field-token'), function(el){
      var id = el.dataset.id;
      var elapsed = fieldElapsed(id, now);
      var timerEl = el.querySelector('.timer');
      var avatarEl = el.querySelector('.avatar');
      timerEl.textContent = formatMs(elapsed);
      var timeUp = elapsed >= state.defaultDurationMs;
      var farOver = timeUp && elapsed >= state.defaultDurationMs * OVERTIME_FACTOR;
      timerEl.classList.toggle('overtime', farOver);
      timerEl.classList.toggle('due', timeUp && !farOver);
      avatarEl.classList.toggle('time-up', timeUp);
      var badge = avatarEl.querySelector('.badge-warning');
      if (timeUp && !badge){
        badge = document.createElement('div');
        badge.className = 'badge-warning';
        badge.textContent = '⇅';
        avatarEl.appendChild(badge);
      } else if (!timeUp && badge){
        badge.remove();
        badge = null;
      }
      if (badge){
        badge.classList.toggle('due', timeUp && !farOver);
        badge.classList.toggle('overtime', farOver);
      }
      if (timeUp && !timeUpNotified[id]){
        timeUpNotified[id] = true;
        playTimeUpBeep();
      }
    });
    Array.prototype.forEach.call(els.bench.querySelectorAll('.bench-token'), function(el){
      var id = el.dataset.id;
      el.querySelector('.stopwatch').textContent = formatMs(benchElapsed(id, now));
    });
    els.matchClock.textContent = formatMs(matchClockDisplayMs(now));
    var countdown = matchCountdownMs(now);
    els.matchCountdown.textContent = formatMs(countdown);
    els.matchCountdown.classList.toggle('overtime', countdown < 0);
    updateSelectionInfo();
  }

  function applySelectionStyles(){
    Array.prototype.forEach.call(document.querySelectorAll('.token'), function(el){
      var isSel = selected && selected.id === el.dataset.id;
      el.classList.toggle('selected', !!isSel);
      el.classList.toggle('suggested-partner', suggestedPartnerId === el.dataset.id);
    });
    updateSelectionInfo();
  }

  // Which player's markup is currently built into #selectionInfo, so
  // updateSelectionInfo (called every 250ms from updateTimersOnly - see
  // the setInterval near init()) only rebuilds the DOM (including the
  // .si-info-btn) when the selection actually changes, not on every tick.
  // Rebuilding via innerHTML every 250ms regardless was tearing down and
  // recreating the "i" button 4x/second, which could delete it out from
  // under an in-progress tap (touchstart on the old node, then the tick
  // fires before touchend/click) and made it feel unreliable to hit -
  // this was the real bug behind that, not just the hit-area size (which
  // also got bigger, see .si-info-btn::before in style.css).
  /** @type {string|null} */
  var selectionInfoRenderedId = null;

  function updateSelectionInfo(){
    if (!selected){
      els.selectionInfo.classList.remove('visible');
      selectionInfoRenderedId = null;
      return;
    }
    var p = playerById(selected.id);
    if (!p){
      els.selectionInfo.classList.remove('visible');
      selectionInfoRenderedId = null;
      return;
    }
    if (selected.id !== selectionInfoRenderedId){
      els.selectionInfo.innerHTML =
        '<div class="si-name-row"><span class="si-name"></span><span class="si-pos-tag"></span></div>' +
        '<button type="button" class="si-info-btn" data-info="playerTime" aria-label="Forklaring">i</button>' +
        '<button type="button" class="si-close-btn" aria-label="Lukk">×</button>' +
        '<div class="si-stats-grid">' +
          '<span class="si-label">Spillertid:</span>' +
          '<div class="si-divider"></div>' +
          '<span class="si-times">T: <span class="si-field-total"></span><span class="si-sep">·</span>K: <span class="si-field-period"></span></span>' +
          '<span class="si-label">Innbyttertid:</span>' +
          '<div class="si-divider"></div>' +
          '<span class="si-times">T: <span class="si-bench-total"></span><span class="si-sep">·</span>K: <span class="si-bench-period"></span></span>' +
        '</div>' +
        '<div class="si-swap-row">' +
          '<button type="button" class="si-swap-btn" aria-label="Bytt">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
              '<path d="M8 17V5M8 5L4.7 8.3M8 5L11.3 8.3" stroke="#32b45a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<path d="M16 7v12M16 19l-3.3-3.3M16 19l3.3-3.3" stroke="#32b45a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>' +
            '<span class="si-swap-label">Bytt</span>' +
          '</button>' +
        '</div>';
      selectionInfoRenderedId = selected.id;
    }
    var now = Date.now();
    els.selectionInfo.querySelector('.si-name').textContent = p.name;
    var posTag = selected.zone === 'field' ? fieldPositionTagFor(selected.id) : null;
    var posTagEl = els.selectionInfo.querySelector('.si-pos-tag');
    posTagEl.textContent = posTag || '';
    posTagEl.hidden = !posTag;
    els.selectionInfo.querySelector('.si-field-total').textContent = formatCumulative(cumulativeFieldMs(selected.id, now));
    els.selectionInfo.querySelector('.si-field-period').textContent = formatCumulative(currentPeriodFieldMs(selected.id, now));
    els.selectionInfo.querySelector('.si-bench-total').textContent = formatCumulative(cumulativeBenchMs(selected.id, now));
    els.selectionInfo.querySelector('.si-bench-period').textContent = formatCumulative(currentPeriodBenchMs(selected.id, now));
    els.selectionInfo.classList.add('visible');
  }

  /** @type {WakeLockSentinel|null} */
  var wakeLock = null;
  function requestWakeLock(){
    if (!('wakeLock' in navigator)) return;
    if (!state || !state.wakeLockEnabled) return;
    navigator.wakeLock.request('screen').then(function(lock){
      wakeLock = lock;
    }).catch(function(){ /* e.g. low-power mode - not critical, ignore */ });
  }

  function ensureAudioUnlocked(){
    if (!audioCtx){
      try { audioCtx = new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)(); }
      catch(e){ audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended'){
      audioCtx.resume().catch(function(){});
    }
  }

  function playTimeUpBeep(){
    if (!audioCtx) return;
    var ctx = audioCtx; // capture non-null locally so the closure below stays typed
    try {
      [0, 0.22].forEach(function(delay){
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        var t0 = ctx.currentTime + delay;
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.22);
      });
    } catch(e){ console.warn('Kunne ikke spille lyd', e); }
  }

  function updatePlayPauseUI(){
    var running = state.globalRunning;
    els.playPauseBtn.classList.toggle('running', running);
    els.playPauseIcon.textContent = running ? '⏸' : '▶';
    els.playPauseText.textContent = running ? 'Pause' : 'Start';
    els.playPauseBtn.setAttribute('aria-label', running ? 'Pause' : 'Start');
  }

  /** @returns {string[]} */
  function multiSelectedOnField(){
    return multiSelected.filter(function(id){ return state.onField.indexOf(id) !== -1; });
  }
  /** @returns {string[]} */
  function multiSelectedOnBench(){
    return multiSelected.filter(function(id){ return state.onBench.indexOf(id) !== -1; });
  }

  function updateMultiSelectUI(){
    els.multiSelectCancelBtn.classList.toggle('visible', multiMode);
    if (!multiMode){
      els.multiSelectBtnLabel.textContent = 'multiBytte';
      els.multiSelectBtn.classList.remove('active','ready');
      return;
    }
    els.multiSelectBtn.classList.add('active');
    if (multiSelected.length === 0){
      els.multiSelectBtnLabel.textContent = 'Avbryt valg';
      els.multiSelectBtn.classList.remove('ready');
      return;
    }
    var fieldN = multiSelectedOnField().length;
    var benchN = multiSelectedOnBench().length;
    if (fieldN === benchN){
      els.multiSelectBtnLabel.textContent = 'Bytt ' + fieldN + ' par →';
      els.multiSelectBtn.classList.add('ready');
    } else {
      els.multiSelectBtnLabel.textContent = fieldN + ' ute · ' + benchN + ' inn';
      els.multiSelectBtn.classList.remove('ready');
    }
  }

  // Bails out of multi-select entirely - clears any marked players and
  // exits the mode in one tap, regardless of how many (if any) are
  // currently marked. The red × below multiBytte drives this; the main
  // button's own "0 selected" tap also reuses it (see onMultiSelectBtnClick).
  function cancelMultiSelect(){
    if (!canEdit()) return;
    multiMode = false;
    multiSelected = [];
    updateMultiSelectUI();
    renderAll();
  }

  // Same 2-tap pattern as multiBytte (see updateMultiSelectUI): 1st "Forslag"
  // tap marks the pair (button turns green, cancel × appears beside it,
  // both tokens highlight via selected/suggestedPartnerId), 2nd tap on the
  // same button performs the swap immediately - no need to also tap the
  // highlighted bench player, though doing so (or tapping any other token)
  // still works via the normal handleTap() flow and disarms this.
  function updateSwapSuggestionUI(){
    els.swapSuggestionCancelBtn.classList.toggle('visible', swapSuggestionArmed);
    els.swapSuggestionBtn.classList.toggle('ready', swapSuggestionArmed);
    els.swapSuggestionBtnLabel.textContent = swapSuggestionArmed ? 'Bytt →' : 'Forslag';
  }

  function cancelSwapSuggestion(){
    if (!swapSuggestionArmed) return;
    selected = null;
    suggestedPartnerId = null;
    swapSuggestionArmed = false;
    applySelectionStyles();
    updateSwapSuggestionUI();
  }

  function onSwapSuggestionBtnClick(){
    if (!canEdit() || multiMode){ shakeElement(els.swapSuggestionBtn); return; }
    if (swapSuggestionArmed){
      var fieldId = selected && selected.id;
      var benchId = suggestedPartnerId;
      selected = null;
      suggestedPartnerId = null;
      swapSuggestionArmed = false;
      updateSwapSuggestionUI();
      if (fieldId && benchId) animateAndPerformSwap(fieldId, benchId);
      else applySelectionStyles();
      return;
    }
    var suggestion = computeSwapSuggestion(Date.now());
    if (!suggestion){ shakeElement(els.swapSuggestionBtn); return; }
    selected = { id: suggestion.fieldId, zone: 'field' };
    suggestedPartnerId = suggestion.benchId;
    swapSuggestionArmed = true;
    applySelectionStyles();
    updateSwapSuggestionUI();
  }

  function onMultiSelectBtnClick(){
    if (!canEdit()) return;
    if (!multiMode){
      multiMode = true;
      multiSelected = [];
      selected = null;
      suggestedPartnerId = null;
      swapSuggestionArmed = false;
      updateMultiSelectUI();
      renderAll();
      return;
    }
    if (multiSelected.length === 0){
      cancelMultiSelect();
      return;
    }
    performMultiSwap();
  }

  function toggleMultiSelect(id){
    var idx = multiSelected.indexOf(id);
    if (idx === -1) multiSelected.push(id); else multiSelected.splice(idx,1);
    updateMultiSelectUI();
    renderAll();
  }

  var multiSwapWarningTimer = /** @type {ReturnType<typeof setTimeout>|undefined} */ (undefined);
  function showMultiSwapWarning(){
    els.multiSwapWarning.textContent = 'Velg like mange innbyttere som utespillere for å bytte dem samtidig.';
    els.multiSwapWarning.classList.add('visible');
    clearTimeout(multiSwapWarningTimer);
    multiSwapWarningTimer = setTimeout(function(){
      els.multiSwapWarning.classList.remove('visible');
    }, 2800);
  }

  // Pairs up the selected utespillere with the selected innbyttere (in
  // selection order - the pairing itself doesn't affect anyone's resulting
  // time, each player's own clock only depends on their own elapsed time)
  // and swaps each pair. Requires equal counts on both sides.
  function performMultiSwap(){
    var fieldSelected = multiSelectedOnField();
    var benchSelected = multiSelectedOnBench();
    if (fieldSelected.length === 0 || fieldSelected.length !== benchSelected.length){
      shakeElement(els.appEl);
      showMultiSwapWarning();
      return;
    }
    pushUndoSnapshot();
    for (var i = 0; i < fieldSelected.length; i++){
      swapFieldAndBench(fieldSelected[i], benchSelected[i]);
    }
    multiMode = false;
    multiSelected = [];
    saveState();
    updateMultiSelectUI();
    renderAll();
  }

  /* ---------------- Tap select / swap ---------------- */

  function handleTap(id, zone){
    // Any real tap - whether it confirms a "Forslag" suggestion or not -
    // drops that highlight before its own logic runs below.
    suggestedPartnerId = null;
    swapSuggestionArmed = false;
    updateSwapSuggestionUI();
    if (!selected){
      selected = {id:id, zone:zone};
      applySelectionStyles();
      return;
    }
    if (selected.id === id){
      selected = null;
      applySelectionStyles();
      return;
    }
    if (selected.zone === zone){
      // Two field taps with positions active trade those two players'
      // positions directly - a genuine mutation, not just a reselect (see
      // performPositionSwap()). Two bench taps (or two field taps without
      // positions, e.g. 3v3) still just reselect - bench has no position
      // concept, and neither does an un-positioned field.
      if (zone === 'field' && fieldHasPositions()){
        var prevSelectedId = selected.id;
        selected = null;
        performPositionSwap(prevSelectedId, id);
        return;
      }
      selected = {id:id, zone:zone};
      applySelectionStyles();
      return;
    }
    var fieldId = zone === 'field' ? id : selected.id;
    var benchId = zone === 'bench' ? id : selected.id;
    performSwap(fieldId, benchId);
    selected = null;
    saveState();
    renderAll();
  }

  // Core swap mutation, no undo snapshot of its own - callers decide the
  // undo granularity (performSwap snapshots once per swap; a multi-swap
  // batch snapshots once for the whole batch, see performMultiSwap).
  /** @param {string} fieldId @param {string} benchId */
  function swapFieldAndBench(fieldId, benchId){
    if (state.onField.indexOf(fieldId) === -1 || state.onBench.indexOf(benchId) === -1){
      return;
    }
    var now = Date.now();
    commitFieldStint(fieldId, now);
    commitBenchStint(benchId, now);
    state.swapCount = (state.swapCount || 0) + 1;

    state.onField = state.onField.filter(function(x){ return x !== fieldId; });
    state.onField.push(benchId);
    state.fieldTimers[benchId] = { baseElapsedMs: 0, sinceTs: now };
    delete state.fieldTimers[fieldId];
    delete timeUpNotified[benchId];

    state.onBench = state.onBench.filter(function(x){ return x !== benchId; });
    state.onBench.push(fieldId);
    state.benchTimers[fieldId] = { baseElapsedMs: 0, sinceTs: now };
    delete state.benchTimers[benchId];
    delete timeUpNotified[fieldId];
  }

  /** @param {string} fieldId @param {string} benchId */
  function performSwap(fieldId, benchId){
    if (state.onField.indexOf(fieldId) === -1 || state.onBench.indexOf(benchId) === -1){
      return;
    }
    pushUndoSnapshot();
    swapFieldAndBench(fieldId, benchId);
  }

  /* ---------------- Drag & drop ---------------- */

  function attachTokenEvents(el, id, zone){
    el.addEventListener('pointerdown', function(e){ onPointerDown(e, id, zone); });
  }

  function onPointerDown(e, id, zone){
    if (!canEdit()) return;
    if (multiMode){
      e.preventDefault();
      toggleMultiSelect(id);
      return;
    }
    e.preventDefault();
    var startX = e.clientX, startY = e.clientY;
    var pointerId = e.pointerId;
    var sourceEl = e.currentTarget;
    var dragging = false;
    var settled = false;
    /** @type {HTMLElement|null} */
    var ghost = null;
    /** @type {HTMLElement|null} */
    var hoverTargetEl = null; // token currently under the cursor that a drop would swap with - see .token.drop-target

    try { sourceEl.setPointerCapture(pointerId); } catch(err){}

    function clearHoverTarget(){
      if (hoverTargetEl){ hoverTargetEl.classList.remove('drop-target'); hoverTargetEl = null; }
    }

    function onMove(ev){
      var dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!dragging && (Math.abs(dx) > 9 || Math.abs(dy) > 9)){
        dragging = true;
        ghost = createGhost(sourceEl);
        document.body.appendChild(ghost);
        sourceEl.classList.add('drag-source-hidden');
      }
      if (dragging && ghost){
        ghost.style.left = ev.clientX + 'px';
        ghost.style.top = (ev.clientY - 36) + 'px';

        var overEl = /** @type {HTMLElement|null} */ (document.elementFromPoint(ev.clientX, ev.clientY));
        var overToken = overEl ? /** @type {HTMLElement|null} */ (overEl.closest('.token')) : null;
        var overId = overToken ? overToken.dataset.id : null;
        var isValidTarget = false;
        if (overToken && overId && overId !== id){
          var overIsField = state.onField.indexOf(overId) !== -1;
          var overIsBench = state.onBench.indexOf(overId) !== -1;
          isValidTarget = (zone === 'field' && overIsBench) || (zone === 'bench' && overIsField) ||
            // field-onto-field only trades positions when this fieldSize
            // actually has fixed positions (see fieldHasPositions()) - a
            // 3v3/4v4 field-on-field drop stays a no-op, same as today.
            (zone === 'field' && overIsField && fieldHasPositions());
        }
        if (isValidTarget && overToken && overToken !== hoverTargetEl){
          clearHoverTarget();
          hoverTargetEl = overToken;
          hoverTargetEl.classList.add('drop-target');
        } else if (!isValidTarget){
          clearHoverTarget();
        }
      }
    }

    function onUp(ev){
      if (settled) return;
      settled = true;
      try { sourceEl.releasePointerCapture(pointerId); } catch(err){}
      sourceEl.removeEventListener('pointermove', onMove);
      sourceEl.removeEventListener('pointerup', onUp);
      sourceEl.removeEventListener('pointercancel', onUp);
      sourceEl.classList.remove('drag-source-hidden');
      clearHoverTarget();

      if (dragging){
        if (ghost) ghost.remove();
        handleDrop(id, zone, ev.clientX, ev.clientY);
      } else {
        handleTap(id, zone);
      }
    }

    sourceEl.addEventListener('pointermove', onMove);
    sourceEl.addEventListener('pointerup', onUp);
    sourceEl.addEventListener('pointercancel', onUp);
  }

  /** @param {HTMLElement} sourceEl @returns {HTMLElement} */
  function createGhost(sourceEl){
    var g = /** @type {HTMLElement} */ (sourceEl.cloneNode(true)); // cloneNode() is typed as Node regardless of the source's own type
    var rect = sourceEl.getBoundingClientRect();
    g.classList.remove('token-enter'); // don't replay the entrance fade on the drag ghost
    g.classList.add('ghost-token');
    g.style.position = 'fixed';
    g.style.left = '0px'; g.style.top = '0px';
    g.style.pointerEvents = 'none';
    g.style.zIndex = '1000';
    g.style.margin = '0';
    g.style.width = rect.width + 'px';
    return g;
  }

  // Quick (0.3s) green pulse on a just-swapped token - the same green
  // used for the drag-over cue, just flashed rather than held - enough to
  // register "something happened here" without a distinct animation
  // language of its own.
  /** @param {HTMLElement|null} el */
  function flashSwapped(el){
    if (!el) return;
    el.classList.remove('swap-flash');
    void el.offsetWidth;
    el.classList.add('swap-flash');
    setTimeout(function(){ el.classList.remove('swap-flash'); }, 300);
  }

  // Swaps fieldId/benchId and flashes both their new tokens once the
  // render settles - simple, minimal feedback in place of a movement
  // animation.
  /** @param {string} fieldId @param {string} benchId */
  function animateAndPerformSwap(fieldId, benchId){
    performSwap(fieldId, benchId);
    saveState();
    renderAll();
    // The field player now lives in the bench list, and vice versa.
    flashSwapped(/** @type {HTMLElement|null} */ (els.bench.querySelector('[data-id="' + fieldId + '"]')));
    flashSwapped(/** @type {HTMLElement|null} */ (els.field.querySelector('[data-id="' + benchId + '"]')));
  }

  /** @param {string} id @param {'field'|'bench'} fromZone @param {number} clientX @param {number} clientY */
  function handleDrop(id, fromZone, clientX, clientY){
    selected = null;
    suggestedPartnerId = null;
    swapSuggestionArmed = false;
    applySelectionStyles();

    // Dropped directly on top of another player -> act on them
    // specifically. field-onto-bench/bench-onto-field swap membership;
    // field-onto-field trades the two positions when this fieldSize has
    // fixed ones (see fieldHasPositions()). Anything else (bench-on-bench,
    // or field-on-field without positions) is invalid - falls through to
    // the reject path below like any other no-op drop.
    var targetEl = /** @type {HTMLElement|null} */ (document.elementFromPoint(clientX, clientY));
    var targetTokenEl = targetEl ? targetEl.closest('.token') : null;
    var targetId = targetTokenEl ? /** @type {HTMLElement} */ (targetTokenEl).dataset.id : null;
    if (targetId && targetId !== id){
      var targetIsField = state.onField.indexOf(targetId) !== -1;
      var targetIsBench = state.onBench.indexOf(targetId) !== -1;
      if (fromZone === 'field' && targetIsBench){
        animateAndPerformSwap(id, targetId);
        return;
      }
      if (fromZone === 'bench' && targetIsField){
        animateAndPerformSwap(targetId, id);
        return;
      }
      if (fromZone === 'field' && targetIsField && fieldHasPositions()){
        performPositionSwap(id, targetId);
        return;
      }
      renderAll();
      flashDropRejected(id, fromZone);
      return;
    }

    var fieldRect = els.fieldWrap.getBoundingClientRect();
    var benchRect = els.benchWrap.getBoundingClientRect();

    var inField = clientX>=fieldRect.left && clientX<=fieldRect.right && clientY>=fieldRect.top && clientY<=fieldRect.bottom;
    var inBench = clientX>=benchRect.left && clientX<=benchRect.right && clientY>=benchRect.top && clientY<=benchRect.bottom;
    var now = Date.now();

    if (inField && fromZone === 'bench'){
      if (state.onBench.indexOf(id) === -1){ renderAll(); return; }
      if (state.onField.length >= (state.fieldSize || 3)){
        renderAll();
        flashDropRejected(id, fromZone);
        return;
      }
      pushUndoSnapshot();
      commitBenchStint(id, now);
      state.onBench = state.onBench.filter(function(x){ return x !== id; });
      state.onField.push(id);
      state.fieldTimers[id] = { baseElapsedMs: 0, sinceTs: now };
      delete state.benchTimers[id];
      delete timeUpNotified[id];
      saveState();
      renderAll();
    } else if (inBench && fromZone === 'field'){
      if (state.onField.indexOf(id) === -1){ renderAll(); return; }
      pushUndoSnapshot();
      commitFieldStint(id, now);
      state.onField = state.onField.filter(function(x){ return x !== id; });
      delete state.fieldTimers[id];
      state.onBench.push(id);
      state.benchTimers[id] = { baseElapsedMs: 0, sinceTs: now };
      delete timeUpNotified[id];
      saveState();
      renderAll();
    } else {
      renderAll();
      flashDropRejected(id, fromZone);
    }
  }

  // Quick shake on the token itself when a drag ends without moving it
  // anywhere (dropped back in the same zone, or outside both) - the state
  // didn't change, so this is the only feedback the drop was a no-op.
  function flashDropRejected(id, fromZone){
    var zoneEl = fromZone === 'field' ? els.field : els.bench;
    var el = zoneEl.querySelector('[data-id="' + id + '"]');
    if (!el) return;
    el.classList.remove('token-enter');
    el.classList.add('drop-rejected');
    setTimeout(function(){ el.classList.remove('drop-rejected'); }, 320);
  }

  /* ---------------- Play / Pause ---------------- */

  // Advances every fieldTimers/benchTimers/matchClock entry up to ts and
  // re-anchors sinceTs there, without touching globalRunning - the shared
  // "freeze the running clocks at a specific instant" step used both by
  // the manual pause (togglePlayPause, at Date.now()) and by
  // checkIdleAutoPause (at the last-known-alive timestamp, so a long gap
  // isn't silently credited as playtime).
  /** @param {number} ts */
  function freezeTimersAt(ts){
    Object.keys(state.fieldTimers).forEach(function(id){
      var t = state.fieldTimers[id];
      t.baseElapsedMs = t.baseElapsedMs + (ts - t.sinceTs);
      t.sinceTs = ts;
    });
    Object.keys(state.benchTimers).forEach(function(id){
      var t = state.benchTimers[id];
      t.baseElapsedMs = t.baseElapsedMs + (ts - t.sinceTs);
      t.sinceTs = ts;
    });
    state.matchClock.baseElapsedMs += (ts - state.matchClock.sinceTs);
    state.matchClock.sinceTs = ts;
  }

  function togglePlayPause(){
    if (!canEdit()) return;
    ensureAudioUnlocked();
    var now = Date.now();
    if (state.globalRunning){
      freezeTimersAt(now);
      state.globalRunning = false;
    } else {
      Object.keys(state.fieldTimers).forEach(function(id){
        state.fieldTimers[id].sinceTs = now;
      });
      Object.keys(state.benchTimers).forEach(function(id){
        state.benchTimers[id].sinceTs = now;
      });
      state.matchClock.sinceTs = now;
      state.globalRunning = true;
    }
    saveState();
    updatePlayPauseUI();
    updateTimersOnly();
  }

  // Timestamp-based clocks (sinceTs/baseElapsedMs) would otherwise silently
  // credit a long background/idle gap as playtime once the app is reopened.
  // A plain (unsynced) heartbeat is stamped to localStorage every 8s
  // (see finishStartup's saveState interval) while the app is alive; if the
  // gap since that heartbeat exceeds IDLE_AUTO_PAUSE_MS, freeze the running
  // clocks at the last known-good instant instead of "now" and pause, with
  // a brief on-screen explanation so the sudden stop isn't a mystery.
  function checkIdleAutoPause(){
    if (!state.globalRunning) return;
    var last = Number(localStorage.getItem(LAST_ALIVE_KEY)) || Date.now();
    var gap = Date.now() - last;
    if (gap > IDLE_AUTO_PAUSE_MS){
      // This device's own heartbeat looks stale - but in a shared session
      // that only proves THIS device was closed, not that the match sat
      // idle: state.lastActivityAt is synced from whichever device last
      // made a real edit (see saveState()), so if it's still fresh, someone
      // else has clearly kept the match going while this device was away.
      // Freezing/pushing a "paused 3 hours ago" correction on top of a
      // match that's actually still live on another screen would wipe out
      // real, current playtime for everyone - so trust the synced state
      // as-is instead of touching it.
      var activityGap = Date.now() - (state.lastActivityAt || 0);
      if (activityGap <= IDLE_AUTO_PAUSE_MS) return;
      freezeTimersAt(last);
      state.globalRunning = false;
      // flushState(), not saveState() - this is a system correction, not a
      // real action by anyone, and checkLongIdleSuggestion() runs right
      // after this at both call sites (see finishStartup()) and needs the
      // TRUE old lastActivityAt gap to still be there. If this stamped it
      // to now, a match left running and forgotten for weeks would auto-
      // pause here and then never trigger the Kampslutt/nullstill prompts,
      // since the very act of auto-pausing would have just "reset the
      // clock" on its own idle check.
      flushState();
      updatePlayPauseUI();
      updateTimersOnly();
      showAutoPauseNotice();
    }
  }

  var autoPauseNoticeTimer = /** @type {ReturnType<typeof setTimeout>|undefined} */ (undefined);
  function showAutoPauseNotice(){
    if (!els.autoPauseNotice) return;
    els.autoPauseNotice.classList.add('show');
    clearTimeout(autoPauseNoticeTimer);
    autoPauseNoticeTimer = setTimeout(function(){
      els.autoPauseNotice.classList.remove('show');
    }, 4000);
  }

  // A quieter cousin of checkIdleAutoPause() above: that one silently
  // freezes a still-"running" clock so idle time isn't credited as
  // playtime. This one asks a real person before doing anything more -
  // ending the current period, or wiping the match entirely - since
  // either is disruptive enough (and hard to fully undo once real play
  // has piled on top) that it shouldn't happen without a tap, even when
  // the signal is strong. Keyed on state.lastActivityAt (synced, stamped
  // on every real mutation - see saveState()) rather than the local-only
  // heartbeat above, so a device that was simply closed for a while never
  // suggests ending/resetting a match someone else kept playing on
  // another device in the meantime - by the time this runs (called from
  // finishStartup(), after any remote fetch has resolved), `state`
  // already reflects the latest activity from every device, not just
  // this one.
  /** @param {'endPeriod'|'reset'} kind @returns {boolean} */
  function isIdleSuggestSnoozed(kind){
    try {
      var t = Number(localStorage.getItem(IDLE_SUGGEST_SNOOZE_KEY_PREFIX + kind));
      return !!t && (Date.now() - t) < IDLE_SUGGEST_SNOOZE_MS;
    } catch(e){ return false; }
  }
  /** @param {'endPeriod'|'reset'} kind */
  function snoozeIdleSuggest(kind){
    try { localStorage.setItem(IDLE_SUGGEST_SNOOZE_KEY_PREFIX + kind, String(Date.now())); } catch(e){}
  }

  var idleSuggestShown = false; // once per page load - reopening the app re-stamps lastActivityAt anyway
  function checkLongIdleSuggestion(){
    if (idleSuggestShown) return;
    if (!canEdit()) return; // nothing a read-only viewer could act on anyway
    if (state.players.length === 0) return; // nothing to end/reset yet
    var gap = Date.now() - (state.lastActivityAt || 0);
    if (gap > IDLE_RESET_SUGGEST_MS){
      if (!isMaster()) return; // only the owner can actually reset a shared session
      if (isIdleSuggestSnoozed('reset')) return;
      idleSuggestShown = true;
      openIdleSuggestModal('reset');
      return;
    }
    var hasElapsedTime = state.globalRunning || matchClockElapsed(Date.now()) > 0;
    if (gap > IDLE_END_PERIOD_SUGGEST_MS && hasElapsedTime){
      if (isIdleSuggestSnoozed('endPeriod')) return;
      idleSuggestShown = true;
      openIdleSuggestModal('endPeriod');
    }
  }

  /** @type {'endPeriod'|'reset'|null} */
  var idleSuggestKind = null;
  /** @param {'endPeriod'|'reset'} kind */
  function openIdleSuggestModal(kind){
    idleSuggestKind = kind;
    if (kind === 'reset'){
      els.idleSuggestText.textContent = 'Det har ikke skjedd noe i denne økten på over 30 timer. Vil du nullstille kampen?';
      els.idleSuggestConfirmBtn.textContent = 'Nullstill';
    } else {
      els.idleSuggestText.textContent = 'Det har ikke skjedd noe i denne økten på over en time. Vil du avslutte perioden (Kampslutt)?';
      els.idleSuggestConfirmBtn.textContent = 'Kampslutt';
    }
    els.idleSuggestModal.classList.add('open');
  }

  // Read-only counterpart to the "joined empty" note inside settings (see
  // joinedEmptyNote) - a view-only participant can't do anything with that
  // note's editable roster form (saveSettings() no-ops for them anyway), so
  // they land on the ordinary (empty) match view instead, with this floating
  // banner explaining why. Longer than the auto-pause notice's 4s since
  // there's more to read and no obvious next action to take.
  var joinedEmptyReadOnlyNoticeTimer = /** @type {ReturnType<typeof setTimeout>|undefined} */ (undefined);
  function showJoinedEmptyReadOnlyNotice(){
    if (!els.joinedEmptyReadOnlyNotice) return;
    els.joinedEmptyReadOnlyNotice.classList.add('show');
    clearTimeout(joinedEmptyReadOnlyNoticeTimer);
    joinedEmptyReadOnlyNoticeTimer = setTimeout(function(){
      els.joinedEmptyReadOnlyNotice.classList.remove('show');
    }, 7000);
  }

  // Shown to whoever just received the økt-eier role via the previous
  // owner's "Overfør økt-eier"-button (see els.transferOwnerBtn) - fires
  // from both the live realtime update and the boot-time rejoin fetch (see
  // isMaster()/wasMaster checks at each call site), so it reaches the new
  // owner whether the app was already open or they're just opening it.
  var ownerTransferredNoticeTimer = /** @type {ReturnType<typeof setTimeout>|undefined} */ (undefined);
  function showOwnerTransferredNotice(){
    if (!els.ownerTransferredNotice) return;
    els.ownerTransferredNotice.classList.add('show');
    clearTimeout(ownerTransferredNoticeTimer);
    ownerTransferredNoticeTimer = setTimeout(function(){
      els.ownerTransferredNotice.classList.remove('show');
    }, 6000);
  }

  /* ---------------- Settings modal ---------------- */

  // Fixed field count, topped up by a manual "+ Legg til spiller" button -
  // deliberately simple instead of the earlier self-managing version (which
  // auto-added a row the moment the second-to-last blank was filled). That
  // auto-add, no matter when it was triggered (on blur, or even on the
  // input event itself), could still land while a tap elsewhere in the
  // modal was in flight and reflow everything below it - including the OK
  // button - out from under the tap. A row count that only ever changes on
  // an explicit, separate button press can't collide with an unrelated tap
  // like that.
  var MIN_NAME_ROWS = 5;

  // Tops up to at least fieldSize+1 rows (a full lineup plus one sub - the
  // practical minimum to run a match) or MIN_NAME_ROWS, whichever is
  // larger. Called on open and (first-run only, before "Antall
  // utespillere" locks) when the field size changes - never from typing or
  // blur, so it can't run mid-click.
  function syncNameRows(){
    var fieldSize = Math.max(1, Math.min(11, parseInt(els.fieldSizeInput.value, 10) || state.fieldSize || 3));
    var floor = Math.max(fieldSize + 1, MIN_NAME_ROWS);
    var rows = Array.prototype.slice.call(els.nameRows.querySelectorAll('.name-row'));
    while (rows.length < floor){
      rows.push(addNameRow(null, '', rows.length + 1));
    }
  }

  // Standard byttetid defaults to ~15% of kampvarighet, rounded up to the
  // nearest whole minute (10 min match -> 2 min, 20 min -> 3 min) - live as
  // "Kampvarighet" is edited. The byttetid fields stay freely editable
  // afterwards, this is just the suggested starting point.
  function applyMatchDurationSuggestion(){
    var mins = Math.max(1, parseInt(els.matchDurationInput.value, 10) || 10);
    els.durMin.value = Math.max(1, Math.ceil(mins * 0.15));
    els.durSec.value = 0;
  }

  /* ---------------- Match duration picker (tap the match clock) ---------------- */

  var durationPickerValue = 20; // live value while the popup is open, minutes

  function setDurationPickerDisplay(mins){
    durationPickerValue = Math.max(1, Math.min(180, mins));
    els.durationPickerValue.textContent = String(durationPickerValue);
  }

  function commitDurationPickerValue(){
    state.matchDurationMs = durationPickerValue * 60000;
    saveState();
    renderAll();
  }

  function openDurationPicker(){
    if (!canEdit()) return;
    setDurationPickerDisplay(Math.max(1, Math.round(state.matchDurationMs / 60000)));
    els.matchDurationPickerModal.classList.add('open');
  }

  // Eased "spin down" for a fast flick - animates from the value the drag
  // ended on to a further value (capped in openDurationPicker's caller),
  // decelerating like a wheel losing momentum, then commits.
  function animateDurationSpin(from, to){
    to = Math.max(1, Math.min(180, to));
    if (to === from){ commitDurationPickerValue(); return; }
    var start = /** @type {number} */ (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var duration = 420;
    function frame(){
      var now = /** @type {number} */ (typeof performance !== 'undefined' ? performance.now() : Date.now());
      var t = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      setDurationPickerDisplay(Math.round(from + (to - from) * eased));
      if (t < 1){
        requestAnimationFrame(frame);
      } else {
        commitDurationPickerValue();
      }
    }
    requestAnimationFrame(frame);
  }

  var DURATION_PX_PER_MIN = 14;

  function initDurationPickerDrag(){
    els.durationPickerWheel.addEventListener('pointerdown', function(e){
      e.preventDefault();
      var startY = e.clientY;
      var startVal = durationPickerValue;
      var pointerId = e.pointerId;
      var lastY = startY;
      var lastT = performance.now();
      var velocity = 0; // minutes-per-ms equivalent, up = positive

      try { els.durationPickerWheel.setPointerCapture(pointerId); } catch(err){}

      function onMove(ev){
        var dy = startY - ev.clientY; // dragging up = positive = increase
        var steps = Math.round(dy / DURATION_PX_PER_MIN);
        setDurationPickerDisplay(startVal + steps);
        var now = performance.now();
        var dt = now - lastT;
        if (dt > 0) velocity = (lastY - ev.clientY) / dt / DURATION_PX_PER_MIN;
        lastY = ev.clientY;
        lastT = now;
      }
      function onUp(){
        els.durationPickerWheel.removeEventListener('pointermove', onMove);
        els.durationPickerWheel.removeEventListener('pointerup', onUp);
        els.durationPickerWheel.removeEventListener('pointercancel', onUp);
        try { els.durationPickerWheel.releasePointerCapture(pointerId); } catch(err){}
        // A careful, slow drag ends with velocity ~0 -> commits exactly
        // where the finger left it. A fast flick keeps "spinning" a bit
        // further, capped at 20 extra minutes either direction.
        var flingSteps = Math.max(-20, Math.min(20, Math.round(velocity * 55)));
        if (Math.abs(flingSteps) >= 2){
          animateDurationSpin(durationPickerValue, durationPickerValue + flingSteps);
        } else {
          commitDurationPickerValue();
        }
      }
      els.durationPickerWheel.addEventListener('pointermove', onMove);
      els.durationPickerWheel.addEventListener('pointerup', onUp);
      els.durationPickerWheel.addEventListener('pointercancel', onUp);
    });
  }

  /** @param {boolean} [isFirstRun] @param {boolean} [joinedEmpty] */
  function openSettings(isFirstRun, joinedEmpty){
    var master = isMaster();
    els.settingsModal.classList.add('open');
    els.cancelBtn.style.display = isFirstRun ? 'none' : '';
    els.settingsCloseBtn.style.display = isFirstRun ? 'none' : '';
    els.joinedEmptyNote.hidden = !joinedEmpty;
    els.masterOnlyNote.hidden = master;
    settingsDirty = false;
    els.nameRows.innerHTML = '';
    els.fieldSizeInput.value = state.fieldSize || 3;

    state.players.forEach(function(p, idx){
      addNameRow(p.id, p.name, idx+1, state.onField.indexOf(p.id) !== -1);
    });
    syncNameRows(); // tops up to fieldSize+1 rows, or MIN_NAME_ROWS, whichever is larger

    els.matchDurationInput.value = Math.round(state.matchDurationMs/60000);
    var totalMs = state.defaultDurationMs;
    els.durMin.value = Math.floor(totalMs/60000);
    els.durSec.value = Math.floor((totalMs%60000)/1000);
    els.matchDurationInput.disabled = !master;
    els.durMin.disabled = !master;
    els.durSec.disabled = !master;
    els.wakeLockToggle.checked = !!state.wakeLockEnabled;
    // Not master-restricted (this really only affects the tapping device's
    // own screen, even though it happens to live in shared state) - but
    // still gated by canEdit(), same as any other shared-state mutation,
    // now that settings is reachable by a genuinely read-only viewer too.
    els.wakeLockToggle.disabled = !canEdit();
    els.shareSessionToggle.checked = !!sessionCode;
    els.shareSessionRow.hidden = !master;
    els.rankCumulativeRow.hidden = !master;
    updateShareModeUI();
    els.rankByCumulativeToggle.checked = !!state.rankByCumulative;
    els.fieldSizeInput.disabled = !isFirstRun || !master;
    els.fieldSizeLockedNote.style.display = (isFirstRun && master) ? 'none' : '';
    // "Bli med i delt økt" only makes sense when this device isn't already
    // in a session - once it is, leaving/closing is "Forlat økt" under
    // "Avslutt" instead, not a re-labelled join button (that used to say
    // "Gå ut av delt økt", which read like it led to starting/continuing
    // something, not just closing the app).
    els.joinExistingBtn.hidden = !!sessionCode;

    transferOwnerConfirm.disarm();
    var transferTarget = master ? longestTenuredOtherParticipant() : null;
    els.transferOwnerRow.hidden = !transferTarget;
    if (transferTarget) els.transferOwnerNote.textContent = 'Til enheten som ' + formatJoinedAgo(transferTarget.joinedAt);
  }

  /** @param {string|null} id @param {string} name @param {number} indexHint @param {boolean} [locked] @param {boolean} [fadeIn] @returns {HTMLElement} */
  function addNameRow(id, name, indexHint, locked, fadeIn){
    // Two independent reasons a row can be locked: on the field right now
    // (locked - everyone, including the master, can't touch it here), or
    // this device just isn't the session master (masterLocked - everyone
    // BUT the master, regardless of field/bench). Same grey styling either
    // way, different tooltip so it's clear which applies.
    var masterLocked = !locked && !isMaster();
    var anyLocked = locked || masterLocked;
    var row = document.createElement('div');
    row.className = 'name-row' + (anyLocked ? ' locked' : '') + (fadeIn ? ' name-row-enter' : '');
    row.dataset.id = id || '';
    // The "x" shows on every editable row, blank or not - not just filled
    // ones - so a spare row added via "+ Legg til spiller" (or any of the
    // fixed starting rows) can always be closed again. There's no minimum
    // enforced here; saveSettings already rejects the form if it ends up
    // with zero named players.
    row.innerHTML =
      '<div class="name-input-wrap">' +
        '<input type="text" value="' + escapeHtml(name||'') + '" placeholder="Spiller ' + indexHint + '" autocomplete="off"' + (anyLocked ? ' disabled' : '') + '>' +
        (anyLocked ? '' :
          '<span class="name-row-clear-divider" aria-hidden="true"></span>' +
          '<button type="button" class="name-row-clear-btn" aria-label="Fjern">×</button>') +
      '</div>' +
      (anyLocked
        ? '<span class="locked-row-note" title="' + (locked ? 'Utespillere kan ikke endres eller fjernes her mens de er på banen' : 'Kun økt-eieren kan endre spillernavn') + '">🔒</span>'
        : '');
    els.nameRows.appendChild(row);
    var wrap = row.querySelector('.name-input-wrap');
    if (anyLocked) return row;
    var input = /** @type {HTMLInputElement} */ (row.querySelector('input'));
    var removeBtn = /** @type {HTMLElement} */ (row.querySelector('.name-row-clear-btn'));
    removeBtn.addEventListener('click', function(){
      row.remove();
      settingsDirty = true;
    });
    input.addEventListener('input', function(){
      clearFieldInvalid(wrap);
    });
    attachSuggestions(input, wrap);
    return row;
  }

  function attachSuggestions(input, wrap){
    var list = document.createElement('div');
    list.className = 'suggest-list hidden';
    wrap.appendChild(list);

    function usedElsewhere(){
      var used = [];
      Array.prototype.forEach.call(els.nameRows.querySelectorAll('.name-row input'), function(inp){
        if (inp !== input){
          var v = inp.value.trim();
          if (v) used.push(v.toLowerCase());
        }
      });
      return used;
    }

    function render(){
      var query = input.value.trim().toLowerCase();
      var used = usedElsewhere();
      var matches = roster.filter(function(name){
        var lower = name.toLowerCase();
        if (used.indexOf(lower) !== -1) return false;
        if (!query) return true;
        return lower.indexOf(query) === 0;
      });
      if (query && matches.length === 0){
        matches = roster.filter(function(name){
          var lower = name.toLowerCase();
          if (used.indexOf(lower) !== -1) return false;
          return lower.indexOf(query) !== -1;
        });
      }
      matches = matches.slice(0, 12);
      if (matches.length === 0){
        list.classList.add('hidden');
        list.innerHTML = '';
        return;
      }
      list.innerHTML = matches.map(function(name){
        return '<div class="suggest-item">' + escapeHtml(name) + '</div>';
      }).join('');
      list.classList.remove('hidden');
    }

    input.addEventListener('focus', render);
    input.addEventListener('input', render);
    input.addEventListener('blur', function(){
      setTimeout(function(){ list.classList.add('hidden'); }, 150);
    });
    // preventDefault on pointerdown only - so tapping an item doesn't blur
    // (and thus close) the input - and do the actual selection on 'click'
    // instead of here. An earlier version did both in pointerdown, hiding
    // the list synchronously; that still left a window for the browser's
    // own trailing click (preventDefault on pointerdown doesn't reliably
    // suppress it) to land on whatever was underneath once the list -
    // which can be tall enough to overlap the next couple of name rows -
    // disappeared, silently stealing focus into the wrong field. Deferring
    // the hide by a tick narrowed that window but didn't close it. Moving
    // the actual work into 'click' closes it for good: the DOM is
    // untouched between pointerdown and click, so click always resolves
    // against the same item that was actually tapped, no race possible.
    list.addEventListener('pointerdown', function(e){
      var item = /** @type {HTMLElement} */ (e.target).closest('.suggest-item');
      if (!item) return;
      e.preventDefault();
    });
    list.addEventListener('click', function(e){
      var item = /** @type {HTMLElement} */ (e.target).closest('.suggest-item');
      if (!item) return;
      input.value = item.textContent;
      // Setting .value directly doesn't fire 'input', so the row's own
      // listener (clearing the invalid badge, showing the "x") never runs
      // for a name picked from this list - dispatch it so picking a
      // suggestion behaves exactly like typing the same name would.
      input.dispatchEvent(new Event('input', { bubbles: true }));
      list.classList.add('hidden');
    });
  }

  // Re-triggers the shake animation on any element (modal-card, a button,
  // etc.) even if it's already mid-animation from a previous attempt.
  function shakeElement(el){
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  // ---------- Myntkast (coin toss) ----------
  // Standalone pre-match helper reachable only from the launcher (see the
  // "Tilgjengelighet" decision) - it never touches match state, so it has
  // its own tiny bit of localStorage-backed state (just the two chosen
  // colors) instead of living in `state`/STORAGE_KEY.
  var COIN_COLORS = [
    { id:'red',    name:'Rød',     hex:'#e6473c' },
    { id:'blue',   name:'Blå',     hex:'#2f6fed' },
    { id:'yellow', name:'Gul',     hex:'#f4c430' },
    { id:'green',  name:'Grønn',   hex:'#3fa34d' },
    { id:'orange', name:'Oransje', hex:'#f2861d' },
    { id:'purple', name:'Lilla',   hex:'#8b4fc9' },
    { id:'pink',   name:'Rosa',    hex:'#f06ea9' },
    { id:'black',  name:'Svart',   hex:'#2b2b2b' },
    { id:'white',  name:'Hvit',    hex:'#f6f6f6' },
    { id:'brown',  name:'Brun',    hex:'#8a5a34' }
  ];
  // My son's team is red, so that's the sensible out-of-the-box default
  // for "Hjemmelag" - see loadCoinFlipColors() for how a saved choice
  // overrides this on later visits.
  var coinHomeColorId = 'red';
  var coinAwayColorId = 'blue';
  var coinFlipInProgress = false;

  /** @param {string} id @returns {{id:string,name:string,hex:string}|null} */
  function coinColorById(id){
    for (var i = 0; i < COIN_COLORS.length; i++){ if (COIN_COLORS[i].id === id) return COIN_COLORS[i]; }
    return null;
  }

  // Flat jersey silhouette (straight lines + one shallow neckline curve)
  // printed in the team's color on top of the coin's gold face.
  function jerseyIconSvg(hex){
    var stroke = (hex === '#f6f6f6') ? 'rgba(0,0,0,.35)' : 'rgba(0,0,0,.22)';
    return '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M12,4 L3,11 L9,15 L9,36 L31,36 L31,15 L37,11 L28,4 Q20,11 12,4 Z" ' +
      'fill="' + hex + '" stroke="' + stroke + '" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  }

  // Launcher-tile icon only: a coin (rim ring, like an embossed face) with
  // two curved motion arcs swooshing around it to signal "this spins" -
  // distinct from jerseyIconSvg, which is what the coin's FACES show once
  // it lands on a team's color.
  function coinSpinIconSvg(hex){
    var stroke = 'rgba(0,0,0,.25)';
    return '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M6,15 A16,16 0 0,1 15,6" fill="none" stroke="' + hex + '" stroke-width="2.2" stroke-linecap="round" opacity=".6"/>' +
      '<path d="M34,25 A16,16 0 0,1 25,34" fill="none" stroke="' + hex + '" stroke-width="2.2" stroke-linecap="round" opacity=".6"/>' +
      '<circle cx="20" cy="20" r="11" fill="' + hex + '" stroke="' + stroke + '" stroke-width="1.6"/>' +
      '<circle cx="20" cy="20" r="7" fill="none" stroke="' + stroke + '" stroke-width="1.2" opacity=".6"/></svg>';
  }

  function loadCoinFlipColors(){
    try {
      var raw = localStorage.getItem(COINFLIP_COLORS_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved && coinColorById(saved.home)) coinHomeColorId = saved.home;
      if (saved && coinColorById(saved.away)) coinAwayColorId = saved.away;
    } catch(e){}
  }

  function saveCoinFlipColors(){
    try { localStorage.setItem(COINFLIP_COLORS_KEY, JSON.stringify({ home:coinHomeColorId, away:coinAwayColorId })); }
    catch(e){}
  }

  function buildCoinColorGrid(container, teamKey){
    container.innerHTML = '';
    COIN_COLORS.forEach(function(c){
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'coin-swatch';
      btn.dataset.color = c.id;
      btn.style.background = c.hex;
      btn.setAttribute('aria-label', c.name);
      btn.addEventListener('click', function(){
        if (teamKey === 'home') coinHomeColorId = c.id; else coinAwayColorId = c.id;
        els.coinColorError.hidden = true;
        refreshCoinColorGrids();
      });
      container.appendChild(btn);
    });
  }

  function refreshCoinColorGrids(){
    Array.prototype.forEach.call(els.coinHomeColorGrid.children, function(btn){
      btn.classList.toggle('selected', btn.dataset.color === coinHomeColorId);
    });
    Array.prototype.forEach.call(els.coinAwayColorGrid.children, function(btn){
      btn.classList.toggle('selected', btn.dataset.color === coinAwayColorId);
    });
  }

  // ---------------- "Mitt lag" (account) + Innstillinger ----------------
  // Shares the exact same sb.auth session as Historikk-login (see
  // isHistoryAdmin's comment above) - logging in here really does
  // authenticate against Supabase now, backed by the team_settings table.
  // Local cache (loadCoachDefaults/saveCoachDefaults) stays the source of
  // truth while signed out, and is what an account's own values get mirrored
  // into on login, so the rest of the app never has to care which mode it's
  // reading from.
  function updateSettingsStorageNote(){
    if (!els.settingsStorageNote) return;
    els.settingsStorageNote.textContent = isTeamAccountSignedIn()
      ? 'Lagres på kontoen din, og er der igjen neste gang du logger inn - på denne eller en annen enhet.'
      : 'Lagres på denne enheten. Logg inn med «Mitt lag» for å ta innstillingene med deg overalt.';
    els.settingsLogoutBtn.hidden = !isTeamAccountSignedIn();
  }
  function openAccountLoginModal(){
    els.accountLoginEmail.value = '';
    els.accountLoginPassword.value = '';
    els.accountLoginNote.style.display = 'none';
    els.accountLoginModal.classList.add('open');
  }
  function closeAccountLoginModal(){
    els.accountLoginModal.classList.remove('open');
  }
  function openRegisterScreen(){
    els.registerTeamName.value = '';
    els.registerEmail.value = '';
    els.registerPassword.value = '';
    els.registerPasswordRepeat.value = '';
    els.registerNote.style.display = 'none';
    els.registerScreen.classList.add('open');
  }
  function closeRegisterScreen(){
    els.registerScreen.classList.remove('open');
  }

  function updateSettingsStepperUI(){
    els.settingsMatchDurationValue.textContent = settingsDraftMatchDurationMin + ' min';
    els.settingsSwapDurationValue.textContent = settingsDraftSwapDurationMin + ' min';
    Array.prototype.forEach.call(els.settingsFieldFormat.children, function(btn){
      btn.classList.toggle('active', parseInt(btn.dataset.size, 10) === settingsDraftFieldSize);
    });
  }
  /** @param {string} [prefillTeamName] */
  function openSettingsScreen(prefillTeamName){
    var d = loadCoachDefaults();
    els.settingsHomeName.value = prefillTeamName || d.homeTeamName;
    els.settingsHomeAbbr.value = d.homeTeamAbbr;
    settingsDraftMatchDurationMin = Math.max(1, Math.round(d.matchDurationMs / 60000));
    settingsDraftSwapDurationMin = Math.max(1, Math.round(d.defaultDurationMs / 60000));
    // Kampformat is a coarse 4-option preset (see .settings-field-col in
    // index.html) - the real fieldSize can be any 1-11 via the in-app
    // innstillingsvindu's own number input, so an odd saved value (e.g. 4)
    // just lands on the nearest preset here rather than matching none.
    var presets = [3, 5, 7, 11];
    settingsDraftFieldSize = presets.indexOf(d.fieldSize) !== -1 ? d.fieldSize : presets.reduce(function(a,b){
      return Math.abs(b - d.fieldSize) < Math.abs(a - d.fieldSize) ? b : a;
    });
    updateSettingsStepperUI();
    els.settingsDefaultRankCumulative.checked = d.rankByCumulative;
    els.settingsDefaultReorgLastMatch.checked = d.reorgUsesLastMatch;
    els.settingsSavedNote.hidden = true;
    updateSettingsStorageNote();
    els.settingsScreen.classList.add('open');
  }
  function closeSettingsScreen(){
    els.settingsScreen.classList.remove('open');
  }
  function saveSettingsScreen(){
    var name = els.settingsHomeName.value.trim() || 'Nøtterøy';
    var abbr = (els.settingsHomeAbbr.value.trim() || 'NØT').toUpperCase();
    /** @type {CoachDefaults} */
    var defaults = {
      homeTeamName: name,
      homeTeamAbbr: abbr,
      matchDurationMs: settingsDraftMatchDurationMin * 60000,
      defaultDurationMs: settingsDraftSwapDurationMin * 60000,
      fieldSize: settingsDraftFieldSize,
      rankByCumulative: els.settingsDefaultRankCumulative.checked,
      reorgUsesLastMatch: els.settingsDefaultReorgLastMatch.checked
    };
    // Local cache always gets written, signed in or not - see this
    // function's own doc comment above initAccountAndSettings.
    saveCoachDefaults(defaults);
    els.settingsSavedNote.hidden = false;
    if (isTeamAccountSignedIn()){
      upsertTeamSettings(adminUser.id, defaults).then(function(ok){
        if (!ok) els.settingsSavedNote.textContent = 'Lagret lokalt, men kontoen kunne ikke oppdateres akkurat nå.';
        else els.settingsSavedNote.textContent = 'Lagret ✓';
      });
    }
  }

  function initAccountAndSettings(){
    var startupDefaults = loadCoachDefaults();
    applyHomeTeamName(startupDefaults.homeTeamName, startupDefaults.homeTeamAbbr);

    els.accountBtn.addEventListener('click', function(){
      // Signed in already - the login form has nothing to offer, the
      // account's own state (and "Logg ut") lives in Innstillinger.
      if (isTeamAccountSignedIn()) openSettingsScreen();
      else openAccountLoginModal();
    });
    els.accountLoginCloseBtn.addEventListener('click', closeAccountLoginModal);
    els.accountGoRegisterLink.addEventListener('click', function(){
      closeAccountLoginModal();
      openRegisterScreen();
    });
    els.accountLoginBtn.addEventListener('click', function(){
      var email = els.accountLoginEmail.value.trim();
      var password = els.accountLoginPassword.value;
      if (!email || !password){
        els.accountLoginNote.textContent = 'Fyll ut e-post og passord.';
        els.accountLoginNote.style.display = '';
        return;
      }
      if (!sb){
        els.accountLoginNote.textContent = 'Ingen tilkobling til databasen akkurat nå.';
        els.accountLoginNote.style.display = '';
        return;
      }
      els.accountLoginBtn.disabled = true;
      sb.auth.signInWithPassword({ email: email, password: password }).then(function(res){
        els.accountLoginBtn.disabled = false;
        if (res.error){
          els.accountLoginNote.textContent = 'Feil e-post eller passord.';
          els.accountLoginNote.style.display = '';
          return;
        }
        // onAuthStateChange (below) sets adminUser and pulls team_settings -
        // just wait for that same event rather than duplicating the fetch.
        // By the time this .then() runs, onAuthStateChange has already
        // fired (supabase-js updates its internal session and notifies
        // listeners before resolving signInWithPassword's own promise), so
        // isTeamAccountSignedIn() inside openSettingsScreen() already sees
        // the signed-in state - no race with the note it renders.
        closeAccountLoginModal();
        openSettingsScreen();
      });
    });

    els.registerCloseBtn.addEventListener('click', closeRegisterScreen);
    els.registerGoLoginLink.addEventListener('click', function(){
      closeRegisterScreen();
      openAccountLoginModal();
    });
    els.registerSubmitBtn.addEventListener('click', function(){
      var teamName = els.registerTeamName.value.trim();
      var email = els.registerEmail.value.trim();
      var password = els.registerPassword.value;
      var repeat = els.registerPasswordRepeat.value;
      if (!teamName || !email || !password){
        els.registerNote.textContent = 'Fyll ut lagnavn, e-post og passord.';
        els.registerNote.style.display = '';
        return;
      }
      if (password !== repeat){
        els.registerNote.textContent = 'Passordene er ikke like.';
        els.registerNote.style.display = '';
        return;
      }
      if (!sb){
        els.registerNote.textContent = 'Ingen tilkobling til databasen akkurat nå.';
        els.registerNote.style.display = '';
        return;
      }
      els.registerSubmitBtn.disabled = true;
      sb.auth.signUp({ email: email, password: password }).then(function(res){
        els.registerSubmitBtn.disabled = false;
        if (res.error){
          // Supabase's own messages are specific enough to be worth
          // showing (wrong email format, too-short password, rate limit) -
          // a single generic fallback for all of them tested badly against
          // the real API's actual error set (see the conversation this
          // shipped from: caught by really calling signUp, not by reading
          // the code). Login's own error stays deliberately generic
          // ("feil e-post eller passord") for the usual reason - it
          // shouldn't confirm whether an email exists - but there's no such
          // concern here.
          var code = res.error.code;
          var msg;
          if (code === 'user_already_exists') msg = 'Det finnes allerede en konto med denne e-posten.';
          else if (code === 'email_address_invalid') msg = 'Dette ser ikke ut som en gyldig e-postadresse.';
          else if (code === 'weak_password') msg = 'Passordet er for svakt: ' + (res.error.message || '');
          else if (code === 'over_email_send_rate_limit') msg = 'For mange forsøk på kort tid. Vent litt og prøv igjen.';
          else msg = 'Kunne ikke opprette bruker akkurat nå.';
          els.registerNote.textContent = msg;
          els.registerNote.style.display = '';
          return;
        }
        var user = res.data && res.data.user;
        var session = res.data && res.data.session;
        // No session back means the project requires e-post-bekreftelse
        // first (a Supabase project setting, not something this app
        // controls) - can't create the team_settings row yet since RLS
        // requires auth.uid(), so this waits for a real login afterwards.
        if (!session || !user){
          els.registerNote.textContent = 'Sjekk e-posten din for å bekrefte kontoen, og logg inn etterpå.';
          els.registerNote.style.display = '';
          return;
        }
        var defaults = loadCoachDefaults();
        defaults.homeTeamName = teamName;
        upsertTeamSettings(user.id, defaults).then(function(){
          saveCoachDefaults(defaults);
          closeRegisterScreen();
          openSettingsScreen();
        });
      });
    });

    els.settingsTile.addEventListener('click', function(){ openSettingsScreen(); });
    els.settingsScreenCloseBtn.addEventListener('click', closeSettingsScreen);
    els.settingsSaveBtn.addEventListener('click', saveSettingsScreen);
    els.settingsLogoutBtn.addEventListener('click', function(){
      if (sb) sb.auth.signOut();
      // adminUser/local defaults stay as-is until onAuthStateChange fires -
      // signing out doesn't erase the local cache, it just stops updating it.
      updateSettingsStorageNote();
    });
    els.settingsMatchDurationMinus.addEventListener('click', function(){
      settingsDraftMatchDurationMin = Math.max(1, settingsDraftMatchDurationMin - 1);
      updateSettingsStepperUI();
    });
    els.settingsMatchDurationPlus.addEventListener('click', function(){
      settingsDraftMatchDurationMin = Math.min(180, settingsDraftMatchDurationMin + 1);
      updateSettingsStepperUI();
    });
    els.settingsSwapDurationMinus.addEventListener('click', function(){
      settingsDraftSwapDurationMin = Math.max(1, settingsDraftSwapDurationMin - 1);
      updateSettingsStepperUI();
    });
    els.settingsSwapDurationPlus.addEventListener('click', function(){
      settingsDraftSwapDurationMin = Math.min(30, settingsDraftSwapDurationMin + 1);
      updateSettingsStepperUI();
    });
    Array.prototype.forEach.call(els.settingsFieldFormat.children, function(btn){
      btn.addEventListener('click', function(){
        settingsDraftFieldSize = parseInt(btn.dataset.size, 10);
        updateSettingsStepperUI();
      });
    });
  }

  function openCoinFlip(){
    loadCoinFlipColors();
    refreshCoinColorGrids();
    els.coinPanelPick.hidden = false;
    els.coinPanelFlip.hidden = true;
    els.coinPanelResult.hidden = true;
    els.coinColorError.hidden = true;
    els.coinFlipScreen.classList.add('open');
  }

  function closeCoinFlip(){
    els.coinFlipScreen.classList.remove('open');
  }

  function startCoinFlip(){
    if (coinFlipInProgress) return;
    if (coinHomeColorId === coinAwayColorId){
      els.coinColorError.hidden = false;
      shakeElement(els.coinPanelPick);
      return;
    }
    var homeColor = coinColorById(coinHomeColorId);
    var awayColor = coinColorById(coinAwayColorId);
    if (!homeColor || !awayColor) return;
    saveCoinFlipColors();
    els.coinFaceFront.innerHTML = jerseyIconSvg(homeColor.hex);
    els.coinFaceBack.innerHTML = jerseyIconSvg(awayColor.hex);
    els.coinPanelPick.hidden = true;
    els.coinPanelResult.hidden = true;
    els.coinPanelFlip.hidden = false;
    runCoinFlip();
  }

  function runCoinFlip(){
    coinFlipInProgress = true;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var winner = Math.random() < 0.5 ? 'home' : 'away';
    var duration = reduced ? 500 : 3000;

    els.coinArc.classList.remove('flying');
    els.coin.style.transition = 'none';
    els.coin.style.transform = 'rotateY(0deg)';
    void els.coin.offsetWidth; // restart the transition cleanly on repeat flips

    els.coin.style.transition = 'transform ' + duration + 'ms cubic-bezier(.18,.82,.18,1)';
    if (!reduced) els.coinArc.classList.add('flying');
    var spins = 6;
    var targetDeg = spins * 360 + (winner === 'away' ? 180 : 0);
    requestAnimationFrame(function(){
      els.coin.style.transform = 'rotateY(' + targetDeg + 'deg)';
    });

    setTimeout(function(){
      coinFlipInProgress = false;
      showCoinResult(winner);
    }, duration + 60);
  }

  function showCoinResult(winner){
    var color = coinColorById(winner === 'home' ? coinHomeColorId : coinAwayColorId);
    if (!color) return;
    els.coinResultBadge.innerHTML = jerseyIconSvg(color.hex);
    els.coinResultText.textContent = (winner === 'home' ? 'Hjemmelaget' : 'Bortelaget') +
      ' (' + color.name.toLowerCase() + ') starter med ballen!';
    els.coinPanelFlip.hidden = true;
    els.coinPanelResult.hidden = false;
  }

  function initCoinFlip(){
    els.coinTileArt.innerHTML = coinSpinIconSvg('#fff8ea');
    buildCoinColorGrid(els.coinHomeColorGrid, 'home');
    buildCoinColorGrid(els.coinAwayColorGrid, 'away');
    loadCoinFlipColors();
    refreshCoinColorGrids();
    updateHistoryTileVisibility(); // reflects whatever onAuthStateChange has restored by now, or hidden by default before it fires

    els.coinTile.addEventListener('click', openCoinFlip);
    els.coinFlipCloseBtn.addEventListener('click', closeCoinFlip);
    // The tile itself only exists in the DOM for a signed-in account now
    // (see updateHistoryTileVisibility()) - openHistoryScreen() adapts its
    // own rendering for admin vs. a regular signed-in visitor, so there's
    // nothing left to branch on here. openHistoryLoginModal() stays as a
    // defensive fallback only - practically unreachable through this tile.
    els.historyTile.addEventListener('click', function(){
      if (isTeamAccountSignedIn()) openHistoryScreen();
      else openHistoryLoginModal();
    });
    els.historyCloseBtn.addEventListener('click', function(){ els.historyScreen.classList.remove('open'); });
    els.historySelectModeBtn.addEventListener('click', function(){
      historySelectMode = !historySelectMode;
      historySelected = {};
      historyExpandedId = null;
      els.historySelectModeBtn.textContent = historySelectMode ? 'Ferdig' : 'Velg flere';
      els.historySelectModeBtn.classList.toggle('active', historySelectMode);
      renderHistoryList();
    });
    els.historySelectAllBtn.addEventListener('click', function(){
      var list = historyListCache;
      var allSelected = list.length > 0 && list.every(function(m){ return historySelected[m.id]; });
      historySelected = {};
      if (!allSelected) list.forEach(function(m){ historySelected[m.id] = true; });
      renderHistoryList();
    });
    els.historyDeleteSelectedBtn.addEventListener('click', function(){
      var ids = Object.keys(historySelected).filter(function(id){ return historySelected[id]; });
      if (ids.length === 0) return;
      pendingHistoryDeleteIds = ids;
      els.historyDeleteConfirmText.textContent = ids.length === 1
        ? 'Slette denne kampen? Dette kan ikke angres.'
        : 'Slette ' + ids.length + ' kamper? Dette kan ikke angres.';
      els.historyDeleteConfirmModal.classList.add('open');
    });
    els.historyDeleteCancelBtn.addEventListener('click', function(){
      els.historyDeleteConfirmModal.classList.remove('open');
      pendingHistoryDeleteIds = null;
    });
    els.historyDeleteConfirmBtn.addEventListener('click', function(){
      els.historyDeleteConfirmModal.classList.remove('open');
      var ids = pendingHistoryDeleteIds;
      pendingHistoryDeleteIds = null;
      if (!ids) return;
      var idsToDelete = ids;
      deleteHistoryEntries(idsToDelete).then(function(ok){
        if (ok){
          var idSet = {};
          idsToDelete.forEach(function(id){ idSet[id] = true; });
          historyListCache = historyListCache.filter(function(m){ return !idSet[m.id]; });
        }
        historySelectMode = false;
        els.historySelectModeBtn.textContent = 'Velg flere';
        els.historySelectModeBtn.classList.remove('active');
        renderHistoryList();
      });
    });
    // Admin login popup - only an account listed in Supabase's admins
    // table can actually read/delete match_history (enforced by row-level
    // security, not this form) - a wrong password just comes back as a
    // normal Supabase auth error, same as any other login form.
    els.historyLoginCloseBtn.addEventListener('click', closeHistoryLoginModal);
    els.historyLoginBtn.addEventListener('click', attemptHistoryLogin);
    var historyLoginEnterHandler = function(e){ if (e.key === 'Enter') attemptHistoryLogin(); };
    els.historyLoginEmail.addEventListener('keydown', historyLoginEnterHandler);
    els.historyLoginPassword.addEventListener('keydown', historyLoginEnterHandler);
    els.historyLogoutBtn.addEventListener('click', function(){
      if (sb) sb.auth.signOut();
      // onAuthStateChange above closes historyScreen and flips the badge.
    });
    els.coinFlipStartBtn.addEventListener('click', startCoinFlip);
    els.coinFlipAgainBtn.addEventListener('click', function(){
      els.coinPanelResult.hidden = true;
      els.coinPanelFlip.hidden = false;
      runCoinFlip();
    });
    els.coinFlipDoneBtn.addEventListener('click', closeCoinFlip);
  }

  // Small red "!" pinned to a field that's blocking progress - pairs with
  // shakeElement() on the surrounding card so there's always a visible
  // reason, not just a rejected/shaking screen. wrapEl must already be
  // position:relative (see .field-invalid-wrap / .name-input-wrap).
  function markFieldInvalid(wrapEl){
    if (!wrapEl || wrapEl.querySelector('.field-invalid-badge')) return;
    var badge = document.createElement('span');
    badge.className = 'field-invalid-badge';
    badge.textContent = '!';
    wrapEl.appendChild(badge);
  }
  function clearFieldInvalid(wrapEl){
    if (!wrapEl) return;
    var badge = wrapEl.querySelector('.field-invalid-badge');
    if (badge) badge.remove();
  }

  function saveSettings(){
    if (!isMaster()){
      // Every field a non-master could change here is already disabled, so
      // there's nothing to persist - just let OK close the modal like the
      // × button would, instead of leaving it stuck open.
      els.settingsModal.classList.remove('open');
      return;
    }
    var wasEmpty = state.players.length === 0; // see the openOpponentModal() call below
    var rows = Array.prototype.slice.call(els.nameRows.querySelectorAll('.name-row'));
    var newPlayers = [];
    var keptIds = {};

    rows.forEach(function(row){
      var wrap = row.querySelector('.name-input-wrap');
      clearFieldInvalid(wrap);
      var input = row.querySelector('input');
      var name = input.value.trim();
      if (!name) return;
      var id = row.dataset.id;
      if (!id){ id = uid(); }
      newPlayers.push({id:id, name:name});
      keptIds[id] = true;
    });

    if (newPlayers.length === 0){
      shakeElement(els.settingsModal.querySelector('.modal-card'));
      rows.forEach(function(row){ markFieldInvalid(row.querySelector('.name-input-wrap')); });
      return;
    }

    state.players.forEach(function(p){
      if (!keptIds[p.id]){
        state.onField = state.onField.filter(function(x){ return x !== p.id; });
        delete state.fieldTimers[p.id];
        delete state.benchTimers[p.id];
        delete state.cumulative[p.id];
        state.onBench = state.onBench.filter(function(x){ return x !== p.id; });
      }
    });

    var oldIds = {};
    state.players.forEach(function(p){ oldIds[p.id] = true; });
    newPlayers.forEach(function(p){
      if (!oldIds[p.id]){
        state.onBench.push(p.id);
        state.benchTimers[p.id] = { baseElapsedMs: 0, sinceTs: Date.now() };
      }
    });

    state.players = newPlayers;
    addNamesToRoster(newPlayers.map(function(p){ return p.name; }));

    var matchMin = Math.max(1, parseInt(els.matchDurationInput.value,10) || Math.round(state.matchDurationMs/60000) || 10);
    state.matchDurationMs = matchMin * 60000;

    var min = Math.max(0, parseInt(els.durMin.value,10) || 0);
    var sec = Math.max(0, Math.min(59, parseInt(els.durSec.value,10) || 0));
    var newDur = (min*60 + sec) * 1000;
    if (newDur > 0) state.defaultDurationMs = newDur;
    state.fieldSize = Math.max(1, Math.min(11, parseInt(els.fieldSizeInput.value,10) || state.fieldSize || 3));

    saveState();
    els.settingsModal.classList.remove('open');
    renderAll();
    // Roster just went from nothing to a real team - "rett før man kommer
    // inn i kampen, før jeg flytter spillere inn på banen" is exactly this
    // moment, so this is where the (skippable) opponent prompt belongs, not
    // tucked away in settings itself.
    if (wasEmpty) openOpponentModal();
  }

  function buildExportText(){
    var now = Date.now();
    var rows = state.players.map(function(p){
      return {
        name: p.name,
        fieldMs: cumulativeFieldMs(p.id, now),
        benchMs: cumulativeBenchMs(p.id, now)
      };
    });
    rows.sort(function(a,b){ return b.fieldMs - a.fieldMs; });
    var lines = ['Trenerappen – eksport ' + new Date().toLocaleString('nb-NO')];
    lines.push('');
    lines.push('Kumulert spilletid (siden siste nullstilling):');
    rows.forEach(function(r){
      lines.push(r.name + ': ' + formatCumulative(r.fieldMs) + ' spilt, ' + formatCumulative(r.benchMs) + ' benk');
    });

    // Per-match breakdown - opponent, resultat, hvert mål med tidspunkt og
    // scorer, og spilletid per spiller den kampen (see state.matchHistory,
    // archived by endMatchPeriod). Kronologisk, eldste først, samme
    // rekkefølge kampene faktisk ble spilt i.
    var history = state.matchHistory || [];
    if (history.length > 0){
      lines.push('');
      lines.push('Kamper spilt denne økten:');
      history.forEach(function(m, i){
        var opponent = m.opponentName || m.opponentAbbr || 'ukjent motstander';
        lines.push('');
        lines.push((i + 1) + '. ' + new Date(m.endedAt).toLocaleString('nb-NO') + ' - mot ' + opponent + ' (' + m.homeScore + '-' + m.awayScore + ')');
        var goals = m.goals || [];
        if (goals.length > 0){
          lines.push('   Mål: ' + goals.map(function(g){ return formatMs(g.matchMs) + ' ' + g.playerName; }).join(', '));
        }
        var nameById = {};
        state.players.forEach(function(p){ nameById[p.id] = p.name; });
        var playerMsRows = Object.keys(m.playerMs || {})
          .map(function(id){ return { name: nameById[id] || '(fjernet spiller)', ms: m.playerMs[id] }; })
          .sort(function(a, b){ return b.ms - a.ms; });
        if (playerMsRows.length > 0){
          lines.push('   Spilletid: ' + playerMsRows.map(function(r){ return r.name + ' ' + formatCumulative(r.ms); }).join(', '));
        }
      });
    }
    return lines.join('\n');
  }


  function renderEndMatchSummary(){
    var now = Date.now();
    var goalBadges = computeGoalBadges();
    var rows = state.players.map(function(p){
      return {
        id: p.id,
        name: p.name,
        fieldMs: cumulativeFieldMs(p.id, now),
        benchMs: cumulativeBenchMs(p.id, now),
        goals: goalBadges.counts[p.id] || 0
      };
    });
    rows.sort(function(a,b){ return b.fieldMs - a.fieldMs; });
    if (rows.length === 0){
      els.endMatchSummary.innerHTML = '';
      return;
    }
    els.endMatchSummary.innerHTML = rows.map(function(r){
      return '<div class="ems-row">' +
        '<span class="ems-name-wrap">' +
          '<span class="ems-name">' + escapeHtml(r.name) + (r.goals > 0 ? ' (' + r.goals + ' mål)' : '') + '</span>' +
          (r.goals > 0
            ? '<button type="button" class="goal-time-btn" data-id="' + r.id + '" aria-label="Vis måltidspunkt for ' + escapeHtml(r.name) + '">🕐</button>'
            : '') +
        '</span>' +
        '<span class="ems-time">spilt: ' + formatCumulative(r.fieldMs) + ' - benk: ' + formatCumulative(r.benchMs) + '</span>' +
      '</div>';
    }).join('');
    Array.prototype.forEach.call(els.endMatchSummary.querySelectorAll('.goal-time-btn'), function(btn){
      btn.addEventListener('click', function(){ openGoalTimesModal(btn.getAttribute('data-id')); });
    });
  }

  // "Hvilke motstandere har vi spilt mot, og hva ble stillingen" (see
  // state.matchHistory, archived in endMatchPeriod) - most recent match
  // first, each with its own players-by-playtime breakdown so a cup day's
  // several matches stay readable separately, distinct from the running
  // cross-match totals in .end-match-summary below this in the same modal.
  // A player who has since been removed from the roster still shows (by
  // whatever name they had then) rather than silently vanishing from a
  // match they actually played in.
  function renderMatchHistorySummary(){
    if (!els.matchHistorySummary) return;
    var history = state.matchHistory || [];
    if (history.length === 0){
      els.matchHistorySummary.innerHTML = '';
      return;
    }
    var nameById = {};
    state.players.forEach(function(p){ nameById[p.id] = p.name; });
    var entries = history.slice().reverse();
    els.matchHistorySummary.innerHTML = entries.map(function(m){
      var opponent = m.opponentName || (m.opponentAbbr ? m.opponentAbbr : 'Ukjent motstander');
      var playerRows = Object.keys(m.playerMs || {})
        .map(function(id){ return { id: id, name: nameById[id] || '(fjernet spiller)', ms: m.playerMs[id] }; })
        .sort(function(a,b){ return b.ms - a.ms; })
        .map(function(r){
          return '<div class="mh-player-row">' +
            '<span class="mh-player-name">' + escapeHtml(r.name) + '</span>' +
            '<span class="mh-player-time">' + formatCumulative(r.ms) + '</span>' +
          '</div>';
        }).join('');
      return '<div class="mh-match">' +
        '<div class="mh-header">' +
          '<span>vs ' + escapeHtml(opponent) + '</span>' +
          '<span class="mh-score">' + m.homeScore + ' - ' + m.awayScore + '</span>' +
        '</div>' +
        '<div class="mh-players">' + playerRows + '</div>' +
      '</div>';
    }).join('');
  }

  // Shared by endMatchPeriod (Kampslutt) and archiveInProgressMatch
  // (Avslutt/Ny økt) - score and per-player time for the match/period still
  // in progress right now. Read before anything about to wipe/advance the
  // period's baseline runs, so it's each player's time in THIS match
  // specifically, not the running lifetime total.
  function computeMatchScoreAndPlayerMs(now){
    var homeScore = state.goalLog.filter(function(g){ return g.team === 'home'; }).length;
    var awayScore = state.goalLog.filter(function(g){ return g.team === 'away'; }).length;
    var playerMs = {};
    state.players.forEach(function(p){ playerMs[p.id] = currentPeriodFieldMs(p.id, now); });
    return { homeScore: homeScore, awayScore: awayScore, playerMs: playerMs };
  }

  // The shared archive entry (see saveMatchToHistory()) for the "Historikk"
  // tile - snapshots player NAMES (not just ids) so old entries stay
  // meaningful even after a player is later removed from the roster.
  function buildHistoryArchiveEntry(now, calc){
    var nameById = {};
    state.players.forEach(function(p){ nameById[p.id] = p.name; });
    var opponentLabel = state.opponentName || (state.opponentAbbr ? state.opponentAbbr : 'Motstander');
    return {
      id: uid(),
      endedAt: now,
      opponentName: state.opponentName || '',
      opponentAbbr: state.opponentAbbr || '',
      homeScore: calc.homeScore,
      awayScore: calc.awayScore,
      players: state.players.map(function(p){
        return {
          id: p.id,
          name: p.name,
          ms: calc.playerMs[p.id] || 0,
          // Lifetime total (T), alongside ms above (K) - local-only like
          // swapCount/durationMs below, only for the "Kampresultat" popup's
          // own K/T columns, never sent to Supabase.
          totalMs: cumulativeFieldMs(p.id, now),
          goals: state.goalLog.filter(function(g){ return g.team === 'home' && g.playerId === p.id; }).length
        };
      }),
      // Chronological goal timeline - home goals keep the scorer's name
      // (playerId is always set for those, see recordGoal), away goals
      // never have a player attached (nobody logs who scored FOR the
      // opponent) so the opponent's own team name stands in as the
      // "scorer" instead.
      goals: state.goalLog.slice().sort(function(a,b){ return a.matchMs - b.matchMs; }).map(function(g){
        return {
          team: g.team,
          scorerName: g.team === 'home' ? (nameById[g.playerId || ''] || '(fjernet spiller)') : opponentLabel,
          matchMs: g.matchMs
        };
      }),
      // Local-only, like durationMs above (see its comment) - never sent to
      // Supabase, only read back off this same entry for the "Kampen er
      // ferdig" popup.
      swapCount: state.swapCount || 0
    };
  }

  // Avslutt/Ny økt discard the whole session state via resetMatch()
  // (defaultState()), which never goes through endMatchPeriod - so the
  // match still in progress at that moment would otherwise vanish without
  // ever reaching the shared history archive. Called (with the coach's
  // answer to "lagre denne kampen?") right before resetMatch() wipes
  // everything away for good.
  function archiveInProgressMatch(saveToHistory){
    // Always computes the summary (for the "Kampen er ferdig" popup right
    // after this, see lastMatchSummary/showMatchSummaryThen) - only the
    // Supabase save itself is conditional on the coach's answer.
    var now = Date.now();
    var calc = computeMatchScoreAndPlayerMs(now);
    var entry = buildHistoryArchiveEntry(now, calc);
    entry.durationMs = matchClockElapsed(now);
    lastMatchSummary = entry;
    if (saveToHistory) saveMatchToHistory(entry);
  }

  /** @type {(() => void)|null} */
  var matchSummaryNextFn = null;
  // "Kampen er ferdig" popup - shown right after Kampslutt/Avslutt actually
  // finishes (see the 5 call sites of endMatchPeriod()/archiveInProgressMatch()),
  // using whatever they just set on lastMatchSummary, regardless of whether
  // the coach also chose to save it to the shared Historikk. `next` is
  // whatever would otherwise have run immediately (openOpponentModal(),
  // showLauncherMenu(), ...) - deferred until "OK" is pressed instead, so
  // the summary isn't instantly buried under the next screen. Safe to call
  // with no `next` at all (the idle-auto-pause paths do this).
  /** @param {() => void} [next] */
  function showMatchSummaryThen(next){
    var entry = lastMatchSummary;
    if (!entry){ if (next) next(); return; }
    matchSummaryNextFn = next || null;
    var opponent = entry.opponentName || (entry.opponentAbbr ? entry.opponentAbbr : 'Ukjent motstander');
    els.matchSummaryHeadline.textContent =
      HOME_TEAM_NAME + ' vs ' + opponent + ' · ' + entry.homeScore + ' - ' + entry.awayScore;
    els.matchSummaryDuration.textContent = formatMs(entry.durationMs || 0) + ' spilt';
    var swapCount = entry.swapCount || 0;
    els.matchSummarySwaps.textContent = swapCount + (swapCount === 1 ? ' bytte' : ' bytter');
    // Always exactly one of the three visible - sun/S (win), raincloud/T
    // (loss), or three calm lines/U (draw, deliberately neutral: same gray
    // for both icon and letter, never orange or blue, so it can't read as
    // a muted win or loss).
    var isWin = entry.homeScore > entry.awayScore;
    var isLoss = entry.homeScore < entry.awayScore;
    var isDraw = !isWin && !isLoss;
    els.matchSummaryWeatherWin.hidden = !isWin;
    els.matchSummaryWeatherLoss.hidden = !isLoss;
    els.matchSummaryWeatherDraw.hidden = !isDraw;
    var goals = entry.goals || [];
    els.matchSummaryGoalsTitle.hidden = goals.length === 0;
    els.matchSummaryGoals.innerHTML = goals.map(function(g){
      return '<div class="match-summary-goal match-summary-goal-' + g.team + '">' +
        '<span class="match-summary-goal-time">' + formatMs(g.matchMs) + '</span>' +
        '<span class="match-summary-goal-scorer">' + escapeHtml(g.scorerName) + '</span>' +
      '</div>';
    }).join('');
    var players = (entry.players || []).slice().sort(function(a,b){ return b.ms - a.ms; });
    els.matchSummaryPlayers.innerHTML = players.map(function(p){
      return '<div class="match-summary-player">' +
        '<span class="match-summary-player-name">' + escapeHtml(p.name) + (p.goals > 0 ? ' (' + p.goals + ' mål)' : '') + '</span>' +
        '<span class="match-summary-player-k">' + formatMs(p.ms) + '</span>' +
        '<span class="match-summary-player-t">' + formatCumulative(p.totalMs || 0) + '</span>' +
      '</div>';
    }).join('') || '<div class="match-summary-empty">Ingen spillerdata registrert.</div>';
    els.matchSummaryModal.classList.add('open');
  }

  /** @type {((saveToHistory: boolean) => void)|null} */
  var pendingSaveHistoryCallback = null;
  // Shown right after the coach confirms Kampslutt/Avslutt/Ny økt (any path
  // that ends or discards the current match) - callback runs with true/false
  // once they pick, then resetMatch()/endMatchPeriod() carries on. Not shown
  // for "Forlat kampen"/"Forlat delt økt" - those never touch the match.
  /** @param {(saveToHistory: boolean) => void} callback */
  function askSaveToHistory(callback){
    pendingSaveHistoryCallback = callback;
    els.saveHistoryModal.classList.add('open');
  }

  /** @param {boolean} reorganize @param {boolean} saveToHistory */
  function endMatchPeriod(reorganize, saveToHistory){
    var now = Date.now();
    // commitFieldStint/commitBenchStint bank the current stint's elapsed
    // time into state.cumulative, but - unlike every other caller (a swap
    // removes the player from onField/deletes their timer entirely; a
    // pause runs the same freeze through freezeTimersAt, which also
    // advances sinceTs) - this player is still sitting in state.onField
    // with a stale fieldTimers[id].sinceTs right up until computeMatch-
    // ScoreAndPlayerMs() runs a few lines down. That call's own
    // cumulativeFieldMs() re-adds fieldElapsed() for anyone still on the
    // field, double-counting the exact same stint on top of what was just
    // committed - real bug, reproduces on every ordinary Kampslutt with
    // anyone still on the field (i.e. almost always), found by actually
    // starting a match, waiting a few seconds and ending it, nothing
    // exotic. Advancing sinceTs here too closes the window: a fieldElapsed
    // call an instant later correctly reads ~0 additional.
    state.onField.forEach(function(id){
      commitFieldStint(id, now);
      if (state.fieldTimers[id]) state.fieldTimers[id].sinceTs = now;
    });
    state.onBench.forEach(function(id){
      commitBenchStint(id, now);
      if (state.benchTimers[id]) state.benchTimers[id].sinceTs = now;
    });

    // Archive this match before wiping its scoreboard - "Kampslutt" means
    // exactly that (a cup day is several separate matches back to back, not
    // halves of one match), so the goal tally must NOT carry over into the
    // next match either (see goalLog reset below - this used to be a bug:
    // goals kept accumulating across what the coach clearly meant as
    // separate matches).
    var calc = computeMatchScoreAndPlayerMs(now);
    var homeScore = calc.homeScore, awayScore = calc.awayScore, playerMs = calc.playerMs;
    // Built once here (before goalLog/matchClock/onField are touched below)
    // and reused both for the optional Supabase archive AND the "Kampen er
    // ferdig" summary shown right after this - see showMatchSummaryThen()
    // at every call site of endMatchPeriod/archiveInProgressMatch.
    var summaryEntry = buildHistoryArchiveEntry(now, calc);
    summaryEntry.durationMs = matchClockElapsed(now);
    lastMatchSummary = summaryEntry;
    if (!Array.isArray(state.matchHistory)) state.matchHistory = [];
    state.matchHistory.push({
      id: uid(),
      opponentName: state.opponentName || '',
      opponentAbbr: state.opponentAbbr || '',
      homeScore: homeScore,
      awayScore: awayScore,
      endedAt: now,
      playerMs: playerMs,
      // Snapshots the scorer's name (not just id, like playerMs above) so
      // "Eksporter spillerdata" (buildExportText) still shows who scored
      // and when even after a player is later removed from the roster -
      // away-team goals have no playerId (see recordGoal/computeGoalBadges,
      // never attributed to an individual) and are skipped here.
      goals: state.goalLog
        .filter(function(g){ return g.team === 'home' && g.playerId; })
        .map(function(g){
          var id = /** @type {string} */ (g.playerId);
          var p = playerById(id);
          return { playerId: id, playerName: p ? p.name : '(fjernet spiller)', matchMs: g.matchMs };
        })
    });
    // Separate from the above: the shared Supabase archive - state.matchHistory
    // is synced shared-session state and gets wiped by resetMatch() same as
    // everything else, which is right for "this session's matches so far"
    // but wrong for a durable record admins can look back on later. Gated
    // on the coach's answer to the "lagre denne kampen til historikk?"
    // prompt shown right before this runs (see saveHistoryModal), not a
    // standing setting - a coach who always says no just doesn't add a row.
    if (saveToHistory){
      saveMatchToHistory(summaryEntry);
    }
    state.goalLog = [];
    state.swapCount = 0;
    // Next match likely means a next opponent (cup format) - clearing this
    // brings the "?" back on the scoreboard and re-arms the opponent prompt
    // (see openOpponentModal's call sites) rather than silently keeping the
    // just-finished opponent's name on the new match.
    state.opponentName = '';
    state.opponentAbbr = '';

    if (reorganize){
      // Default (false): total cumulative time, same as always. The
      // Innstillinger screen's "Bytt om bruker siste kamp" toggle switches
      // this to `playerMs` instead - each player's time in the match that
      // just ended alone (see computeMatchScoreAndPlayerMs above), so a
      // player who's played a lot overall but sat out the last match still
      // gets set up first next time.
      var all = state.players.map(function(p){
        var ms = state.reorgUsesLastMatch
          ? (playerMs[p.id] || 0)
          : (state.cumulative[p.id] && state.cumulative[p.id].fieldMs) || 0;
        return { id: p.id, ms: ms };
      });
      all.sort(function(a,b){ return a.ms - b.ms; }); // ascending: least played first
      var fieldSize = Math.max(1, Math.min(state.fieldSize || 3, all.length));
      state.onField = all.slice(0, fieldSize).map(function(x){ return x.id; });
      state.onBench = all.slice(fieldSize).map(function(x){ return x.id; });
    }

    state.fieldTimers = {};
    state.benchTimers = {};
    timeUpNotified = {};
    state.onField.forEach(function(id){
      state.fieldTimers[id] = { baseElapsedMs: 0, sinceTs: now };
    });
    state.onBench.forEach(function(id){
      state.benchTimers[id] = { baseElapsedMs: 0, sinceTs: now };
    });

    state.matchClock = { baseElapsedMs: 0, sinceTs: now };
    state.globalRunning = false;
    // Baseline for "current period" rank badges (see currentPeriodFieldMs) -
    // the period that's about to start counts from here, not from 0 in the
    // lifetime cumulative.
    state.periodStartCumulative = cloneStateValue(state.cumulative);
    selected = null;
    suggestedPartnerId = null;
    swapSuggestionArmed = false;
    undoStack = [];
    redoStack = [];
    multiMode = false;
    multiSelected = [];
    saveState();
  }

  function animateReorganization(mutateFn){
    var tokens = Array.prototype.slice.call(document.querySelectorAll('.token'));
    tokens.forEach(function(el){ el.classList.add('reorg-out'); });
    setTimeout(function(){
      mutateFn();
      renderAll();
      var newTokens = Array.prototype.slice.call(document.querySelectorAll('.token'));
      newTokens.forEach(function(el, i){
        el.style.animationDelay = (i * 90) + 'ms';
        el.classList.add('reorg-in');
      });
      var totalDelay = 650 + newTokens.length * 90;
      setTimeout(function(){
        newTokens.forEach(function(el){
          el.classList.remove('reorg-in');
          el.style.animationDelay = '';
        });
      }, totalDelay);
    }, 600);
  }

  function resetMatch(){
    // Wipes state for every device still connected to sessionCode - only
    // safe once this device either owns the session or isn't in one at
    // all (see isMaster()). Callers that might run this on a slave still
    // in someone else's session (the launcher's "Ny økt") leave it first.
    if (!isMaster()) return;
    selected = null;
    suggestedPartnerId = null;
    swapSuggestionArmed = false;
    undoStack = [];
    redoStack = [];
    timeUpNotified = {};
    multiMode = false;
    multiSelected = [];
    var keepWakeLock = state.wakeLockEnabled;
    // defaultState() sets these back to null/[] - losing sessionOwnerDeviceId
    // here would silently un-master the very device that's allowed to call
    // this function, locking everyone (including the real owner) out of
    // isMaster()-gated controls for the rest of the shared session.
    var keepOwnerDeviceId = state.sessionOwnerDeviceId;
    var keepParticipants = state.participants;
    // defaultDurationMs/matchDurationMs/fieldSize/rankByCumulative are
    // deliberately NOT carried over from the old state here (they used to
    // be) - defaultState() above already reads them fresh from
    // loadCoachDefaults(), which is exactly Innstillingers "Standardverdier
    // for ny kamp" group. Carrying over the pre-reset values instead meant
    // "Ny økt"/"Avslutt og nullstill" silently ignored any Innstillinger
    // change made since the session started - e.g. switching to 5er-fotball
    // in Innstillinger still left the next match at 3 på banen, since this
    // stale value overwrote the fresh default defaultState() had just set.
    state = defaultState();
    state.wakeLockEnabled = keepWakeLock;
    state.sessionOwnerDeviceId = keepOwnerDeviceId;
    state.participants = keepParticipants;
    saveState();
    updateUndoUI();
    updateMultiSelectUI();
    els.endMatchModal.classList.remove('open');
    els.settingsModal.classList.remove('open');
    renderAll();
    openSettings(true);
  }

  // Belt-and-suspenders against iOS's rubber-band bounce: touch-action:none
  // on html/body (see style.css) should already stop the browser's default
  // touch-driven panning, but WebKit's native elastic overscroll of the
  // whole page can still slip through it in standalone-PWA/some-iOS-
  // version combinations - which is what let the header intermittently
  // slide up under the iPhone status bar's own translucent overlay and
  // read as diffuse there (see header's padding-top comment in style.css).
  // This cancels the touch gesture at the JS level too, which WebKit can't
  // route around the same way - UNLESS the touch started inside something
  // that's actually meant to scroll (a modal, the suggest-list, the field/
  // bench once they've got enough players to overflow, etc.), found by
  // walking up from the touch target for the first scrollable ancestor,
  // so none of those lose their own scrolling.
  //
  // Tried removing this once (v2.0.3) to see if touch-action:none alone was
  // enough now that the header has more clearance - it wasn't; André still
  // got a persistent scroll offset that didn't spring back, so this is back
  // for good unless something better replaces it.
  function isScrollableAncestor(el){
    while (el && el !== document.body && el !== document.documentElement){
      var style = getComputedStyle(el);
      var overflowY = style.overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return true;
      el = el.parentElement;
    }
    return false;
  }
  document.addEventListener('touchmove', function(e){
    if (isScrollableAncestor(/** @type {HTMLElement} */ (e.target))) return;
    e.preventDefault();
  }, { passive: false });

  /* ---------------- Init ---------------- */

  function init(){
    els.field = qs('field');
    els.fieldWrap = qs('field-wrap');
    els.bench = qs('bench');
    els.benchWrap = qs('bench-wrap');
    els.playPauseBtn = qs('playPauseBtn');
    els.playPauseIcon = els.playPauseBtn.querySelector('.pp-icon');
    els.playPauseText = els.playPauseBtn.querySelector('.pp-text');
    els.undoBtn = qs('undoBtn');
    els.undoCountBadge = qs('undoCountBadge');
    els.backActionModal = qs('backActionModal');
    els.undoActionBtn = qs('undoActionBtn');
    els.redoActionBtn = qs('redoActionBtn');
    els.backToMenuActionBtn = qs('backToMenuActionBtn');
    els.backActionCancelBtn = qs('backActionCancelBtn');
    els.endBtn = qs('endBtn');
    els.selectionInfo = qs('selectionInfo');
    els.pitchLines = qs('pitchLines');
    els.viewportFrame = qs('viewport-frame');
    els.appEl = qs('app');
    els.launcherScreen = qs('launcherScreen');
    els.launcherTile = qs('launcherTile');
    els.launcherChoiceOverlay = qs('launcherChoiceOverlay');
    els.launcherChoicePanelChoice = qs('launcherChoicePanelChoice');
    els.launcherChoicePanelJoin = qs('launcherChoicePanelJoin');
    els.continueSessionChoiceBtn = qs('continueSessionChoiceBtn');
    els.newSessionWrap = qs('newSessionWrap');
    els.newSessionChoiceBtn = qs('newSessionChoiceBtn');
    els.newSessionDivider = qs('newSessionDivider');
    els.newSessionCancelBtn = qs('newSessionCancelBtn');
    els.joinSessionChoiceBtn = qs('joinSessionChoiceBtn');
    els.launcherChoiceCancelBtn = qs('launcherChoiceCancelBtn');
    els.launcherChoiceBackBtn = qs('launcherChoiceBackBtn');
    els.launcherJoinInputWrap = qs('launcherJoinInputWrap');
    els.launcherJoinInput = qs('launcherJoinInput');
    els.launcherJoinError = qs('launcherJoinError');
    els.launcherJoinEnterBtn = qs('launcherJoinEnterBtn');
    els.coinTile = qs('coinTile');
    els.coinTileArt = qs('coinTileArt');
    els.settingsTile = qs('settingsTile');
    els.accountBtn = qs('accountBtn');
    els.accountLoginModal = qs('accountLoginModal');
    els.accountLoginCloseBtn = qs('accountLoginCloseBtn');
    els.accountLoginEmail = qs('accountLoginEmail');
    els.accountLoginPassword = qs('accountLoginPassword');
    els.accountLoginNote = qs('accountLoginNote');
    els.accountLoginBtn = qs('accountLoginBtn');
    els.accountGoRegisterLink = qs('accountGoRegisterLink');
    els.registerScreen = qs('registerScreen');
    els.registerCloseBtn = qs('registerCloseBtn');
    els.registerTeamName = qs('registerTeamName');
    els.registerEmail = qs('registerEmail');
    els.registerPassword = qs('registerPassword');
    els.registerPasswordRepeat = qs('registerPasswordRepeat');
    els.registerNote = qs('registerNote');
    els.registerSubmitBtn = qs('registerSubmitBtn');
    els.registerGoLoginLink = qs('registerGoLoginLink');
    els.settingsScreen = qs('settingsScreen');
    els.settingsScreenCloseBtn = qs('settingsScreenCloseBtn');
    els.settingsHomeName = qs('settingsHomeName');
    els.settingsHomeAbbr = qs('settingsHomeAbbr');
    els.settingsMatchDurationValue = qs('settingsMatchDurationValue');
    els.settingsMatchDurationMinus = qs('settingsMatchDurationMinus');
    els.settingsMatchDurationPlus = qs('settingsMatchDurationPlus');
    els.settingsSwapDurationValue = qs('settingsSwapDurationValue');
    els.settingsSwapDurationMinus = qs('settingsSwapDurationMinus');
    els.settingsSwapDurationPlus = qs('settingsSwapDurationPlus');
    els.settingsFieldFormat = qs('settingsFieldFormat');
    els.settingsDefaultRankCumulative = qs('settingsDefaultRankCumulative');
    els.settingsDefaultReorgLastMatch = qs('settingsDefaultReorgLastMatch');
    els.settingsSaveBtn = qs('settingsSaveBtn');
    els.settingsSavedNote = qs('settingsSavedNote');
    els.settingsStorageNote = qs('settingsStorageNote');
    els.settingsLogoutBtn = qs('settingsLogoutBtn');
    els.coinFlipScreen = qs('coinFlipScreen');
    els.coinFlipCloseBtn = qs('coinFlipCloseBtn');
    els.coinPanelPick = qs('coinPanelPick');
    els.coinHomeColorGrid = qs('coinHomeColorGrid');
    els.coinAwayColorGrid = qs('coinAwayColorGrid');
    els.coinColorError = qs('coinColorError');
    els.coinFlipStartBtn = qs('coinFlipStartBtn');
    els.coinPanelFlip = qs('coinPanelFlip');
    els.coinArc = qs('coinArc');
    els.coin = qs('coin');
    els.coinFaceFront = qs('coinFaceFront');
    els.coinFaceBack = qs('coinFaceBack');
    els.coinPanelResult = qs('coinPanelResult');
    els.coinResultBadge = qs('coinResultBadge');
    els.coinResultText = qs('coinResultText');
    els.coinFlipAgainBtn = qs('coinFlipAgainBtn');
    els.coinFlipDoneBtn = qs('coinFlipDoneBtn');
    els.historyTile = qs('historyTile');
    els.historyScreen = qs('historyScreen');
    els.historyCloseBtn = qs('historyCloseBtn');
    els.historySelectModeBtn = qs('historySelectModeBtn');
    els.historyList = qs('historyList');
    els.historyEmpty = qs('historyEmpty');
    els.historySelectBar = qs('historySelectBar');
    els.historySelectAllBtn = qs('historySelectAllBtn');
    els.historySelectCount = qs('historySelectCount');
    els.historyDeleteSelectedBtn = qs('historyDeleteSelectedBtn');
    els.historyDeleteConfirmModal = qs('historyDeleteConfirmModal');
    els.historyDeleteConfirmText = qs('historyDeleteConfirmText');
    els.historyDeleteCancelBtn = qs('historyDeleteCancelBtn');
    els.historyDeleteConfirmBtn = qs('historyDeleteConfirmBtn');
    els.historyLogoutBtn = qs('historyLogoutBtn');
    els.historyLoginModal = qs('historyLoginModal');
    els.historyLoginCloseBtn = qs('historyLoginCloseBtn');
    els.historyLoginFormFields = qs('historyLoginFormFields');
    els.historyLoginEmailWrap = qs('historyLoginEmailWrap');
    els.historyLoginEmail = qs('historyLoginEmail');
    els.historyLoginPasswordWrap = qs('historyLoginPasswordWrap');
    els.historyLoginPassword = qs('historyLoginPassword');
    els.historyLoginError = qs('historyLoginError');
    els.historyLoginBtn = qs('historyLoginBtn');
    els.historyLoginLockedNote = qs('historyLoginLockedNote');
    els.historyLoginLockedText = qs('historyLoginLockedText');
    els.multiSwapWarning = qs('multiSwapWarning');
    els.settingsBtn = qs('settingsBtn');
    els.settingsModal = qs('settingsModal');
    els.joinedEmptyNote = qs('joinedEmptyNote');
    els.masterOnlyNote = qs('masterOnlyNote');
    els.shareSessionRow = qs('shareSessionRow');
    els.rankCumulativeRow = qs('rankCumulativeRow');
    els.transferOwnerRow = qs('transferOwnerRow');
    els.transferOwnerWrap = qs('transferOwnerWrap');
    els.transferOwnerBtn = qs('transferOwnerBtn');
    els.transferOwnerDivider = qs('transferOwnerDivider');
    els.transferOwnerCancelBtn = qs('transferOwnerCancelBtn');
    els.transferOwnerNote = qs('transferOwnerNote');
    els.leaveMatchBtn = qs('leaveMatchBtn');
    els.closeSessionRow = qs('closeSessionRow');
    els.closeSessionBtn = qs('closeSessionBtn');
    els.closeSessionConfirmModal = qs('closeSessionConfirmModal');
    els.closeSessionConfirmText = qs('closeSessionConfirmText');
    els.closeSessionCancelBtn = qs('closeSessionCancelBtn');
    els.closeSessionConfirmBtn = qs('closeSessionConfirmBtn');
    els.nameRows = qs('nameRows');
    els.addPlayerRowBtn = qs('addPlayerRowBtn');
    els.durMin = qs('durMin');
    els.durSec = qs('durSec');
    els.fieldSizeInput = qs('fieldSizeInput');
    els.fieldSizeLockedNote = qs('fieldSizeLockedNote');
    els.okBtn = qs('settingsOkBtn');
    els.cancelBtn = qs('settingsCancelBtn');
    els.settingsCloseBtn = qs('settingsCloseBtn');
    els.settingsHomeBtn = qs('settingsHomeBtn');
    els.settingsCloseConfirmModal = qs('settingsCloseConfirmModal');
    els.settingsCloseSaveBtn = qs('settingsCloseSaveBtn');
    els.settingsCloseDiscardBtn = qs('settingsCloseDiscardBtn');
    els.settingsCloseCancelBtn = qs('settingsCloseCancelBtn');
    els.endMatchModal = qs('endMatchModal');
    els.endMatchSummary = qs('endMatchSummary');
    els.matchHistorySummary = qs('matchHistorySummary');
    els.endMatchCancelBtn = qs('endMatchCancelBtn');
    els.endPeriodBtn = qs('endPeriodBtn');
    els.endPeriodWrap = qs('endPeriodWrap');
    els.endPeriodInfoBtn = qs('endPeriodInfoBtn');
    els.endResetBtn = qs('endResetBtn');
    els.endResetWrap = qs('endResetWrap');
    els.endResetInfoBtn = qs('endResetInfoBtn');
    els.reorgPromptModal = qs('reorgPromptModal');
    els.reorgNoBtn = qs('reorgNoBtn');
    els.reorgYesBtn = qs('reorgYesBtn');
    els.saveHistoryModal = qs('saveHistoryModal');
    els.saveHistoryYesBtn = qs('saveHistoryYesBtn');
    els.saveHistoryNoBtn = qs('saveHistoryNoBtn');
    els.matchSummaryModal = qs('matchSummaryModal');
    els.matchSummaryWeatherWin = qs('matchSummaryWeatherWin');
    els.matchSummaryWeatherLoss = qs('matchSummaryWeatherLoss');
    els.matchSummaryWeatherDraw = qs('matchSummaryWeatherDraw');
    els.matchSummaryHeadline = qs('matchSummaryHeadline');
    els.matchSummaryDuration = qs('matchSummaryDuration');
    els.matchSummarySwaps = qs('matchSummarySwaps');
    els.matchSummaryGoalsTitle = qs('matchSummaryGoalsTitle');
    els.matchSummaryGoals = qs('matchSummaryGoals');
    els.matchSummaryPlayers = qs('matchSummaryPlayers');
    els.matchSummaryCloseBtn = qs('matchSummaryCloseBtn');
    els.multiSelectBtn = qs('multiSelectBtn');
    els.multiSelectBtnLabel = qs('multiSelectBtnLabel');
    els.multiSelectCancelBtn = qs('multiSelectCancelBtn');
    els.swapSuggestionBtn = qs('swapSuggestionBtn');
    els.swapSuggestionBtnLabel = qs('swapSuggestionBtnLabel');
    els.swapSuggestionCancelBtn = qs('swapSuggestionCancelBtn');
    els.matchClock = qs('matchClock');
    els.matchCountdown = qs('matchCountdown');
    els.homeScoreBtn = qs('homeScoreBtn');
    els.homeTeamLabel = qs('homeTeamLabel');
    els.awayScoreBtn = qs('awayScoreBtn');
    els.awayTeamLabel = qs('awayTeamLabel');
    els.opponentModal = qs('opponentModal');
    els.opponentNameInput = qs('opponentNameInput');
    els.opponentAbbrInput = qs('opponentAbbrInput');
    els.opponentSkipBtn = qs('opponentSkipBtn');
    els.opponentSaveBtn = qs('opponentSaveBtn');
    els.goalConfirmModal = qs('goalConfirmModal');
    els.goalConfirmText = qs('goalConfirmText');
    els.goalConfirmNoBtn = qs('goalConfirmNoBtn');
    els.goalConfirmYesBtn = qs('goalConfirmYesBtn');
    els.goalListBtn = qs('goalListBtn');
    els.goalPlayerModal = qs('goalPlayerModal');
    els.goalPlayerModalTitle = qs('goalPlayerModalTitle');
    els.goalPlayerList = qs('goalPlayerList');
    els.goalPlayerCancelBtn = qs('goalPlayerCancelBtn');
    els.goalRemoveLastBtn = qs('goalRemoveLastBtn');
    els.goalRemoveLastTarget = qs('goalRemoveLastTarget');
    els.goalTimesModal = qs('goalTimesModal');
    els.goalTimesTitle = qs('goalTimesTitle');
    els.goalTimesText = qs('goalTimesText');
    els.goalTimesCloseBtn = qs('goalTimesCloseBtn');
    els.matchDurationInput = qs('matchDurationInput');
    els.wakeLockToggle = qs('wakeLockToggle');
    els.exportBtn = qs('exportBtn');
    els.exportModal = qs('exportModal');
    els.exportText = qs('exportText');
    els.exportCloseBtn = qs('exportCloseBtn');
    els.exportCopyBtn = qs('exportCopyBtn');
    els.legendBtn = qs('legendBtn');
    els.legendModal = qs('legendModal');
    els.legendCloseBtn = qs('legendCloseBtn');
    els.infoPopupModal = qs('infoPopupModal');
    els.infoPopupTitle = qs('infoPopupTitle');
    els.infoPopupText = qs('infoPopupText');
    els.infoPopupCloseBtn = qs('infoPopupCloseBtn');
    els.matchDurationPickerModal = qs('matchDurationPickerModal');
    els.durationPickerCloseBtn = qs('durationPickerCloseBtn');
    els.durationPickerWheel = qs('durationPickerWheel');
    els.durationPickerValue = qs('durationPickerValue');
    els.sessionCodeBar = qs('sessionCodeBar');
    els.sessionCodeText = qs('sessionCodeText');
    els.autoPauseNotice = qs('autoPauseNotice');
    els.idleSuggestModal = qs('idleSuggestModal');
    els.idleSuggestText = qs('idleSuggestText');
    els.idleSuggestCancelBtn = qs('idleSuggestCancelBtn');
    els.idleSuggestConfirmBtn = qs('idleSuggestConfirmBtn');
    els.idleSuggestSnoozeBtn = qs('idleSuggestSnoozeBtn');
    els.joinedEmptyReadOnlyNotice = qs('joinedEmptyReadOnlyNotice');
    els.ownerTransferredNotice = qs('ownerTransferredNotice');
    els.shareSessionToggle = qs('shareSessionToggle');
    els.shareModeRow = qs('shareModeRow');
    els.shareModeSegmented = qs('shareModeSegmented');
    els.rankByCumulativeToggle = qs('rankByCumulativeToggle');
    els.joinExistingBtn = qs('joinExistingBtn');
    els.joinCodeModal = qs('joinCodeModal');
    els.joinCodeInput = qs('joinCodeInput');
    els.joinCodeInputWrap = qs('joinCodeInputWrap');
    els.joinCodeError = qs('joinCodeError');
    els.joinCodeCancelBtn = qs('joinCodeCancelBtn');
    els.joinCodeConfirmBtn = qs('joinCodeConfirmBtn');
    els.launcherVersionBtn = qs('launcherVersionBtn');
    els.launcherVersionBtn.textContent = 'v' + APP_VERSION.split('.').slice(0, 2).join('.');
    els.versionHistoryModal = qs('versionHistoryModal');
    els.versionHistoryTitle = qs('versionHistoryTitle');
    els.versionHistoryList = qs('versionHistoryList');
    els.versionHistoryCloseBtn = qs('versionHistoryCloseBtn');
    els.launcherVersionBtn.addEventListener('click', function(){
      els.versionHistoryTitle.textContent = 'v' + APP_VERSION;
      els.versionHistoryList.innerHTML = VERSION_HISTORY.map(function(entry){
        return '<div class="version-history-entry">' +
          '<p class="version-history-entry-version">v' + escapeHtml(entry.version) + '</p>' +
          '<p class="version-history-entry-text">' + escapeHtml(entry.text) + '</p>' +
        '</div>';
      }).join('');
      els.versionHistoryModal.classList.add('open');
    });
    els.versionHistoryCloseBtn.addEventListener('click', function(){
      els.versionHistoryModal.classList.remove('open');
    });
    els.syncDot = qs('syncDot');

    networkOnline = navigator.onLine;
    window.addEventListener('online', function(){
      networkOnline = true;
      updateSessionCodeUI();
      // canEdit() gate - see the matching comment on the realtime reconnect
      // push in subscribeToSession, same reasoning applies here.
      if (sessionCode && canEdit()) pushRemoteState(); // push whatever changed while offline right away
    });
    window.addEventListener('offline', function(){
      networkOnline = false;
      updateSessionCodeUI();
    });

    checkForUpdate();
    window.addEventListener('pageshow', function(e){
      if (e.persisted) checkForUpdate();
    });

    state = loadState();
    roster = loadRoster();

    // Assigned here (not at module scope, where els.* don't exist yet) but
    // still module-scope vars - openSettings() (defined outside init())
    // calls transferOwnerConfirm.disarm() every render, and this runs
    // before any code path that could call openSettings() during startup
    // (the empty-roster bootstrap near the end of init()).
    kampsluttConfirm = createConfirmArm({
      armedEls: [els.endPeriodWrap],
      labelEl: els.endPeriodBtn,
      restingLabel: 'Kampslutt, ny kamp',
      onArm: function(){
        els.endPeriodInfoBtn.textContent = '×';
        els.endPeriodInfoBtn.classList.add('is-cancel');
        els.endPeriodInfoBtn.setAttribute('aria-label', 'Avbryt Kampslutt');
      },
      onDisarm: function(){
        els.endPeriodInfoBtn.textContent = 'i';
        els.endPeriodInfoBtn.classList.remove('is-cancel');
        els.endPeriodInfoBtn.setAttribute('aria-label', 'Om Kampslutt');
      }
    });
    avsluttConfirm = createConfirmArm({
      armedEls: [els.endResetWrap],
      labelEl: els.endResetBtn,
      restingLabel: 'Avslutt',
      onArm: function(){
        els.endResetInfoBtn.textContent = '×';
        els.endResetInfoBtn.classList.add('is-cancel');
        els.endResetInfoBtn.setAttribute('aria-label', 'Avbryt Avslutt og nullstill');
      },
      onDisarm: function(){
        els.endResetInfoBtn.textContent = 'i';
        els.endResetInfoBtn.classList.remove('is-cancel');
        els.endResetInfoBtn.setAttribute('aria-label', 'Om Avslutt og nullstill');
      }
    });
    transferOwnerConfirm = createConfirmArm({
      armedEls: [els.transferOwnerWrap, els.transferOwnerBtn],
      shakeEls: [els.transferOwnerWrap],
      labelEl: els.transferOwnerBtn,
      restingLabel: '🔁 Overfør økt-eier',
      onArm: function(){
        els.transferOwnerDivider.hidden = false;
        els.transferOwnerCancelBtn.hidden = false;
      },
      onDisarm: function(){
        els.transferOwnerDivider.hidden = true;
        els.transferOwnerCancelBtn.hidden = true;
      }
    });
    els.transferOwnerCancelBtn.addEventListener('click', function(){ transferOwnerConfirm.disarm(); });

    els.playPauseBtn.addEventListener('click', togglePlayPause);
    els.undoBtn.addEventListener('click', function(){
      // Angre/Gjør om are real mutations (blocked for a read-only shared-
      // session viewer, same as everywhere else - see canEdit()), but this
      // button stays fully tappable regardless so "Gå tilbake til
      // hovedmeny" below (pure navigation) is always reachable.
      els.undoActionBtn.disabled = undoStack.length === 0 || !canEdit();
      els.redoActionBtn.disabled = redoStack.length === 0 || !canEdit();
      els.backActionModal.classList.add('open');
    });
    els.undoActionBtn.addEventListener('click', function(){
      els.backActionModal.classList.remove('open');
      undoLastAction();
    });
    els.redoActionBtn.addEventListener('click', function(){
      els.backActionModal.classList.remove('open');
      redoLastAction();
    });
    els.backToMenuActionBtn.addEventListener('click', function(){
      els.backActionModal.classList.remove('open');
      showLauncherMenu();
    });
    els.backActionCancelBtn.addEventListener('click', function(){
      els.backActionModal.classList.remove('open');
    });
    // Opening settings is always allowed now (even for a read-only shared-
    // session viewer) - it's pure navigation, and the mutating fields
    // inside gate themselves individually (see openSettings/isMaster).
    els.settingsBtn.addEventListener('click', function(){ openSettings(false); });
    // A focused <input type=number> silently changes its value on mouse-
    // wheel/trackpad scroll in Chrome/Firefox - completely invisible if the
    // input is scrolled past rather than deliberately spun. On
    // fieldSizeInput specifically that was the real cause behind "new name
    // fields keep appearing on their own": scrolling the settings modal
    // past "Antall utespillere" while it still had focus (e.g. right after
    // tapping it) silently bumped the count, which syncNameRows()
    // immediately (and correctly) followed by adding more rows - a
    // one-scroll-tick change nobody actually asked for, made to look like
    // two unrelated systems fighting when it was really just this. Blurring
    // on wheel stops the browser from applying that default page-scroll
    // action to the input's value, while the page itself keeps scrolling
    // normally underneath.
    Array.prototype.forEach.call(document.querySelectorAll('input[type=number]'), function(el){
      el.addEventListener('wheel', function(){ el.blur(); });
    });
    els.fieldSizeInput.addEventListener('input', syncNameRows);
    els.addPlayerRowBtn.addEventListener('click', function(){
      addNameRow(null, '', els.nameRows.querySelectorAll('.name-row').length + 1, false, true);
    });
    els.matchDurationInput.addEventListener('input', applyMatchDurationSuggestion);
    els.okBtn.addEventListener('click', saveSettings);
    els.cancelBtn.addEventListener('click', function(){ els.settingsModal.classList.remove('open'); });
    // Anything that only takes effect on "OK" (see saveSettings) marks the
    // form dirty, so the × button below knows whether to just close (like
    // Avbryt) or ask first - checkboxes are excluded since those toggles
    // (wake lock, share mode, kumulert rangering) already save themselves
    // instantly on change, nothing to lose by closing without asking.
    els.settingsModal.addEventListener('input', function(e){
      var t = /** @type {HTMLInputElement} */ (e.target);
      if (t && t.tagName === 'INPUT' && t.type !== 'checkbox') settingsDirty = true;
    });
    // Shared by both the × (just close, back to whatever's running behind
    // settings) and the ⌂ (go all the way home) buttons - only the intent
    // differs, so the dirty-check/confirm dance below only needs writing
    // once. settingsCloseIntent records which of the two to finish with
    // once a pending "save changes?" resolves.
    var settingsCloseIntent = 'close';
    function requestCloseSettings(intent){
      settingsCloseIntent = intent;
      if (!settingsDirty){
        els.settingsModal.classList.remove('open');
        if (intent === 'home') showLauncherMenu();
        return;
      }
      els.settingsCloseConfirmModal.classList.add('open');
    }
    els.settingsCloseBtn.addEventListener('click', function(){ requestCloseSettings('close'); });
    els.settingsHomeBtn.addEventListener('click', function(){ requestCloseSettings('home'); });
    els.settingsCloseSaveBtn.addEventListener('click', function(){
      els.settingsCloseConfirmModal.classList.remove('open');
      saveSettings(); // only actually closes settingsModal if the names are valid
      if (settingsCloseIntent === 'home' && !els.settingsModal.classList.contains('open')){
        showLauncherMenu();
      }
    });
    els.settingsCloseDiscardBtn.addEventListener('click', function(){
      els.settingsCloseConfirmModal.classList.remove('open');
      els.settingsModal.classList.remove('open');
      if (settingsCloseIntent === 'home') showLauncherMenu();
    });
    els.settingsCloseCancelBtn.addEventListener('click', function(){
      els.settingsCloseConfirmModal.classList.remove('open');
    });
    els.endBtn.addEventListener('click', function(){
      // No canEdit() gate here anymore - "Forlat kampen"/"Forlat delt økt"
      // below need to stay reachable even for a read-only viewer (see
      // .view-only's comment in style.css), so the modal itself opens for
      // everyone; each individual action inside is gated on its own.
      kampsluttConfirm.disarm();
      avsluttConfirm.disarm();
      renderEndMatchSummary();
      renderMatchHistorySummary();
      // "Avslutt og nullstill" wipes the whole match for every connected
      // device at once - master-only, same as the other session-wide
      // administration in settings. "Kampslutt" (next period) needs real
      // edit rights. Neither "Forlat kampen" (pure navigation) nor "Forlat
      // delt økt" (detaches this device, never the match itself) touch the
      // match at all, so neither needs a canEdit()/isMaster() gate.
      els.endPeriodWrap.hidden = !canEdit();
      els.endResetWrap.hidden = !isMaster();
      els.closeSessionRow.hidden = !sessionCode;
      els.endMatchModal.classList.add('open');
    });
    els.endMatchCancelBtn.addEventListener('click', function(){
      kampsluttConfirm.disarm();
      avsluttConfirm.disarm();
      els.endMatchModal.classList.remove('open');
    });
    // Pure navigation, identical to backToMenuActionBtn's "Gå tilbake til
    // hovedmeny" above (same showLauncherMenu(), no state touched at all)
    // - just also reachable from "Avslutt", since that's where people
    // instinctively look when they want to stop for now. Always visible,
    // regardless of sharing/role/edit rights, and no confirmation needed:
    // there's nothing here that could go wrong or need undoing.
    els.leaveMatchBtn.addEventListener('click', function(){
      els.endMatchModal.classList.remove('open');
      showLauncherMenu();
    });
    els.endPeriodBtn.addEventListener('click', function(){
      // Explicit guard, not just relying on the button being hidden for a
      // read-only viewer (see endBtn's click handler) - endMatchModal is
      // reachable by everyone now, so this can't lean on canEdit() having
      // already been checked before the modal even opened.
      if (!canEdit()) return;
      if (!kampsluttConfirm.press()) return; // just armed ("Er du sikker?") - wait for the second press
      avsluttConfirm.disarm();
      els.endMatchModal.classList.remove('open');
      askSaveToHistory(function(saveToHistory){
        pendingSaveToHistory = saveToHistory;
        els.reorgPromptModal.classList.add('open');
      });
    });
    els.reorgNoBtn.addEventListener('click', function(){
      els.reorgPromptModal.classList.remove('open');
      endMatchPeriod(false, pendingSaveToHistory);
      renderAll();
      // next match, likely a different opponent (cup format) - see
      // endMatchPeriod - deferred until the "Kampen er ferdig" summary
      // (see showMatchSummaryThen) is dismissed.
      showMatchSummaryThen(openOpponentModal);
    });
    els.reorgYesBtn.addEventListener('click', function(){
      els.reorgPromptModal.classList.remove('open');
      animateReorganization(function(){
        endMatchPeriod(true, pendingSaveToHistory);
        showMatchSummaryThen(openOpponentModal);
      });
    });
    els.saveHistoryYesBtn.addEventListener('click', function(){
      els.saveHistoryModal.classList.remove('open');
      var cb = pendingSaveHistoryCallback;
      pendingSaveHistoryCallback = null;
      if (cb) cb(true);
    });
    els.saveHistoryNoBtn.addEventListener('click', function(){
      els.saveHistoryModal.classList.remove('open');
      var cb = pendingSaveHistoryCallback;
      pendingSaveHistoryCallback = null;
      if (cb) cb(false);
    });
    els.matchSummaryCloseBtn.addEventListener('click', function(){
      els.matchSummaryModal.classList.remove('open');
      var next = matchSummaryNextFn;
      matchSummaryNextFn = null;
      if (next) next();
    });
    els.idleSuggestCancelBtn.addEventListener('click', function(){
      els.idleSuggestModal.classList.remove('open');
      idleSuggestKind = null;
    });
    els.idleSuggestSnoozeBtn.addEventListener('click', function(){
      els.idleSuggestModal.classList.remove('open');
      if (idleSuggestKind) snoozeIdleSuggest(idleSuggestKind);
      idleSuggestKind = null;
    });
    els.idleSuggestConfirmBtn.addEventListener('click', function(){
      els.idleSuggestModal.classList.remove('open');
      var kind = idleSuggestKind;
      idleSuggestKind = null;
      if (kind === 'reset'){
        askSaveToHistory(function(saveToHistory){
          archiveInProgressMatch(saveToHistory);
          resetMatch();
          showMatchSummaryThen();
        });
      } else if (kind === 'endPeriod'){
        askSaveToHistory(function(saveToHistory){
          endMatchPeriod(false, saveToHistory);
          renderAll();
          showMatchSummaryThen();
        });
      }
    });
    els.endResetBtn.addEventListener('click', function(){
      if (!isMaster()) return;
      if (!avsluttConfirm.press()) return; // just armed - wait for the second press
      kampsluttConfirm.disarm();
      els.endMatchModal.classList.remove('open');
      askSaveToHistory(function(saveToHistory){
        archiveInProgressMatch(saveToHistory);
        resetMatch();
        // resetMatch() itself opens settings (the same first-run flow "Ny
        // økt" relies on, to set up a fresh roster right away) - "Avslutt"
        // instead sends the user back to the home screen, same as "Forlat
        // kampen", since they're mid-match here and more likely to want a
        // clean slate than to fill in a new roster immediately.
        els.settingsModal.classList.remove('open');
        showMatchSummaryThen(showLauncherMenu);
      });
    });
    els.multiSelectBtn.addEventListener('click', onMultiSelectBtnClick);
    els.multiSelectCancelBtn.addEventListener('click', cancelMultiSelect);
    els.swapSuggestionBtn.addEventListener('click', onSwapSuggestionBtnClick);
    els.swapSuggestionCancelBtn.addEventListener('click', cancelSwapSuggestion);
    els.wakeLockToggle.addEventListener('change', function(){
      if (!canEdit()){ els.wakeLockToggle.checked = !!state.wakeLockEnabled; return; }
      state.wakeLockEnabled = els.wakeLockToggle.checked;
      saveState();
      if (state.wakeLockEnabled){
        requestWakeLock();
      } else if (wakeLock){
        wakeLock.release().catch(function(){});
        wakeLock = null;
      }
    });
    els.exportBtn.addEventListener('click', function(){
      els.exportText.value = buildExportText();
      els.exportModal.classList.add('open');
    });
    els.exportCloseBtn.addEventListener('click', function(){ els.exportModal.classList.remove('open'); });
    els.legendBtn.addEventListener('click', function(){ els.legendModal.classList.add('open'); });
    els.legendCloseBtn.addEventListener('click', function(){ els.legendModal.classList.remove('open'); });
    // Kampslutt/Avslutt og nullstill repurpose their info-btn as a cancel
    // "×" while armed (see kampsluttConfirm/avsluttConfirm's onArm above) -
    // this map lets the one generic click handler below know, by the
    // button's own id, to disarm instead of opening the info popup.
    var infoBtnConfirmArms = {
      endPeriodInfoBtn: kampsluttConfirm,
      endResetInfoBtn: avsluttConfirm
    };
    Array.prototype.forEach.call(document.querySelectorAll('.info-btn'), function(btn){
      btn.addEventListener('click', function(){
        var arm = infoBtnConfirmArms[btn.id];
        if (arm && arm.isArmed()){ arm.disarm(); return; }
        var info = INFO_TEXTS[btn.dataset.info || ''];
        if (!info) return;
        els.infoPopupTitle.textContent = info.title;
        els.infoPopupText.textContent = info.text;
        els.infoPopupModal.classList.add('open');
      });
    });
    els.infoPopupCloseBtn.addEventListener('click', function(){ els.infoPopupModal.classList.remove('open'); });
    // #selectionInfo's .si-info-btn/.si-swap-btn aren't in the DOM at
    // page-init time - they're only built the first time updateSelectionInfo()
    // renders a given selection (see selectionInfoRenderedId there), so they
    // can't be bound the same way as the static .info-btns above. Delegate
    // from the container instead, which persists across those rebuilds.
    els.selectionInfo.addEventListener('click', function(e){
      var target = /** @type {HTMLElement} */ (e.target);
      var infoBtn = /** @type {HTMLElement|null} */ (target.closest('.si-info-btn'));
      if (infoBtn){
        var info = INFO_TEXTS[infoBtn.dataset.info || ''];
        if (!info) return;
        els.infoPopupTitle.textContent = info.title;
        els.infoPopupText.textContent = info.text;
        els.infoPopupModal.classList.add('open');
        return;
      }
      var swapBtn = target.closest('.si-swap-btn');
      if (swapBtn && selected){
        els.infoPopupTitle.textContent = 'Bytt spiller';
        els.infoPopupText.textContent = selected.zone === 'bench'
          ? 'Trykk på en utespiller for å bytte spillerne med hverandre.'
          : 'Trykk på en innbytter for å bytte spillerne med hverandre.';
        els.infoPopupModal.classList.add('open');
        return;
      }
      if (target.closest('.si-close-btn')){
        selected = null;
        applySelectionStyles();
      }
    });
    // "Trykk utenfor for å lukke" for the spillerinfo-popup - anywhere that
    // isn't a token (tapping another one already changes/clears the
    // selection on its own via handleTap) and isn't inside the popup
    // itself. Now that #selectionInfo docks over the clock/score instead
    // of floating over the pitch (see its own comment in style.css for
    // why), it never geometrically overlaps a token, so this is the only
    // remaining way to dismiss it without picking a new player.
    document.addEventListener('click', function(e){
      if (!selected) return;
      var target = /** @type {HTMLElement} */ (e.target);
      // .bench-actions (Forslag/multiBytte + their cancel ×) is excluded too -
      // without this, arming a "Forslag" suggestion set `selected` and then
      // this same click's bubble phase immediately treated the Forslag
      // button itself as an "outside" tap and cleared it right back out,
      // so the very next confirm tap found nothing left to swap.
      if (target.closest('.token') || target.closest('#selectionInfo') || target.closest('.bench-actions')) return;
      selected = null;
      applySelectionStyles();
    });
    els.matchClock.addEventListener('click', openDurationPicker);
    bindScoreButton(els.homeScoreBtn,
      function(){ if (!canEdit()) return; openGoalPlayerModal('add'); },
      function(){ if (!canEdit()) return; openGoalPlayerModal('remove'); });
    bindScoreButton(els.awayScoreBtn,
      onAwayScoreTap,
      function(){ removeLastGoal('away', null); });
    els.goalConfirmNoBtn.addEventListener('click', closeGoalConfirm);
    els.goalConfirmYesBtn.addEventListener('click', function(){
      var team = pendingGoalTeam;
      var playerId = pendingGoalPlayerId;
      closeGoalConfirm();
      if (team) registerGoal(team, playerId);
    });
    els.goalPlayerCancelBtn.addEventListener('click', closeGoalPlayerModal);
    els.goalRemoveLastBtn.addEventListener('click', function(){
      closeGoalPlayerModal();
      removeLastGoalOverall('home');
    });
    els.goalListBtn.addEventListener('click', function(){ openGoalPlayerModal('view'); });
    els.awayTeamLabel.addEventListener('click', openOpponentModal);
    els.opponentSkipBtn.addEventListener('click', function(){ els.opponentModal.classList.remove('open'); });
    els.opponentSaveBtn.addEventListener('click', saveOpponent);
    // Uppercase-as-you-type, same spirit as the scoreboard-code styling on
    // this field - saveOpponent() would uppercase it anyway, this just
    // shows the real result while typing instead of only after saving.
    els.opponentAbbrInput.addEventListener('input', function(){
      var pos = els.opponentAbbrInput.selectionStart;
      els.opponentAbbrInput.value = els.opponentAbbrInput.value.toUpperCase();
      try { els.opponentAbbrInput.setSelectionRange(pos, pos); } catch(e){}
    });
    els.goalTimesCloseBtn.addEventListener('click', function(){ els.goalTimesModal.classList.remove('open'); });
    els.durationPickerCloseBtn.addEventListener('click', function(){ els.matchDurationPickerModal.classList.remove('open'); });
    initDurationPickerDrag();
    els.exportCopyBtn.addEventListener('click', function(){
      els.exportText.select();
      if (navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(els.exportText.value).then(function(){
          var original = els.exportCopyBtn.textContent;
          els.exportCopyBtn.textContent = 'Kopiert!';
          setTimeout(function(){ els.exportCopyBtn.textContent = original; }, 1500);
        }).catch(function(){});
      }
    });
    els.shareSessionToggle.addEventListener('change', function(){
      if (!isMaster()){ els.shareSessionToggle.checked = !!sessionCode; return; }
      if (els.shareSessionToggle.checked){
        if (sessionCode){ updateSessionCodeUI(); updateShareModeUI(); return; } // already sharing (e.g. via join)
        createNewSession(function(code){
          if (!code) els.shareSessionToggle.checked = false; // couldn't create (offline?) - revert
          updateSessionCodeUI();
          updateShareModeUI();
        });
      } else {
        leaveSession();
      }
      updateShareModeUI();
    });
    els.shareModeSegmented.addEventListener('click', function(e){
      if (!isMaster()) return;
      var btn = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('.segmented-btn'));
      if (!btn) return;
      state.shareEditable = btn.dataset.mode !== 'read';
      saveState();
      updateShareModeUI();
      updateSessionCodeUI();
    });
    els.rankByCumulativeToggle.addEventListener('change', function(){
      if (!isMaster()){ els.rankByCumulativeToggle.checked = !!state.rankByCumulative; return; }
      state.rankByCumulative = els.rankByCumulativeToggle.checked;
      saveState();
      renderAll();
    });
    els.transferOwnerBtn.addEventListener('click', function(){
      if (!isMaster()) return;
      var target = longestTenuredOtherParticipant();
      if (!target){ shakeElement(els.transferOwnerBtn); return; }
      if (!transferOwnerConfirm.press()) return; // just armed - wait for the second press
      state.sessionOwnerDeviceId = target.deviceId;
      saveState();
      // Rebuild the modal in place - this device is now a slave, so every
      // isMaster()-gated field/row needs to flip to its locked/hidden state
      // immediately, same as if a slave had just opened settings fresh.
      openSettings(false);
    });
    // "Forlat økt" - lives under "Avslutt" (see endBtn), not settings,
    // since that's the button both an owner AND a joined participant
    // instinctively reach for when they want to leave. Available to
    // everyone in a shared session, not just the owner - "I'm done on
    // this device" always reads as exactly that (see the info-btn beside
    // it) rather than "Gå ut av delt økt", which sounded like it led to
    // starting/continuing something else. Crucially, this is NEVER
    // "Avslutt og nullstill" in disguise - even when the owner is the only
    // one left in the session, leaving just detaches this device and
    // leaves the match exactly as it is, so "Fortsett" from the launcher
    // later picks it back up untouched. Only an actual OTHER participant
    // changes the consequence (ownership has to go somewhere so the
    // session stays administrable).
    els.closeSessionBtn.addEventListener('click', function(){
      if (!sessionCode) return;
      if (isMaster()){
        var target = longestTenuredOtherParticipant();
        els.closeSessionConfirmText.textContent = target
          ? 'Økten overføres til enheten som ' + formatJoinedAgo(target.joinedAt) + ', og denne enheten forlater økten.'
          : 'Kampen forblir som den er - du kan fortsette senere fra "Trenerappen" på hjemskjermen.';
      } else {
        els.closeSessionConfirmText.textContent = 'Du forlater økten. Kampen fortsetter som normal for de andre - bli med igjen senere med koden ' + sessionCode + '.';
      }
      els.closeSessionConfirmModal.classList.add('open');
    });
    els.closeSessionCancelBtn.addEventListener('click', function(){
      els.closeSessionConfirmModal.classList.remove('open');
    });
    els.closeSessionConfirmBtn.addEventListener('click', function(){
      els.closeSessionConfirmModal.classList.remove('open');
      if (!sessionCode) return;
      // Only an actual hand-off needs a state change here - with nobody
      // else around, the match itself is left completely untouched (see
      // the confirm text above); leaveSession() below just detaches this
      // device, the same as it does for a non-owner.
      if (isMaster()){
        var target = longestTenuredOtherParticipant();
        if (target){
          state.sessionOwnerDeviceId = target.deviceId;
          saveState();
        }
      }
      leaveSession();
      els.endMatchModal.classList.remove('open');
      showLauncherMenu();
    });
    els.joinExistingBtn.addEventListener('click', function(){
      // Only reachable when this device isn't already in a session (see
      // openSettings - "Forlat økt" under "Avslutt" is what leaves one),
      // so this is always the join flow.
      els.settingsModal.classList.remove('open');
      els.joinCodeInput.value = '';
      els.joinCodeError.style.display = 'none';
      clearFieldInvalid(els.joinCodeInputWrap);
      els.joinCodeModal.classList.add('open');
      // Synchronous, same tick as the click - see the identical comment on
      // showLauncherJoinPanel(). The modal itself is never display:none
      // (just opacity/pointer-events toggled - see .modal in style.css),
      // so the input is already focusable right now, before its fade-in
      // transition even starts.
      els.joinCodeInput.focus();
    });
    els.joinCodeCancelBtn.addEventListener('click', function(){
      els.joinCodeModal.classList.remove('open');
      els.settingsModal.classList.add('open');
    });
    function attemptJoinCode(){
      var code = els.joinCodeInput.value.trim();
      if (!/^[0-9]{3}$/.test(code)){
        els.joinCodeError.textContent = 'Skriv inn en gyldig tresifret kode.';
        els.joinCodeError.style.display = '';
        markFieldInvalid(els.joinCodeInputWrap);
        shakeElement(els.joinCodeModal.querySelector('.modal-card'));
        return;
      }
      joinSession(code, function(){
        // Only on success - see the identical comment on submitLauncherJoin().
        els.joinCodeInput.blur();
        els.joinCodeModal.classList.remove('open');
        if (state.players.length === 0){
          if (canEdit()) openSettings(true, true);
          else { renderAll(); showJoinedEmptyReadOnlyNotice(); }
        } else {
          // A device that was empty before this join (e.g. its very first
          // ever launch) auto-opens settings at boot, before the join even
          // happens (see init()'s "else if players.length===0" branch) -
          // that stays open (just invisibly, behind the launcher) unless
          // explicitly closed here, so it was still sitting on top - with
          // its now-stale empty fields - once the real joined match loaded
          // underneath and the launcher faded away.
          els.settingsModal.classList.remove('open');
          renderAll();
        }
      }, function(){
        els.joinCodeError.textContent = 'Fant ingen økt med den koden.';
        els.joinCodeError.style.display = '';
        markFieldInvalid(els.joinCodeInputWrap);
        shakeElement(els.joinCodeModal.querySelector('.modal-card'));
        // Wrong/non-existent code - clear the digits so the next attempt
        // starts fresh instead of the person having to select-all/backspace
        // three wrong digits before retyping.
        els.joinCodeInput.value = '';
      });
    }
    els.joinCodeInput.addEventListener('input', function(){
      els.joinCodeError.style.display = 'none';
      clearFieldInvalid(els.joinCodeInputWrap);
      // Auto-advance the moment the 3rd digit lands - a 3-digit code has
      // nothing left to type, so waiting for an explicit OK tap is just an
      // extra step. Only real 3-digit input triggers this (not e.g. a
      // paste that already failed the regex elsewhere).
      if (/^[0-9]{3}$/.test(els.joinCodeInput.value.trim())) attemptJoinCode();
    });
    els.joinCodeConfirmBtn.addEventListener('click', attemptJoinCode);
    els.sessionCodeBar.addEventListener('click', function(){
      if (!sessionCode) return;
      if (navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(sessionCode).catch(function(){});
      }
    });

    // Unlock audio on the very first tap anywhere, not just Play/Pause - a
    // device that joins a session already running (and only ever drags/taps
    // players to swap) would otherwise never get an unlocked AudioContext
    // and silently never beep on time-up.
    document.addEventListener('pointerdown', ensureAudioUnlocked, { once: true });

    function enterAppFromLauncher(){
      closeLauncherChoice();
      els.launcherTile.classList.add('lifted');
      setTimeout(function(){
        els.launcherScreen.classList.add('hidden');
      }, 500);
    }

    var newSessionConfirm = createConfirmArm({
      armedEls: [els.newSessionWrap, els.newSessionChoiceBtn],
      shakeEls: [els.newSessionWrap],
      labelEl: els.newSessionChoiceBtn,
      restingLabel: 'Ny økt',
      onArm: function(){
        els.newSessionDivider.hidden = false;
        els.newSessionCancelBtn.hidden = false;
      },
      onDisarm: function(){
        els.newSessionDivider.hidden = true;
        els.newSessionCancelBtn.hidden = true;
      }
    });
    els.newSessionCancelBtn.addEventListener('click', function(){ newSessionConfirm.disarm(); });

    // Re-run every time the choice panel is (re)shown - not just on the
    // very first launcher visit - so "Fortsett fra forrige økt" only
    // appears when there's an actual team to go back to, and "Ny økt"
    // picks up whichever of the two is the more likely tap right now.
    function showLauncherChoicePanel(){
      els.launcherChoicePanelChoice.hidden = false;
      els.launcherChoicePanelJoin.hidden = true;
      newSessionConfirm.disarm();
      var hasSession = state.players.length > 0;
      els.continueSessionChoiceBtn.hidden = !hasSession;
      els.continueSessionChoiceBtn.classList.toggle('primary', hasSession);
      els.newSessionChoiceBtn.classList.toggle('primary', !hasSession);
    }

    function showLauncherJoinPanel(){
      els.launcherChoicePanelChoice.hidden = true;
      els.launcherChoicePanelJoin.hidden = false;
      els.launcherJoinInput.value = '';
      els.launcherJoinError.hidden = true;
      clearFieldInvalid(els.launcherJoinInputWrap);
      // Focused synchronously, in the same tick as the click that got us
      // here - not via setTimeout. iOS Safari only pops the keyboard up
      // automatically for a focus() call it can trace directly back to a
      // user gesture; deferring it even by a few ms (a timeout, a promise
      // tick) breaks that chain and the field just sits focused with no
      // keyboard, forcing a second, redundant tap.
      els.launcherJoinInput.focus();
    }

    function openLauncherChoice(){
      showLauncherChoicePanel();
      els.launcherChoiceOverlay.classList.add('open');
    }

    function closeLauncherChoice(){
      els.launcherChoiceOverlay.classList.remove('open');
      newSessionConfirm.disarm();
    }

    function submitLauncherJoin(){
      var code = els.launcherJoinInput.value.trim();
      if (!/^[0-9]{3}$/.test(code)){
        els.launcherJoinError.textContent = 'Skriv inn en gyldig tresifret kode.';
        els.launcherJoinError.hidden = false;
        markFieldInvalid(els.launcherJoinInputWrap);
        shakeElement(els.launcherChoiceOverlay);
        return;
      }
      joinSession(code, function(){
        // Only on success - a wrong code keeps the keyboard up so the
        // retry (see the cleared input below) doesn't need a re-tap first.
        // iOS never dismisses a numeric keypad on its own just because the
        // field it belongs to scrolls out of view/behind another screen.
        els.launcherJoinInput.blur();
        enterAppFromLauncher();
        if (state.players.length === 0){
          if (canEdit()) openSettings(true, true);
          else { renderAll(); showJoinedEmptyReadOnlyNotice(); }
        } else {
          // See the identical comment in joinCodeConfirmBtn's handler - a
          // device that was empty before this join auto-opened settings at
          // boot (invisibly, behind the launcher); close it explicitly or
          // it's still sitting on top, showing stale empty fields, once the
          // real joined match loads underneath and the launcher fades away.
          els.settingsModal.classList.remove('open');
          renderAll();
        }
      }, function(){
        els.launcherJoinError.textContent = 'Fant ingen økt med den koden.';
        els.launcherJoinError.hidden = false;
        markFieldInvalid(els.launcherJoinInputWrap);
        shakeElement(els.launcherChoiceOverlay);
        // Wrong/non-existent code - clear the digits so the next attempt
        // starts fresh instead of having to clear three wrong digits first.
        els.launcherJoinInput.value = '';
      });
    }

    // The choice popup now opens on every tap of the tile (not just the
    // first visit this page-load), so returning from "Gå tilbake til
    // hovedmeny" always offers all three options again.
    els.launcherTile.addEventListener('click', function(){
      openLauncherChoice();
    });
    // The popup is nested inside .launcher-tile (so it can inherit the
    // tile's exact bounds/rounded corners for free) - without this, any
    // click inside it would bubble up and re-trigger the tile's own
    // click handler above.
    els.launcherChoiceOverlay.addEventListener('click', function(e){ e.stopPropagation(); });
    els.continueSessionChoiceBtn.addEventListener('click', enterAppFromLauncher);
    // "Ny økt" discards the current team/match when there is one, so it
    // needs the same press-again-to-confirm pattern as "Avslutt og
    // nullstill" - with nothing to lose (a genuinely fresh app, or a
    // roster that was set up but never actually played), it just proceeds
    // straight in, same as "Fortsett" would.
    els.newSessionChoiceBtn.addEventListener('click', function(){
      // A slave detaches from someone else's shared session before starting
      // their own fresh one - resetMatch() below still pushes to whatever
      // sessionCode is current, and a slave should never be able to wipe
      // the master's session data just by tapping "Ny økt" (see isMaster()).
      if (!isMaster() && sessionCode) leaveSession();
      if (state.players.length === 0){
        enterAppFromLauncher();
        openSettings(true);
        return;
      }
      if (!state.globalRunning && matchClockElapsed(Date.now()) === 0){
        // A team exists but the match clock has never run - nothing about
        // an actual match to lose, so skip the confirm-shake below (same
        // reasoning as the empty-roster case above).
        newSessionConfirm.disarm();
        resetMatch();
        enterAppFromLauncher();
        return;
      }
      if (!newSessionConfirm.press()) return; // just armed - wait for the second press
      // Close the glass popup itself before the save-prompt opens - it's a
      // z-index:5 overlay nested in .launcher-tile, well below a .modal's
      // z-index:100, but left "open" it still visually doubles up behind
      // the prompt and (worse) can eat its taps.
      closeLauncherChoice();
      askSaveToHistory(function(saveToHistory){
        archiveInProgressMatch(saveToHistory);
        resetMatch();
        enterAppFromLauncher();
      });
    });
    els.joinSessionChoiceBtn.addEventListener('click', showLauncherJoinPanel);
    els.launcherChoiceCancelBtn.addEventListener('click', closeLauncherChoice);
    els.launcherChoiceBackBtn.addEventListener('click', showLauncherChoicePanel);
    els.launcherJoinInput.addEventListener('input', function(){
      els.launcherJoinError.hidden = true;
      clearFieldInvalid(els.launcherJoinInputWrap);
      // Auto-advance the moment the 3rd digit lands - see the identical
      // comment on joinCodeInput's handler.
      if (/^[0-9]{3}$/.test(els.launcherJoinInput.value.trim())) submitLauncherJoin();
    });
    els.launcherJoinInput.addEventListener('keydown', function(e){
      if (e.key === 'Enter') submitLauncherJoin();
    });
    els.launcherJoinEnterBtn.addEventListener('click', submitLauncherJoin);

    initCoinFlip();
    initAccountAndSettings();

    updateFrameFit();
    applyRealViewportHeight();
    renderPitchMarkings();
    requestWakeLock();
    window.addEventListener('resize', function(){ updateFrameFit(); applyRealViewportHeight(); renderPitchMarkings(); });
    window.addEventListener('orientationchange', function(){ updateFrameFit(); applyRealViewportHeight(); renderPitchMarkings(); });
    if (window.visualViewport){
      // #viewport-frame/#app re-measure their height here too now (see
      // applyRealViewportHeight), and renderPitchMarkings() reads
      // #field-wrap's rendered box as a one-off snapshot each call - both
      // re-run whenever Safari's chrome settles so neither is left drawn
      // against a still-short box.
      window.visualViewport.addEventListener('resize', function(){ applyRealViewportHeight(); renderPitchMarkings(); });
    }
    // Same reasoning as above, in case the very first measurement (on
    // load) was still mid-settle - cheap, and harmless if not needed.
    setTimeout(function(){ applyRealViewportHeight(); renderPitchMarkings(); }, 400);
    if (window.ResizeObserver){
      new ResizeObserver(function(){ renderPitchMarkings(); }).observe(els.fieldWrap);
    }

    try { sessionCode = localStorage.getItem(SESSION_CODE_KEY); } catch(e){ sessionCode = null; }

    function stampLastAlive(){
      try { localStorage.setItem(LAST_ALIVE_KEY, String(Date.now())); } catch(e){}
    }

    function finishStartup(){
      checkIdleAutoPause(); // covers "app was fully closed and reopened after a long gap"
      checkLongIdleSuggestion();
      stampLastAlive();
      setInterval(updateTimersOnly, 250);
      // Local-only: this used to call saveState() (which also pushes to
      // Supabase) unconditionally every 8s. In a shared session that's a
      // last-write-wins race waiting to happen - if this fires on one
      // device just after another device pushed a real edit (a goal, a
      // substitution) but before the realtime update for it has arrived
      // locally, this device's still-stale `state` overwrites that edit
      // on the server, which then broadcasts the stale state back out and
      // makes the edit vanish everywhere. Every real mutation already
      // calls saveState() itself right after changing `state`, so this
      // heartbeat only needs to keep localStorage/LAST_ALIVE_KEY fresh.
      setInterval(function(){ saveStateLocally(); stampLastAlive(); }, 8000);
      document.addEventListener('visibilitychange', function(){
        if (document.hidden){
          flushState();
        } else {
          checkIdleAutoPause(); // covers "tab/app was backgrounded for a long gap, then resumed"
          checkLongIdleSuggestion();
          stampLastAlive();
          updateTimersOnly();
          requestWakeLock();
        }
      });
    }

    if (sessionCode && sb){
      updateSessionCodeUI();
      sb.from('sessions').select('*').eq('code', sessionCode).maybeSingle().then(function(res){
        if (res && !res.error && res.data){
          var wasMaster = isMaster();
          var normalized = normalizeState(res.data.data);
          if (!normalized){
            console.warn('Lagret økt inneholdt ugyldig data, fortsetter med lokal tilstand');
          } else if (!isNewerRevision(normalized)){
            // This device's own local copy (from localStorage, e.g. an edit
            // made just before the app closed) is already at least as new
            // as what the server has - keep it rather than regressing to
            // the server's older row. subscribeToSession()'s reconnect
            // catch-up push just below will bring the server up to date.
            console.warn('Beholder lokal tilstand, server-kopien var ikke nyere (rev ' + normalized.rev + ' < ' + state.rev + ')');
          } else {
            state = normalized;
            if (ensureParticipant()) pushRemoteState();
            if (!wasMaster && isMaster()) showOwnerTransferredNotice();
            saveStateLocally();
            resyncTimeUpNotified();
          }
          subscribeToSession(sessionCode);
        } else if (res && !res.error && !res.data){
          // Session no longer exists server-side (e.g. deleted/cleaned up) -
          // stop pretending we're synced, so pushRemoteState() silently
          // no-op'ing against a missing row doesn't mask that changes
          // aren't reaching anyone else.
          sessionCode = null;
          try { localStorage.removeItem(SESSION_CODE_KEY); } catch(e){}
          updateSessionCodeUI();
        } else {
          subscribeToSession(sessionCode);
        }
        if (state.players.length === 0){ if (canEdit()) openSettings(true); else renderAll(); } else { renderAll(); }
        finishStartup();
      }).catch(function(){
        subscribeToSession(sessionCode);
        if (state.players.length === 0){ if (canEdit()) openSettings(true); else renderAll(); } else { renderAll(); }
        finishStartup();
      });
    } else if (state.players.length === 0){
      openSettings(true);
      finishStartup();
    } else {
      renderAll();
      finishStartup();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
