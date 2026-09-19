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
   * @typedef {Object} MatchHistoryEntry
   * @property {string} id
   * @property {string} opponentName
   * @property {string} opponentAbbr
   * @property {number} homeScore
   * @property {number} awayScore
   * @property {number} endedAt
   * @property {Object<string, number>} playerMs
   *
   * @typedef {Object} HistoryPlayerEntry
   * @property {string} id
   * @property {string} name
   * @property {number} ms
   * @property {number} goals
   *
   * @typedef {Object} HistoryMatchEntry
   * @property {string} id
   * @property {number} endedAt
   * @property {string} opponentName
   * @property {string} opponentAbbr
   * @property {number} homeScore
   * @property {number} awayScore
   * @property {HistoryPlayerEntry[]} players
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
   * @property {boolean} globalRunning
   * @property {number} defaultDurationMs
   * @property {number} matchDurationMs
   * @property {boolean} rankByCumulative
   * @property {boolean} shareEditable
   * @property {string|null} sessionOwnerDeviceId
   * @property {Participant[]} participants
   * @property {GoalEntry[]} goalLog
   * @property {number} lastActivityAt
   * @property {string} opponentName
   * @property {string} opponentAbbr
   * @property {MatchHistoryEntry[]} matchHistory
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

  var STORAGE_KEY = 'spillerbytte_v4';
  var ROSTER_KEY = 'spillerbytte_roster_v1';
  var HISTORY_KEY = 'spillerbytte_history_v1';
  var HISTORY_SAVE_ENABLED_KEY = 'spillerbytte_history_enabled_v1';
  // 5 years, not 365 days - this is a local JSON array of tiny records (a
  // few KB even after a whole season), so there's no real storage pressure
  // pushing toward aggressive pruning. Kept short-ish rather than "forever"
  // only so a years-abandoned install doesn't accumulate without any cap.
  // Unrelated to the 60-day SERVER-side cleanup (see keep-supabase-alive.yml)
  // - that one frees up session codes in Supabase and never touches this
  // local archive at all.
  var HISTORY_MAX_AGE_MS = 5 * 365 * 24 * 60 * 60 * 1000;
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
  var APP_VERSION = '1.9.6';
  var UPDATE_ATTEMPT_KEY = 'spillerbytte_update_attempt_v1';

  // Changelog shown in #versionHistoryModal (tapped from the short "vX.Y"
  // footer on the launcher) - newest first, one entry per version bump.
  // Keep each note short (roughly 10-15 words); it's a footnote, not
  // release notes.
  var VERSION_HISTORY = [
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
  /** @type {string[]} */
  var roster = []; // remembered player names, alphabetical
  /** @type {AppState[]} */
  var undoStack = []; // snapshots, oldest first; capped at UNDO_MAX
  /** @type {AppState[]} */
  var redoStack = []; // snapshots stepped back past via undo, oldest first; capped at UNDO_MAX
  var UNDO_MAX = 3;
  var newSessionConfirmArmed = false; // "Ny økt" needs a second press to confirm when there's already a session to discard - see disarmNewSessionConfirm()
  var newSessionConfirmTimer = /** @type {ReturnType<typeof setTimeout>|undefined} */ (undefined);
  var NEW_SESSION_LABEL = 'Ny økt';
  var NEW_SESSION_CONFIRM_LABEL = 'Trykk igjen for å bekrefte';
  var settingsDirty = false; // true once anything that only takes effect on "OK" (names, kampvarighet, byttetid, first-run feltstørrelse) has been touched since openSettings() - drives the × close button's "save changes?" prompt
  /** @type {Object<string, boolean>} */
  var timeUpNotified = {}; // id -> true once the expiry sound has fired for their current stint
  var multiMode = false; // bulk "send several bench players to field" mode
  /** @type {string[]} */
  var multiSelected = []; // ids currently checked while in multiMode
  var OVERTIME_FACTOR = 1.5; // the red, gently-pulsing badge kicks in once elapsed reaches this multiple of byttetiden (defaultDurationMs) - the orange, still badge covers everything from byttetiden itself up to that point

  // Explanations shown by the small "i" info buttons in settings, keyed by
  // their data-info attribute.
  var INFO_TEXTS = {
    byttetid: {
      title: 'Standard byttetid',
      text: 'Tiden en utespiller skal spille før et oransje byttemerke (⇅) varsler at byttetiden er nådd. Spiller de 50% lenger enn byttetiden, begynner merket å pulsere forsiktig. Klokka fortsetter å telle etter det - spilleren byttes ikke automatisk ut.'
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
      title: 'Kumulert tidsberegning',
      text: 'AV: Trekantene som viser mest/minst spilletid tar kun hensyn til inneværende kamp. PÅ: trekantene tar hensyn til kumulert spilletid på tvers av kamper, siden siste nullstilling (Avslutt og nullstill).'
    },
    endPeriod: {
      title: 'Kampslutt',
      text: 'Avslutter denne perioden, men beholder laget og de kumulerte tallene til neste periode eller kamp.'
    },
    endReset: {
      title: 'Avslutt og nullstill',
      text: 'Starter helt på nytt - nullstiller spilletid, mål og kamptelling for alle. Krever et andre trykk for å bekrefte.'
    },
    leaveMatch: {
      title: 'Forlat kampen',
      text: 'Går til hjemskjermen, akkurat som tilbake-pilen øverst til venstre. Rører ingenting - kampen fortsetter nøyaktig som den er, og "Fortsett" fra hjemskjermen henter deg rett tilbake. Deler du økten med andre, er du fortsatt med i den i bakgrunnen; bruk "Forlat delt økt" under om du faktisk vil koble fra den.'
    },
    closeSession: {
      title: 'Forlat delt økt',
      text: 'Kobler denne enheten fra den delte økten for godt - kampen selv rører ingenting. Om du ikke er økt-eier fortsetter kampen som normalt for de andre. Er du økt-eier og noen andre er med, overføres økten til dem; er du alene, forblir kampen som den er til du fortsetter den igjen fra hjemskjermen.'
    },
    historySave: {
      title: 'Lagre kamper til historikk',
      text: 'Når dette er på, lagres motstander, resultat og spilletid per spiller til "Historikk" på hjemskjermen hver gang du trykker Kampslutt. Av som standard - skrur du den på, gjelder det fra neste Kampslutt, ikke bakover i tid. Lagres kun lokalt på denne enheten, ikke i den delte økten.'
    }
  };
  var resetConfirmArmed = false; // "Avslutt og nullstill" needs a second press to confirm
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  var resetConfirmTimer; // clearTimeout(undefined) is a safe no-op, same as our old null check
  var RESET_LABEL = 'Avslutt og nullstill';
  var RESET_CONFIRM_LABEL = 'Trykk igjen for å bekrefte';
  var transferOwnerConfirmArmed = false; // "Overfør økt-eier" needs a second press to confirm
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  var transferOwnerConfirmTimer;
  var TRANSFER_OWNER_LABEL = '🔁 Overfør økt-eier';
  var TRANSFER_OWNER_CONFIRM_LABEL = 'Trykk igjen for å bekrefte';
  /** @type {AudioContext|null} */
  var audioCtx = null;
  var els = {};

  function qs(id){ return document.getElementById(id); }

  function uid(){
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  /** @returns {AppState} */
  function defaultState(){
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
      fieldSize: 3,
      globalRunning: false,
      defaultDurationMs: 180000,
      matchDurationMs: 1200000,
      rankByCumulative: false,
      shareEditable: true,
      sessionOwnerDeviceId: null,
      participants: [],
      goalLog: [],
      lastActivityAt: Date.now(),
      opponentName: '',
      opponentAbbr: '',
      matchHistory: []
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
    if (typeof raw.defaultDurationMs !== 'number' || raw.defaultDurationMs <= 0) raw.defaultDurationMs = 180000;
    if (typeof raw.matchDurationMs !== 'number' || raw.matchDurationMs <= 0) raw.matchDurationMs = 1200000;
    if (raw.globalRunning === undefined) raw.globalRunning = false;
    if (raw.rankByCumulative === undefined) raw.rankByCumulative = false;
    if (raw.shareEditable === undefined) raw.shareEditable = true;
    if (raw.sessionOwnerDeviceId === undefined) raw.sessionOwnerDeviceId = null;
    if (!Array.isArray(raw.participants)) raw.participants = [];
    if (!Array.isArray(raw.goalLog)) raw.goalLog = [];
    if (typeof raw.lastActivityAt !== 'number') raw.lastActivityAt = Date.now();
    if (typeof raw.opponentName !== 'string') raw.opponentName = '';
    if (typeof raw.opponentAbbr !== 'string') raw.opponentAbbr = '';
    if (!Array.isArray(raw.matchHistory)) raw.matchHistory = [];
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
    pushRemoteState();
  }

  function pushRemoteState(){
    if (!sessionCode || !sb) return;
    sb.from('sessions')
      .update({ data: state, origin: deviceOrigin, updated_at: new Date().toISOString() })
      .eq('code', sessionCode)
      .then(function(res){
        if (res && res.error) console.warn('Kunne ikke synkronisere', res.error);
      });
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
          var wasMaster = isMaster();
          var normalized = normalizeState(payload.new.data);
          if (!normalized){ console.warn('Mottok ugyldig delt tilstand fra økt, ignorerer'); return; }
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
        if (realtimeSubscribed) pushRemoteState(); // catch up on anything queued while disconnected
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

  // Persistent, local, cross-session record of finished matches (see
  // "Historikk" on the launcher) - deliberately separate from
  // state.matchHistory (which is synced shared-session state, wiped by
  // resetMatch()). Like ROSTER_KEY above, this is per-device and never
  // synced: a season's worth of match history isn't something the current
  // Supabase sync model (one row per active session) has any natural home
  // for, and making it shared would mean deciding whose copy wins across
  // devices for something that's really just personal record-keeping.
  /** @returns {HistoryMatchEntry[]} */
  function loadHistoryArchive(){
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch(e){ console.warn('Kunne ikke lese historikk', e); return []; }
  }

  /** @param {HistoryMatchEntry[]} list */
  function saveHistoryArchive(list){
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); }
    catch(e){ console.warn('Kunne ikke lagre historikk', e); }
  }

  /** @param {HistoryMatchEntry} entry */
  function archiveMatchToHistory(entry){
    var list = loadHistoryArchive();
    list.push(entry);
    saveHistoryArchive(list);
  }

  // Off by default - a local, per-device preference (see the "Lagre kamper
  // til historikk" toggle in settings), not part of synced state: it only
  // governs whether THIS device writes to its own archive whenever it
  // happens to be the one that presses Kampslutt.
  function isHistorySaveEnabled(){
    try { return localStorage.getItem(HISTORY_SAVE_ENABLED_KEY) === '1'; }
    catch(e){ return false; }
  }
  /** @param {boolean} enabled */
  function setHistorySaveEnabled(enabled){
    try { localStorage.setItem(HISTORY_SAVE_ENABLED_KEY, enabled ? '1' : '0'); } catch(e){}
  }

  // Called once per app load (see finishStartup()) - drops anything past
  // the announced 5-year retention (see the note in the Historikk screen)
  // so the local archive doesn't grow forever. Returns the pruned list so
  // callers that need it right away don't have to re-read localStorage.
  /** @returns {HistoryMatchEntry[]} */
  function pruneHistoryArchive(){
    var list = loadHistoryArchive();
    var cutoff = Date.now() - HISTORY_MAX_AGE_MS;
    var kept = list.filter(function(m){ return m.endedAt >= cutoff; });
    if (kept.length !== list.length) saveHistoryArchive(kept);
    return kept;
  }

  /** @param {string[]} ids */
  function deleteHistoryEntries(ids){
    var idSet = {};
    ids.forEach(function(id){ idSet[id] = true; });
    saveHistoryArchive(loadHistoryArchive().filter(function(m){ return !idSet[m.id]; }));
    historySelected = {};
    historyDeleteArmedId = null;
  }

  /** @param {number} ts @returns {string} */
  function formatHistoryDate(ts){
    return new Date(ts).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
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

  function renderHistoryList(){
    var list = loadHistoryArchive().slice().sort(function(a,b){ return b.endedAt - a.endedAt; });
    els.historyEmpty.hidden = list.length > 0;
    els.historySelectModeBtn.hidden = list.length === 0;
    if (list.length === 0){
      els.historyList.innerHTML = '';
      els.historySelectBar.hidden = true;
      return;
    }
    els.historyList.innerHTML = list.map(function(m){
      var selected = !!historySelected[m.id];
      var expanded = historyExpandedId === m.id;
      var armed = historyDeleteArmedId === m.id;
      var opponent = m.opponentName || (m.opponentAbbr ? m.opponentAbbr : 'Ukjent motstander');
      var players = (m.players || []).slice().sort(function(a,b){ return b.ms - a.ms; });
      var playerRows = players.map(function(p){
        return '<div class="history-row-player">' +
          '<span class="history-row-player-name">' + escapeHtml(p.name) + (p.goals > 0 ? ' (' + p.goals + ' mål)' : '') + '</span>' +
          '<span class="history-row-player-stats">' + formatCumulative(p.ms) + '</span>' +
        '</div>';
      }).join('') || '<div class="history-row-player"><span class="history-row-player-name">Ingen spillerdata registrert.</span></div>';
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
            '<button type="button" class="history-row-delete' + (armed ? ' armed' : '') + '" aria-label="Slett kamp">🗑</button>' +
            '<span class="history-row-chevron" aria-hidden="true">⌄</span>') +
        '</div>' +
        (historySelectMode ? '' : '<div class="history-row-detail"' + (expanded ? '' : ' hidden') + '>' + playerRows + '</div>') +
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
      var delBtn = row.querySelector('.history-row-delete');
      if (delBtn){
        delBtn.addEventListener('click', function(e){
          e.stopPropagation(); // don't also toggle the row's own expand/collapse
          if (historyDeleteArmedId === id){
            deleteHistoryEntries([id]);
            renderHistoryList();
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

  function openHistoryScreen(){
    historySelectMode = false;
    historySelected = {};
    historyExpandedId = null;
    historyDeleteArmedId = null;
    els.historySelectModeBtn.textContent = 'Velg flere';
    els.historySelectModeBtn.classList.remove('active');
    renderHistoryList();
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
      wakeLockEnabled: !!state.wakeLockEnabled,
      rankByCumulative: !!state.rankByCumulative,
      shareEditable: !!state.shareEditable,
      sessionOwnerDeviceId: state.sessionOwnerDeviceId,
      participants: cloneStateValue(state.participants || []),
      goalLog: cloneStateValue(state.goalLog || []),
      lastActivityAt: state.lastActivityAt,
      opponentName: state.opponentName || '',
      opponentAbbr: state.opponentAbbr || '',
      matchHistory: cloneStateValue(state.matchHistory || [])
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
    state.wakeLockEnabled = snap.wakeLockEnabled !== undefined ? !!snap.wakeLockEnabled : state.wakeLockEnabled;
    state.rankByCumulative = snap.rankByCumulative !== undefined ? !!snap.rankByCumulative : state.rankByCumulative;
    state.shareEditable = snap.shareEditable !== undefined ? !!snap.shareEditable : state.shareEditable;
    state.sessionOwnerDeviceId = snap.sessionOwnerDeviceId !== undefined ? snap.sessionOwnerDeviceId : state.sessionOwnerDeviceId;
    state.participants = cloneStateValue(snap.participants || state.participants || []);
    state.goalLog = cloneStateValue(snap.goalLog || []);
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
  function applyFieldDensity(){
    var fs = state.fieldSize || 3;
    var t;
    if (fs <= 5)      t = { avatar:68, avatarFont:19, token:96, label:15, labelW:96, timer:16, badge:23, badgeFont:14 };
    else if (fs <= 7) t = { avatar:58, avatarFont:17, token:84, label:13, labelW:84, timer:14, badge:20, badgeFont:13 };
    else if (fs <= 9) t = { avatar:50, avatarFont:15, token:74, label:12, labelW:74, timer:13, badge:18, badgeFont:12 };
    else              t = { avatar:44, avatarFont:14, token:66, label:11, labelW:66, timer:12, badge:16, badgeFont:11 };
    var s = document.documentElement.style;
    s.setProperty('--field-avatar-size', t.avatar + 'px');
    s.setProperty('--field-avatar-font', t.avatarFont + 'px');
    s.setProperty('--field-token-width', t.token + 'px');
    s.setProperty('--field-label-font', t.label + 'px');
    s.setProperty('--field-label-max-w', t.labelW + 'px');
    s.setProperty('--field-timer-font', t.timer + 'px');
    s.setProperty('--field-badge-size', t.badge + 'px');
    s.setProperty('--field-badge-font', t.badgeFont + 'px');
  }

  // Once the field avatar is too small to comfortably show two letters,
  // fall back to one - same density tiers as applyFieldDensity (the 50px
  // and 44px avatar sizes).
  function fieldUsesSingleLetter(){
    return (state.fieldSize || 3) >= 8;
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

  function renderGoalPlayerList(){
    var goalBadges = computeGoalBadges();
    var singleLetter = fieldUsesSingleLetter();
    var rows = state.players.slice();
    if (goalPlayerMode === 'view'){
      rows = rows.filter(function(p){ return (goalBadges.counts[p.id] || 0) > 0; });
      rows.sort(function(a,b){ return (goalBadges.counts[b.id] || 0) - (goalBadges.counts[a.id] || 0); });
    }
    if (rows.length === 0){
      els.goalPlayerList.innerHTML = '<p class="goal-player-empty">Ingen mål registrert ennå.</p>';
      return;
    }
    var interactive = goalPlayerMode !== 'view';
    var tag = interactive ? 'button' : 'div';
    els.goalPlayerList.innerHTML = rows.map(function(p){
      var n = goalBadges.counts[p.id] || 0;
      var disabled = goalPlayerMode === 'remove' && n === 0;
      var openTag = '<' + tag + ' class="goal-player-row"' +
        (interactive ? ' type="button" data-id="' + p.id + '"' + (disabled ? ' disabled' : '') : '') + '>';
      return openTag +
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

  function renderField(){
    Array.prototype.forEach.call(els.field.querySelectorAll('.token'), function(n){ n.remove(); });
    var now = Date.now();
    var rankBadges = computeRankBadges(now);
    var goalBadges = computeGoalBadges();
    var singleLetter = fieldUsesSingleLetter();
    var sorted = state.onField.filter(function(id, i){ return state.onField.indexOf(id) === i; }).sort(function(a,b){
      var diff = fieldElapsed(a, now) - fieldElapsed(b, now);
      if (diff !== 0) return diff;
      var pa = playerById(a), pb = playerById(b);
      if (!pa || !pb) return 0;
      return pa.name.localeCompare(pb.name, 'nb');
    });
    sorted.forEach(function(id){
      var p = playerById(id);
      if (!p) return;
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
      els.field.appendChild(el);
    });
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

  function updateSelectionInfo(){
    if (!selected){
      els.selectionInfo.classList.remove('visible');
      return;
    }
    var p = playerById(selected.id);
    if (!p){
      els.selectionInfo.classList.remove('visible');
      return;
    }
    var now = Date.now();
    var fieldMs = cumulativeFieldMs(selected.id, now);
    var benchMs = cumulativeBenchMs(selected.id, now);
    els.selectionInfo.innerHTML =
      '<div class="si-name">' + escapeHtml(p.name) + '</div>' +
      '<div class="si-stats">Spillertid ' + formatCumulative(fieldMs) +
        '<span class="si-sep">·</span>Innbyttertid ' + formatCumulative(benchMs) +
      '</div>';
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

  // "Forslag" - marks (doesn't auto-perform) the swap computeSwapSuggestion()
  // recommends, by driving the exact same selected+tap-to-confirm mechanism
  // as a manual tap - see handleTap(). Shakes when multi-select mode is on
  // (the two flows don't mix) or no suggestion is currently available.
  function onSwapSuggestionBtnClick(){
    if (!canEdit() || multiMode){ shakeElement(els.swapSuggestionBtn); return; }
    var suggestion = computeSwapSuggestion(Date.now());
    if (!suggestion){ shakeElement(els.swapSuggestionBtn); return; }
    selected = { id: suggestion.fieldId, zone: 'field' };
    suggestedPartnerId = suggestion.benchId;
    applySelectionStyles();
  }

  function onMultiSelectBtnClick(){
    if (!canEdit()) return;
    if (!multiMode){
      multiMode = true;
      multiSelected = [];
      selected = null;
      suggestedPartnerId = null;
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
          isValidTarget = (zone === 'field' && overIsBench) || (zone === 'bench' && overIsField);
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
    applySelectionStyles();

    // Dropped directly on top of another player -> swap with them
    // specifically. field-onto-bench or bench-onto-field pairs swap;
    // dropping on a token in the SAME zone (bench-on-bench, field-on-field)
    // is invalid - falls through to the reject path below like any other
    // no-op drop.
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

  // A row counts as "blank" (safe to auto-add/auto-trim) only if it's an
  // ordinary editable row with nothing typed in it - a locked row (a
  // player currently on the field) never counts, even though its input
  // can't be edited here.
  /** @param {HTMLElement} row @returns {boolean} */
  function isBlankRow(row){
    if (row.classList.contains('field-locked')) return false;
    var input = /** @type {HTMLInputElement|null} */ (row.querySelector('input'));
    return !!input && !input.value.trim();
  }

  /** @param {HTMLElement} row */
  function fadeOutRow(row){
    row.classList.add('name-row-exit');
    setTimeout(function(){ row.remove(); }, 300);
  }

  // Keeps the name list self-managing, replacing the old fixed 5/8/10
  // ladder and the "+ Legg til spiller" button entirely:
  //  - never fewer than fieldSize+1 rows total (a full XI plus one sub -
  //    the practical minimum to actually run a match)
  //  - always exactly 2 blank rows available at the tail, so there's
  //    always room to type the next name without any extra step - a new
  //    one fades in the moment the second-to-last blank is filled, and
  //    spares fade back out if a name is deleted and leaves too many.
  // Called after anything that could change the count: a name field
  // losing focus, a row being deleted, or (first-run only, before "Antall
  // utespillere" locks) the field size changing.
  function syncNameRows(){
    var fieldSize = Math.max(1, Math.min(11, parseInt(els.fieldSizeInput.value, 10) || state.fieldSize || 3));
    var floor = fieldSize + 1;
    var rows = Array.prototype.slice.call(els.nameRows.querySelectorAll('.name-row'));

    while (rows.length < floor){
      rows.push(addNameRow(null, '', rows.length + 1));
    }

    function trailingBlankCount(){
      var n = 0;
      for (var i = rows.length - 1; i >= 0 && isBlankRow(rows[i]); i--) n++;
      return n;
    }

    while (trailingBlankCount() > 2 && rows.length > floor){
      fadeOutRow(/** @type {HTMLElement} */ (rows.pop()));
    }
    while (trailingBlankCount() < 2){
      rows.push(addNameRow(null, '', rows.length + 1, false, true));
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
    syncNameRows(); // tops up to fieldSize+1 rows and the 2 trailing blanks

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
    // Purely local (see isHistorySaveEnabled) - never gated by canEdit()/
    // isMaster(), same reasoning as wakeLock: this doesn't touch shared
    // state at all, so a read-only viewer can freely toggle it for
    // themselves too.
    els.historySaveToggle.checked = isHistorySaveEnabled();
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

    disarmTransferOwnerConfirm();
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
    // 'locked' drives the grey styling for both reasons, but isBlankRow()
    // needs to tell them apart: a masterLocked row can still be an empty
    // trailing slot (syncNameRows must be able to count it as blank), while
    // a field-locked row never is. Without 'field-locked' as a separate
    // marker, a non-master device would see every trailing blank row report
    // as "not blank" and syncNameRows()'s trailingBlankCount() loop would
    // never reach its target - an infinite loop that freezes the tab (the
    // "settings crashes to a black screen" bug reported after joining a
    // session someone else owns).
    row.className = 'name-row' + (anyLocked ? ' locked' : '') + (locked ? ' field-locked' : '') + (fadeIn ? ' name-row-enter' : '');
    row.dataset.id = id || '';
    row.innerHTML =
      '<div class="name-input-wrap">' +
        '<input type="text" value="' + escapeHtml(name||'') + '" placeholder="Spiller ' + indexHint + '" autocomplete="off"' + (anyLocked ? ' disabled' : '') + '>' +
      '</div>' +
      (anyLocked
        ? '<span class="locked-row-note" title="' + (locked ? 'Utespillere kan ikke endres eller fjernes her mens de er på banen' : 'Kun økt-eieren kan endre spillernavn') + '">🔒</span>'
        : '<button type="button" class="removeRow" aria-label="Fjern"' + (name && name.trim() ? '' : ' style="display:none;"') + '>×</button>');
    els.nameRows.appendChild(row);
    var wrap = row.querySelector('.name-input-wrap');
    if (anyLocked) return row;
    var removeBtn = /** @type {HTMLElement} */ (row.querySelector('.removeRow'));
    var input = /** @type {HTMLInputElement} */ (row.querySelector('input'));
    removeBtn.addEventListener('click', function(){
      row.remove();
      syncNameRows();
      settingsDirty = true;
    });
    // A blank row manages itself (syncNameRows keeps exactly 2 spares) -
    // the remove button only makes sense once there's an actual name to
    // take back out.
    input.addEventListener('input', function(){
      clearFieldInvalid(wrap);
      removeBtn.style.display = input.value.trim() ? '' : 'none';
    });
    input.addEventListener('blur', syncNameRows);
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
    list.addEventListener('pointerdown', function(e){
      var item = /** @type {HTMLElement} */ (e.target).closest('.suggest-item');
      if (!item) return;
      e.preventDefault();
      input.value = item.textContent;
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

    els.coinTile.addEventListener('click', openCoinFlip);
    els.coinFlipCloseBtn.addEventListener('click', closeCoinFlip);
    els.historyTile.addEventListener('click', openHistoryScreen);
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
      var list = loadHistoryArchive();
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
      if (pendingHistoryDeleteIds){
        deleteHistoryEntries(pendingHistoryDeleteIds);
        pendingHistoryDeleteIds = null;
      }
      historySelectMode = false;
      els.historySelectModeBtn.textContent = 'Velg flere';
      els.historySelectModeBtn.classList.remove('active');
      renderHistoryList();
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
    rows.forEach(function(r){
      lines.push(r.name + ': ' + formatCumulative(r.fieldMs) + ' spilt, ' + formatCumulative(r.benchMs) + ' benk');
    });
    return lines.join('\n');
  }

  // Resets the "Avslutt og nullstill" double-press confirmation back to its
  // resting state - called whenever the Avslutt modal is (re)opened,
  // cancelled, or navigated away from, so a stale "trykk igjen" never lingers
  // into a later, unrelated visit to this modal.
  function disarmResetConfirm(){
    clearTimeout(resetConfirmTimer);
    resetConfirmArmed = false;
    els.endResetBtn.textContent = RESET_LABEL;
    els.endResetWrap.classList.remove('armed', 'shake-btn');
  }

  // Same double-press pattern as disarmResetConfirm(), for "Overfør
  // økt-eier" - called whenever settings is (re)opened so a stale "trykk
  // igjen" from a previous visit never lingers into this one.
  function disarmTransferOwnerConfirm(){
    clearTimeout(transferOwnerConfirmTimer);
    transferOwnerConfirmArmed = false;
    if (els.transferOwnerBtn){
      els.transferOwnerBtn.textContent = TRANSFER_OWNER_LABEL;
      els.transferOwnerBtn.classList.remove('armed', 'shake-btn');
    }
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

  function endMatchPeriod(reorganize){
    var now = Date.now();
    state.onField.forEach(function(id){ commitFieldStint(id, now); });
    state.onBench.forEach(function(id){ commitBenchStint(id, now); });

    // Archive this match before wiping its scoreboard - "Kampslutt" means
    // exactly that (a cup day is several separate matches back to back, not
    // halves of one match), so the goal tally must NOT carry over into the
    // next match either (see goalLog reset below - this used to be a bug:
    // goals kept accumulating across what the coach clearly meant as
    // separate matches). Read now, before periodStartCumulative moves its
    // baseline forward below, so it's each player's time in THIS match
    // specifically, not the running lifetime total.
    var homeScore = state.goalLog.filter(function(g){ return g.team === 'home'; }).length;
    var awayScore = state.goalLog.filter(function(g){ return g.team === 'away'; }).length;
    var playerMs = {};
    state.players.forEach(function(p){ playerMs[p.id] = currentPeriodFieldMs(p.id, now); });
    if (!Array.isArray(state.matchHistory)) state.matchHistory = [];
    state.matchHistory.push({
      id: uid(),
      opponentName: state.opponentName || '',
      opponentAbbr: state.opponentAbbr || '',
      homeScore: homeScore,
      awayScore: awayScore,
      endedAt: now,
      playerMs: playerMs
    });
    // Separate from the above: a persistent, local, cross-session archive
    // (see loadHistoryArchive()) for the "Historikk" tile - state.matchHistory
    // is synced shared-session state and gets wiped by resetMatch() same as
    // everything else, which is right for "this session's matches so far"
    // but wrong for a durable record the coach can look back on later.
    // Snapshots player NAMES (not just ids) so old entries stay meaningful
    // even after a player is later removed from the roster. Gated on the
    // "Lagre kamper til historikk" toggle (off by default) - a coach who
    // never turns it on should see zero rows silently pile up locally.
    if (isHistorySaveEnabled()){
      archiveMatchToHistory({
        id: uid(),
        endedAt: now,
        opponentName: state.opponentName || '',
        opponentAbbr: state.opponentAbbr || '',
        homeScore: homeScore,
        awayScore: awayScore,
        players: state.players.map(function(p){
          return {
            id: p.id,
            name: p.name,
            ms: playerMs[p.id] || 0,
            goals: state.goalLog.filter(function(g){ return g.team === 'home' && g.playerId === p.id; }).length
          };
        })
      });
    }
    state.goalLog = [];
    // Next match likely means a next opponent (cup format) - clearing this
    // brings the "?" back on the scoreboard and re-arms the opponent prompt
    // (see openOpponentModal's call sites) rather than silently keeping the
    // just-finished opponent's name on the new match.
    state.opponentName = '';
    state.opponentAbbr = '';

    if (reorganize){
      var all = state.players.map(function(p){
        return { id: p.id, ms: (state.cumulative[p.id] && state.cumulative[p.id].fieldMs) || 0 };
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
    undoStack = [];
    redoStack = [];
    timeUpNotified = {};
    multiMode = false;
    multiSelected = [];
    var keepDuration = state.defaultDurationMs;
    var keepMatchDuration = state.matchDurationMs;
    var keepWakeLock = state.wakeLockEnabled;
    var keepFieldSize = state.fieldSize;
    var keepRankByCumulative = state.rankByCumulative;
    // defaultState() sets these back to null/[] - losing sessionOwnerDeviceId
    // here would silently un-master the very device that's allowed to call
    // this function, locking everyone (including the real owner) out of
    // isMaster()-gated controls for the rest of the shared session.
    var keepOwnerDeviceId = state.sessionOwnerDeviceId;
    var keepParticipants = state.participants;
    state = defaultState();
    state.defaultDurationMs = keepDuration;
    state.matchDurationMs = keepMatchDuration;
    state.wakeLockEnabled = keepWakeLock;
    state.fieldSize = keepFieldSize;
    state.rankByCumulative = keepRankByCumulative;
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
    els.newSessionChoiceBtn = qs('newSessionChoiceBtn');
    els.joinSessionChoiceBtn = qs('joinSessionChoiceBtn');
    els.launcherChoiceCancelBtn = qs('launcherChoiceCancelBtn');
    els.launcherChoiceBackBtn = qs('launcherChoiceBackBtn');
    els.launcherJoinInputWrap = qs('launcherJoinInputWrap');
    els.launcherJoinInput = qs('launcherJoinInput');
    els.launcherJoinError = qs('launcherJoinError');
    els.launcherJoinEnterBtn = qs('launcherJoinEnterBtn');
    els.coinTile = qs('coinTile');
    els.coinTileArt = qs('coinTileArt');
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
    els.multiSwapWarning = qs('multiSwapWarning');
    els.settingsBtn = qs('settingsBtn');
    els.settingsModal = qs('settingsModal');
    els.joinedEmptyNote = qs('joinedEmptyNote');
    els.masterOnlyNote = qs('masterOnlyNote');
    els.shareSessionRow = qs('shareSessionRow');
    els.rankCumulativeRow = qs('rankCumulativeRow');
    els.transferOwnerRow = qs('transferOwnerRow');
    els.transferOwnerBtn = qs('transferOwnerBtn');
    els.transferOwnerNote = qs('transferOwnerNote');
    els.leaveMatchBtn = qs('leaveMatchBtn');
    els.closeSessionRow = qs('closeSessionRow');
    els.closeSessionBtn = qs('closeSessionBtn');
    els.closeSessionConfirmModal = qs('closeSessionConfirmModal');
    els.closeSessionConfirmText = qs('closeSessionConfirmText');
    els.closeSessionCancelBtn = qs('closeSessionCancelBtn');
    els.closeSessionConfirmBtn = qs('closeSessionConfirmBtn');
    els.nameRows = qs('nameRows');
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
    els.endResetBtn = qs('endResetBtn');
    els.endResetWrap = qs('endResetWrap');
    els.reorgPromptModal = qs('reorgPromptModal');
    els.reorgNoBtn = qs('reorgNoBtn');
    els.reorgYesBtn = qs('reorgYesBtn');
    els.multiSelectBtn = qs('multiSelectBtn');
    els.multiSelectBtnLabel = qs('multiSelectBtnLabel');
    els.multiSelectCancelBtn = qs('multiSelectCancelBtn');
    els.swapSuggestionBtn = qs('swapSuggestionBtn');
    els.matchClock = qs('matchClock');
    els.matchCountdown = qs('matchCountdown');
    els.homeScoreBtn = qs('homeScoreBtn');
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
    els.historySaveToggle = qs('historySaveToggle');
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
      if (sessionCode) pushRemoteState(); // push whatever changed while offline right away
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
    els.fieldSizeInput.addEventListener('input', syncNameRows);
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
      disarmResetConfirm();
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
      disarmResetConfirm();
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
      disarmResetConfirm();
      els.endMatchModal.classList.remove('open');
      els.reorgPromptModal.classList.add('open');
    });
    els.reorgNoBtn.addEventListener('click', function(){
      els.reorgPromptModal.classList.remove('open');
      endMatchPeriod(false);
      renderAll();
      openOpponentModal(); // next match, likely a different opponent (cup format) - see endMatchPeriod
    });
    els.reorgYesBtn.addEventListener('click', function(){
      els.reorgPromptModal.classList.remove('open');
      animateReorganization(function(){
        endMatchPeriod(true);
        openOpponentModal();
      });
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
      if (kind === 'reset') resetMatch();
      else if (kind === 'endPeriod'){ endMatchPeriod(false); renderAll(); }
    });
    els.endResetBtn.addEventListener('click', function(){
      if (!isMaster()) return;
      if (!resetConfirmArmed){
        resetConfirmArmed = true;
        els.endResetBtn.textContent = RESET_CONFIRM_LABEL;
        els.endResetWrap.classList.add('armed');
        els.endResetWrap.classList.remove('shake-btn');
        void els.endResetWrap.offsetWidth; // restart the shake if pressed again quickly
        els.endResetWrap.classList.add('shake-btn');
        clearTimeout(resetConfirmTimer);
        resetConfirmTimer = setTimeout(disarmResetConfirm, 2500);
        return;
      }
      disarmResetConfirm();
      resetMatch();
    });
    els.multiSelectBtn.addEventListener('click', onMultiSelectBtnClick);
    els.multiSelectCancelBtn.addEventListener('click', cancelMultiSelect);
    els.swapSuggestionBtn.addEventListener('click', onSwapSuggestionBtnClick);
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
    els.historySaveToggle.addEventListener('change', function(){
      setHistorySaveEnabled(els.historySaveToggle.checked);
    });
    els.exportBtn.addEventListener('click', function(){
      els.exportText.value = buildExportText();
      els.exportModal.classList.add('open');
    });
    els.exportCloseBtn.addEventListener('click', function(){ els.exportModal.classList.remove('open'); });
    els.legendBtn.addEventListener('click', function(){ els.legendModal.classList.add('open'); });
    els.legendCloseBtn.addEventListener('click', function(){ els.legendModal.classList.remove('open'); });
    Array.prototype.forEach.call(document.querySelectorAll('.info-btn'), function(btn){
      btn.addEventListener('click', function(){
        var info = INFO_TEXTS[btn.dataset.info || ''];
        if (!info) return;
        els.infoPopupTitle.textContent = info.title;
        els.infoPopupText.textContent = info.text;
        els.infoPopupModal.classList.add('open');
      });
    });
    els.infoPopupCloseBtn.addEventListener('click', function(){ els.infoPopupModal.classList.remove('open'); });
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
      if (!transferOwnerConfirmArmed){
        transferOwnerConfirmArmed = true;
        els.transferOwnerBtn.textContent = TRANSFER_OWNER_CONFIRM_LABEL;
        els.transferOwnerBtn.classList.add('armed');
        els.transferOwnerBtn.classList.remove('shake-btn');
        void els.transferOwnerBtn.offsetWidth; // restart the shake if pressed again quickly
        els.transferOwnerBtn.classList.add('shake-btn');
        clearTimeout(transferOwnerConfirmTimer);
        transferOwnerConfirmTimer = setTimeout(disarmTransferOwnerConfirm, 2500);
        return;
      }
      disarmTransferOwnerConfirm();
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

    function disarmNewSessionConfirm(){
      clearTimeout(newSessionConfirmTimer);
      newSessionConfirmArmed = false;
      els.newSessionChoiceBtn.textContent = NEW_SESSION_LABEL;
      els.newSessionChoiceBtn.classList.remove('armed', 'shake-btn');
    }

    // Re-run every time the choice panel is (re)shown - not just on the
    // very first launcher visit - so "Fortsett fra forrige økt" only
    // appears when there's an actual team to go back to, and "Ny økt"
    // picks up whichever of the two is the more likely tap right now.
    function showLauncherChoicePanel(){
      els.launcherChoicePanelChoice.hidden = false;
      els.launcherChoicePanelJoin.hidden = true;
      disarmNewSessionConfirm();
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
      disarmNewSessionConfirm();
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
        disarmNewSessionConfirm();
        resetMatch();
        enterAppFromLauncher();
        return;
      }
      if (!newSessionConfirmArmed){
        newSessionConfirmArmed = true;
        els.newSessionChoiceBtn.textContent = NEW_SESSION_CONFIRM_LABEL;
        els.newSessionChoiceBtn.classList.add('armed');
        els.newSessionChoiceBtn.classList.remove('shake-btn');
        void els.newSessionChoiceBtn.offsetWidth; // restart the shake if pressed again quickly
        els.newSessionChoiceBtn.classList.add('shake-btn');
        clearTimeout(newSessionConfirmTimer);
        newSessionConfirmTimer = setTimeout(disarmNewSessionConfirm, 2500);
        return;
      }
      disarmNewSessionConfirm();
      resetMatch();
      enterAppFromLauncher();
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

    updateFrameFit();
    renderPitchMarkings();
    requestWakeLock();
    window.addEventListener('resize', function(){ updateFrameFit(); renderPitchMarkings(); });
    window.addEventListener('orientationchange', function(){ updateFrameFit(); renderPitchMarkings(); });
    if (window.visualViewport){
      // #viewport-frame/#app size themselves now (see updateFrameFit),
      // but renderPitchMarkings() reads #field-wrap's rendered box as a
      // one-off snapshot each call - re-run it whenever Safari's chrome
      // settles so the pitch lines aren't drawn against a still-short box.
      window.visualViewport.addEventListener('resize', renderPitchMarkings);
    }
    // Same reasoning as above, in case the very first measurement (on
    // load) was still mid-settle - cheap, and harmless if not needed.
    setTimeout(renderPitchMarkings, 400);
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
      pruneHistoryArchive(); // drop Historikk entries past the 365-day retention
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
          if (normalized){
            state = normalized;
            if (ensureParticipant()) pushRemoteState();
            if (!wasMaster && isMaster()) showOwnerTransferredNotice();
            saveStateLocally();
            resyncTimeUpNotified();
          } else {
            console.warn('Lagret økt inneholdt ugyldig data, fortsetter med lokal tilstand');
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
