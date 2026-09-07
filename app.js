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
   * @property {GoalEntry[]} goalLog
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
  var COINFLIP_COLORS_KEY = 'spillerbytte_coinflip_colors_v1';
  var LAST_ALIVE_KEY = 'spillerbytte_last_alive'; // plain heartbeat, not synced state - see checkIdleAutoPause()
  var IDLE_AUTO_PAUSE_MS = 60 * 60 * 1000; // auto-pause a running match after this long with no heartbeat

  // Single source of truth for the version shown in settings - bump on
  // every push (see checkForUpdate below, which parses this same line back
  // out of the live deployed file to detect when a newer version exists).
  var APP_VERSION = '1.8.4';
  var UPDATE_ATTEMPT_KEY = 'spillerbytte_update_attempt_v1';

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
      text: 'Tiden en utespiller skal spille før et oransje utropstegn varsler at byttetiden er nådd. Spiller de 50% lenger enn byttetiden, blir utropstegnet rødt og pulserer forsiktig. Klokka fortsetter å telle etter det - spilleren byttes ikke automatisk ut.'
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
    }
  };
  var resetConfirmArmed = false; // "Avslutt og nullstill" needs a second press to confirm
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  var resetConfirmTimer; // clearTimeout(undefined) is a safe no-op, same as our old null check
  var RESET_LABEL = 'Avslutt og nullstill';
  var RESET_CONFIRM_LABEL = 'Trykk igjen for å bekrefte';
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
      goalLog: []
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
    if (!Array.isArray(raw.goalLog)) raw.goalLog = [];
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
          state = normalized;
          saveStateLocally();
          resyncTimeUpNotified();
          renderAll();
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
    els.shareModeRow.hidden = !sessionCode;
    var editable = !state || state.shareEditable !== false;
    Array.prototype.forEach.call(els.shareModeSegmented.querySelectorAll('.segmented-btn'), function(btn){
      var isEdit = btn.dataset.mode !== 'read';
      btn.classList.toggle('active', isEdit === editable);
    });
  }

  function createNewSession(callback){
    if (!sb){ callback(null); return; }
    state.sessionOwnerDeviceId = deviceId;
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
      saveStateLocally();
      resyncTimeUpNotified();
      subscribeToSession(code);
      updateSessionCodeUI();
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
      goalLog: cloneStateValue(state.goalLog || [])
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
    state.goalLog = cloneStateValue(snap.goalLog || []);
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

  // A goal is undoable the same way a substitution is (see pushUndoSnapshot
  // above togglePlayPause) - both just mutate `state` before saving, so the
  // generic snapshot-based undo stack covers this for free.
  var GOAL_CONFIRM_WINDOW_MS = 30000;
  /** @type {'home'|'away'|null} */
  var pendingGoalTeam = null;
  /** @type {string|null} */
  var pendingGoalPlayerId = null;

  /** @param {'home'|'away'} team @param {string|null} playerId */
  function registerGoal(team, playerId){
    pushUndoSnapshot();
    state.goalLog.push({ id: uid(), team: team, playerId: playerId || null, at: Date.now() });
    saveState();
    renderAll();
  }

  // Away goals stay anonymous (see onHomePlayerPicked for the home flow,
  // gated by the same shared-state 10s duplicate window - keyed on the
  // synced goalLog, not a local timer, so it also catches a second device
  // registering the same goal).
  function onAwayScoreTap(){
    if (!canEdit()) return;
    var last = lastGoalEntry('away');
    var recent = last && (Date.now() - last.at) < GOAL_CONFIRM_WINDOW_MS;
    if (recent){
      pendingGoalTeam = 'away';
      pendingGoalPlayerId = null;
      els.goalConfirmModal.classList.add('open');
      return;
    }
    registerGoal('away', null);
  }

  /** @param {string} playerId */
  function onHomePlayerPicked(playerId){
    var last = lastGoalEntry('home');
    var recent = last && (Date.now() - last.at) < GOAL_CONFIRM_WINDOW_MS;
    if (recent){
      pendingGoalTeam = 'home';
      pendingGoalPlayerId = playerId;
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
    }
  }

  /** @param {'add'|'remove'|'view'} mode */
  function openGoalPlayerModal(mode){
    goalPlayerMode = mode;
    els.goalPlayerModalTitle.textContent =
      mode === 'add' ? 'Hvem scoret?' : mode === 'remove' ? 'Fjern mål fra hvem?' : 'Målskårere';
    renderGoalPlayerList();
    els.goalPlayerModal.classList.add('open');
  }

  function closeGoalPlayerModal(){
    els.goalPlayerModal.classList.remove('open');
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
          (farOver ? '<div class="badge-warning overtime">!</div>' : timeUp ? '<div class="badge-warning due">!</div>' : '') +
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
        badge.textContent = '!';
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
      freezeTimersAt(last);
      state.globalRunning = false;
      saveState();
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

  /* ---------------- Settings modal ---------------- */

  // A row counts as "blank" (safe to auto-add/auto-trim) only if it's an
  // ordinary editable row with nothing typed in it - a locked row (a
  // player currently on the field) never counts, even though its input
  // can't be edited here.
  /** @param {HTMLElement} row @returns {boolean} */
  function isBlankRow(row){
    if (row.classList.contains('locked')) return false;
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
    els.settingsModal.classList.add('open');
    els.cancelBtn.style.display = isFirstRun ? 'none' : '';
    els.settingsCloseBtn.style.display = isFirstRun ? 'none' : '';
    els.joinedEmptyNote.hidden = !joinedEmpty;
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
    els.wakeLockToggle.checked = !!state.wakeLockEnabled;
    els.shareSessionToggle.checked = !!sessionCode;
    updateShareModeUI();
    els.rankByCumulativeToggle.checked = !!state.rankByCumulative;
    els.fieldSizeInput.disabled = !isFirstRun;
    els.fieldSizeLockedNote.style.display = isFirstRun ? 'none' : '';
  }

  /** @param {string|null} id @param {string} name @param {number} indexHint @param {boolean} [locked] @param {boolean} [fadeIn] @returns {HTMLElement} */
  function addNameRow(id, name, indexHint, locked, fadeIn){
    var row = document.createElement('div');
    row.className = 'name-row' + (locked ? ' locked' : '') + (fadeIn ? ' name-row-enter' : '');
    row.dataset.id = id || '';
    row.innerHTML =
      '<div class="name-input-wrap">' +
        '<input type="text" value="' + escapeHtml(name||'') + '" placeholder="Spiller ' + indexHint + '" autocomplete="off"' + (locked ? ' disabled' : '') + '>' +
      '</div>' +
      (locked
        ? '<span class="locked-row-note" title="Utespillere kan ikke endres eller fjernes her mens de er på banen">🔒</span>'
        : '<button type="button" class="removeRow" aria-label="Fjern"' + (name && name.trim() ? '' : ' style="display:none;"') + '>×</button>');
    els.nameRows.appendChild(row);
    var wrap = row.querySelector('.name-input-wrap');
    if (locked) return row;
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
    if (!canEdit()) return;
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
    els.endResetBtn.classList.remove('armed', 'shake-btn');
  }

  function renderEndMatchSummary(){
    var now = Date.now();
    var goalBadges = computeGoalBadges();
    var rows = state.players.map(function(p){
      return {
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
        '<span class="ems-name">' + escapeHtml(r.name) + (r.goals > 0 ? ' (' + r.goals + ' mål)' : '') + '</span>' +
        '<span class="ems-time">spilt: ' + formatCumulative(r.fieldMs) + ' - benk: ' + formatCumulative(r.benchMs) + '</span>' +
      '</div>';
    }).join('');
  }

  function endMatchPeriod(reorganize){
    var now = Date.now();
    state.onField.forEach(function(id){ commitFieldStint(id, now); });
    state.onBench.forEach(function(id){ commitBenchStint(id, now); });

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
    state = defaultState();
    state.defaultDurationMs = keepDuration;
    state.matchDurationMs = keepMatchDuration;
    state.wakeLockEnabled = keepWakeLock;
    state.fieldSize = keepFieldSize;
    state.rankByCumulative = keepRankByCumulative;
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
    els.multiSwapWarning = qs('multiSwapWarning');
    els.settingsBtn = qs('settingsBtn');
    els.settingsModal = qs('settingsModal');
    els.joinedEmptyNote = qs('joinedEmptyNote');
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
    els.endMatchCancelBtn = qs('endMatchCancelBtn');
    els.endPeriodBtn = qs('endPeriodBtn');
    els.endResetBtn = qs('endResetBtn');
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
    els.goalConfirmModal = qs('goalConfirmModal');
    els.goalConfirmNoBtn = qs('goalConfirmNoBtn');
    els.goalConfirmYesBtn = qs('goalConfirmYesBtn');
    els.goalListBtn = qs('goalListBtn');
    els.goalPlayerModal = qs('goalPlayerModal');
    els.goalPlayerModalTitle = qs('goalPlayerModalTitle');
    els.goalPlayerList = qs('goalPlayerList');
    els.goalPlayerCancelBtn = qs('goalPlayerCancelBtn');
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
    els.appVersionLabel = qs('appVersionLabel');
    els.appVersionLabel.textContent = 'v' + APP_VERSION;
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
      els.undoActionBtn.disabled = undoStack.length === 0;
      els.redoActionBtn.disabled = redoStack.length === 0;
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
    els.settingsBtn.addEventListener('click', function(){ if (canEdit()) openSettings(false); });
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
      if (!canEdit()) return;
      disarmResetConfirm();
      renderEndMatchSummary();
      els.endMatchModal.classList.add('open');
    });
    els.endMatchCancelBtn.addEventListener('click', function(){
      disarmResetConfirm();
      els.endMatchModal.classList.remove('open');
    });
    els.endPeriodBtn.addEventListener('click', function(){
      disarmResetConfirm();
      els.endMatchModal.classList.remove('open');
      els.reorgPromptModal.classList.add('open');
    });
    els.reorgNoBtn.addEventListener('click', function(){
      els.reorgPromptModal.classList.remove('open');
      endMatchPeriod(false);
      renderAll();
    });
    els.reorgYesBtn.addEventListener('click', function(){
      els.reorgPromptModal.classList.remove('open');
      animateReorganization(function(){ endMatchPeriod(true); });
    });
    els.endResetBtn.addEventListener('click', function(){
      if (!resetConfirmArmed){
        resetConfirmArmed = true;
        els.endResetBtn.textContent = RESET_CONFIRM_LABEL;
        els.endResetBtn.classList.add('armed');
        els.endResetBtn.classList.remove('shake-btn');
        void els.endResetBtn.offsetWidth; // restart the shake if pressed again quickly
        els.endResetBtn.classList.add('shake-btn');
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
    els.goalListBtn.addEventListener('click', function(){ openGoalPlayerModal('view'); });
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
      var btn = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('.segmented-btn'));
      if (!btn) return;
      state.shareEditable = btn.dataset.mode !== 'read';
      saveState();
      updateShareModeUI();
      updateSessionCodeUI();
    });
    els.rankByCumulativeToggle.addEventListener('change', function(){
      state.rankByCumulative = els.rankByCumulativeToggle.checked;
      saveState();
      renderAll();
    });
    els.joinExistingBtn.addEventListener('click', function(){
      els.settingsModal.classList.remove('open');
      els.joinCodeInput.value = '';
      els.joinCodeError.style.display = 'none';
      clearFieldInvalid(els.joinCodeInputWrap);
      els.joinCodeModal.classList.add('open');
    });
    els.joinCodeCancelBtn.addEventListener('click', function(){
      els.joinCodeModal.classList.remove('open');
      els.settingsModal.classList.add('open');
    });
    els.joinCodeInput.addEventListener('input', function(){
      els.joinCodeError.style.display = 'none';
      clearFieldInvalid(els.joinCodeInputWrap);
    });
    els.joinCodeConfirmBtn.addEventListener('click', function(){
      var code = els.joinCodeInput.value.trim();
      if (!/^[0-9]{3}$/.test(code)){
        els.joinCodeError.textContent = 'Skriv inn en gyldig tresifret kode.';
        els.joinCodeError.style.display = '';
        markFieldInvalid(els.joinCodeInputWrap);
        shakeElement(els.joinCodeModal.querySelector('.modal-card'));
        return;
      }
      joinSession(code, function(){
        els.joinCodeModal.classList.remove('open');
        if (state.players.length === 0){ openSettings(true, true); } else { renderAll(); }
      }, function(){
        els.joinCodeError.textContent = 'Fant ingen økt med den koden.';
        els.joinCodeError.style.display = '';
        markFieldInvalid(els.joinCodeInputWrap);
        shakeElement(els.joinCodeModal.querySelector('.modal-card'));
      });
    });
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
      setTimeout(function(){ els.launcherJoinInput.focus(); }, 50);
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
        enterAppFromLauncher();
        if (state.players.length === 0){ openSettings(true, true); } else { renderAll(); }
      }, function(){
        els.launcherJoinError.textContent = 'Fant ingen økt med den koden.';
        els.launcherJoinError.hidden = false;
        markFieldInvalid(els.launcherJoinInputWrap);
        shakeElement(els.launcherChoiceOverlay);
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
    // nullstill" - with nothing to lose (a genuinely fresh app), it just
    // proceeds straight in, same as "Fortsett" would.
    els.newSessionChoiceBtn.addEventListener('click', function(){
      if (state.players.length === 0){
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
          saveState();
        } else {
          checkIdleAutoPause(); // covers "tab/app was backgrounded for a long gap, then resumed"
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
          var normalized = normalizeState(res.data.data);
          if (normalized){
            state = normalized;
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
        if (state.players.length === 0){ openSettings(true); } else { renderAll(); }
        finishStartup();
      }).catch(function(){
        subscribeToSession(sessionCode);
        if (state.players.length === 0){ openSettings(true); } else { renderAll(); }
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
