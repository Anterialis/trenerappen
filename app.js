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
   * @property {MatchEvent[]} [events] - the match's timeline, local-only like durationMs
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
   * @property {number} fieldSize
   * @property {(string|null)[]|null} fieldSlotAssignment - index = formation slot (see fieldSlotList()), value = the onField player id standing there, or null for a not-yet-filled slot (see renderField()'s `if (!id) continue`); the whole array is null when fieldHasPositions() is false (fieldSize < 5, no fixed positions) or not yet reconciled - see syncFieldSlots()
   * @property {boolean} globalRunning
   * @property {number} defaultDurationMs
   * @property {number} matchDurationMs
   * @property {boolean} rankByCumulative
   * @property {boolean} reorgUsesLastMatch
   * @property {'match'|'cumulative'} swapSuggestionBasis - which spilletid measure "Forslag" ranks field/bench candidates by: 'match' (this match/period only) or 'cumulative' (lifetime, across matches) - see computeSwapSuggestion()
   * @property {'waited'|'cumulative'} swapSuggestionBenchMode - which bench player "Forslag" picks: 'waited' (longest current bench stint, ties random) or 'cumulative' (least spilletid in this match/period only, ties random) - see computeSwapSuggestion()
   * @property {boolean} shareEditable
   * @property {string|null} sessionOwnerDeviceId
   * @property {Participant[]} participants
   * @property {GoalEntry[]} goalLog
   * @property {number} swapCount - count of field<->bench swaps in the match/period in progress right now, reset alongside goalLog (see endMatchPeriod/resetMatch)
   * @property {number} lastActivityAt
   * @property {number} lastPlayAt - stamped by real play actions only (swap, goal, move, undo/redo, start/pause, Fortsett) - NOT settings; drives forgottenMatchInfo()
   * @property {number} continueCount - how many times «Fortsett» was answered on the forgotten-match prompt this match; each one lengthens the quiet time required before it asks again
   * @property {string} opponentName
   * @property {string} opponentAbbr
   * @property {MatchHistoryEntry[]} matchHistory
   * @property {number} rev
   * @property {string} [sessionUid] - unique per shared session (set by createNewSession()); lets a device notice that its old three-digit code now belongs to someone else's session (see isDifferentSession())
   * @property {MatchEvent[]} eventLog - timeline of the match in progress (swaps, goals, start/pause), reset at Kampslutt
   * @property {boolean} [hasKeeper] - absent on sessions from before 2.4.0, which keep the formations they were started with (see fieldFormationRows())
   * @property {number} [halves] - 1 or 2; with 2 the clock stops at half time (see checkMatchAlarms())
   * @property {number} [halfStage] - which half is being played
   * @property {string|null} [homeTeamName] - follows the session, so a co-coach sees the same team name
   * @property {string|null} [homeTeamAbbr]
   * @property {boolean} [planEnabled] - «Neste bytte» follows the rotation plan
   * @property {{name:string, matches:{id:string, time:string, opponent:string}[]}|null} [cup]
   * @property {Object<string, number>} [keeperMs] - time in goal this match
   * @property {{id:string, sinceMs:number}|null} [keeperNow]
   * @property {string[]} opIds - the latest operations this state already contains, so a replay can't apply one twice (see applyOp())
   *
   * @typedef {Object} MatchEvent
   * @property {string} k - 'swap'|'toField'|'toBench'|'goal'|'ungoal'|'start'|'pause'
   * @property {number} at
   * @property {number} ms - the match clock when it happened
   * @property {string|null} a
   * @property {string|null} b
   * @property {'home'|'away'} team
   *
   * @typedef {{id: string, zone: 'field'|'bench'}} Selection
   */

  var SUPABASE_URL = 'https://nueguoxkynwgmynccaro.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_1Zsq-zFU3nmqYFrSxXzKGQ_k-peb2bV';
  // window.supabase comes from the CDN script tag above, not a module import,
  // so the type checker has no declaration for it - treat it as untyped here.
  var supabaseGlobal = /** @type {any} */ (window).supabase;
  /** @type {any} */
  var sb = null;
  try {
    if (supabaseGlobal && supabaseGlobal.createClient) sb = supabaseGlobal.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch(e){ console.warn('Kunne ikke starte Supabase-klienten', e); } // appen skal virke lokalt uansett
  var SESSION_CODE_KEY = 'spillerbytte_session_code_v1';

  // Felles klokke. Spillerklokkene regnes ut fra tidsstempler som deles mellom telefoner, og to
  // telefoner kan gå flere sekunder i utakt. nowTs() er serverens tid (så godt den kan anslås), og
  // brukes for alt som deles. Lokale ting (hjerteslag, utsettelser, innloggingssperre) bruker Date.now().
  var CLOCK_OFFSET_KEY = 'spillerbytte_clock_offset_v1';
  var clockOffsetMs = 0;
  var clockBestRtt = Infinity;
  try { clockOffsetMs = Number(localStorage.getItem(CLOCK_OFFSET_KEY)) || 0; } catch(e){}
  /** @returns {number} */
  function nowTs(){ return Date.now() + clockOffsetMs; }
  // Kalles med serverens tid fra et svar. Bare raske svar stoles på (en treg forespørsel sier lite
  // om når serveren faktisk leste klokka), og små avvik ignoreres så klokkene ikke hopper.
  /** @param {string|undefined} serverIso @param {number} sentAt @param {number} receivedAt */
  function noteServerTime(serverIso, sentAt, receivedAt){
    var server = serverIso ? new Date(serverIso).getTime() : NaN;
    if (!isFinite(server)) return;
    var rtt = receivedAt - sentAt;
    if (rtt > Math.max(clockBestRtt * 1.5, 400)) return;
    if (rtt < clockBestRtt) clockBestRtt = rtt;
    var next = server + rtt / 2 - receivedAt;
    var delta = next - clockOffsetMs;
    if (Math.abs(delta) < 500) return;
    clockOffsetMs = next;
    try { localStorage.setItem(CLOCK_OFFSET_KEY, String(next)); } catch(e){}
    // Det denne telefonen selv har stemplet er målt med den gamle klokka: flytt det med, så en
    // pågående kamp ikke hopper. En nyere rad fra serveren tas inn etterpå og er riktig fra før.
    if (state) shiftStamps(state, delta);
    undoStack.concat(redoStack).forEach(function(snap){ shiftStamps(snap, delta); });
  }
  /** @param {AppState} s @param {number} delta */
  function shiftStamps(s, delta){
    [s.fieldTimers, s.benchTimers].forEach(function(group){
      Object.keys(group).forEach(function(id){ group[id].sinceTs += delta; });
    });
    if (s.matchClock) s.matchClock.sinceTs += delta;
    if (typeof s.lastPlayAt === 'number') s.lastPlayAt += delta;
    if (typeof s.lastActivityAt === 'number') s.lastActivityAt += delta;
  }
  var deviceOrigin = 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  // Stable per-device id (survives reloads, unlike deviceOrigin above which
  // is fresh every page load) - used to recognize "this device created the
  // session" for the read-only sharing mode, so the owner keeps edit rights
  // even after an update reloads the page.
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
  var HOME_TEAM_NAME = 'Hjemmelag';
  var HOME_TEAM_ABBR = 'HJE';
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
   * @property {'match'|'cumulative'} swapSuggestionBasis
   * @property {'waited'|'cumulative'} swapSuggestionBenchMode
   * @property {number} halves
   * @property {'auto'|'on'|'off'} keeper
   */
  /** @returns {CoachDefaults} */
  function loadCoachDefaults(){
    // Matches today's actual defaultState() values exactly, except
    // matchDurationMs - explicitly asked to be 15 min instead of the old
    // 20 min baseline, for anyone who's never touched Settings too.
    /** @type {CoachDefaults} */
    var fallback = {
      homeTeamName: 'Hjemmelag', homeTeamAbbr: 'HJE',
      matchDurationMs: 900000, defaultDurationMs: 180000, fieldSize: 3,
      // Alle valg står til venstre i Kampoppførsel som standard - for «Bytt om» er
      // venstre «Kun forrige kamp», altså reorgUsesLastMatch = true (se CHOICES.reorg).
      rankByCumulative: false, reorgUsesLastMatch: true,
      swapSuggestionBasis: 'match', swapSuggestionBenchMode: 'waited',
      halves: 1, keeper: 'auto'
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
        reorgUsesLastMatch: !!parsed.reorgUsesLastMatch,
        swapSuggestionBasis: parsed.swapSuggestionBasis === 'cumulative' ? 'cumulative' : 'match',
        swapSuggestionBenchMode: parsed.swapSuggestionBenchMode === 'cumulative' ? 'cumulative' : 'waited',
        halves: parsed.halves === 2 ? 2 : 1,
        keeper: parsed.keeper === 'on' || parsed.keeper === 'off' ? parsed.keeper : 'auto'
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
    if (els.homeTeamLabel && state) renderScore();
  }
  // Lagnavnet følger økten, så en medtrener ser samme lag. Eldre økter uten navn bruker enhetens.
  /** @returns {string} */
  function homeName(){ return (state && state.homeTeamName) || HOME_TEAM_NAME; }
  /** @returns {string} */
  function homeAbbr(){ return (state && state.homeTeamAbbr) || HOME_TEAM_ABBR; }
  // Nøtterøy var standard før 2.4.0. En enhet som allerede har en kamp liggende, men aldri åpnet
  // innstillingene, skal beholde det den har sett hele tiden.
  function migrateOldDefaultTeam(){
    try {
      if (localStorage.getItem(COACH_DEFAULTS_KEY) || !localStorage.getItem(STORAGE_KEY)) return;
      var d = loadCoachDefaults();
      d.homeTeamName = 'Nøtterøy';
      d.homeTeamAbbr = 'NØT';
      localStorage.setItem(COACH_DEFAULTS_KEY, JSON.stringify(d));
    } catch(e){}
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

  // The version shown on the launcher - bump on every push, together with
  // APP_VERSION and CACHE_NAME in sw.js (that change is what phones detect).
  var APP_VERSION = '2.4.0';

  // Changelog shown in #versionHistoryModal (tapped from the short "vX.Y"
  // footer on the launcher) - newest first, one entry per version bump.
  // Keep each note short (roughly 10-15 words); it's a footnote, not
  // release notes.
  var VERSION_HISTORY = [
    { version: '2.4.0', text: 'Stor oppdatering: velg mellom fem design under Innstillinger. Kampslutt på ett ark, Angre rett etter hvert bytte, Neste bytte alltid synlig, bytteplan, omganger med fløyte, keeper på 5v5 og større, fast stall, cup-oppsett, statistikk og rapport å dele. Del økten med lenke og QR, og med en egen foreldrelenke. Samtidige bytter fra to trenere går ikke lenger tapt, og økter er ikke lenger åpne for alle. Appen spør nå før den oppdaterer seg.' },
    { version: '2.3.5', text: 'Tryggere på banen: appen starter raskt også med dårlig dekning, en telefon som har sovet kan ikke lenger overskrive kampen, og kamper som ikke får lagret seg uten nett sendes automatisk senere. Angre etter en pause og «Fjern dødtid» endrer ikke lenger spilletiden feil. Du må også bekrefte før en delt økt erstatter kampen på enheten.' },
    { version: '2.3.4', text: 'Glemt kampslutt: når kamptiden er ute og det har vært stille en stund, kommer et ark med «Tilbakestill til kampslutt», «Fortsett» og «Still manuelt». Etter «Fortsett» lyser klokka og viser hvor kamptiden endres. Du kan også stille klokka tilbake fra overtidsklokka og fra Korriger tid.' },
    { version: '2.3.3', text: 'Rangeringstrekantene oppdateres nå av seg selv mens klokka går (første gang etter 30 sekunder), ikke bare når noe annet tegnes på nytt. Når du drar en spiller over en annen vises «Slipp for å bytte» med navnene på de to. Fikset at navneforslagene i spillerlisten ble klippet av.' },
    { version: '2.3.2', text: 'Ryddigere innstillinger: Kamptid og Byttetid justeres med store knapper (hele minutter), symboler ved titlene, «Bytt om» kan nå endres under kampen, og Kampoppførsel kan foldes sammen. Skjerm-våken ligger under Innstillinger på hjemskjermen og gjelder bare din enhet.' },
    { version: '2.3.1', text: 'Symbolforklaringen finnes nå også under Innstillinger på hjemskjermen, og teksten om hva som finnes hvor er oppdatert. Regellinjen under Kampoppførsel nevner at «alle kamper i økten» gjelder under en cup.' },
    { version: '2.3.0', text: 'Nye, tydeligere valg under Kampoppførsel: to knapper med forklaring i stedet for av/på-brytere (alle står til venstre som standard). Bytteforslag for innbytter velger nå enten den som har ventet lengst siden forrige bytte, eller den med minst spilletid i denne kampen - aldri total spilletid.' },
    { version: '2.2.9', text: 'Når du svarer «Kampslutt»/«Nullstill» på «har du glemt kampen?», settes klokka og spillertidene tilbake til kampvarigheten. Fikset også at spilletid kunne telles dobbelt i kampresultatet hvis klokka hadde vært pauset.' },
    { version: '2.2.8', text: 'Fikset at klokka og nedtellingen viste feil tid (f.eks. «+11519:14») når kampen var pauset og du endret innstillinger eller startet ny økt.' },
    { version: '2.2.7', text: 'Fikset at «Avslutt og nullstill» i delt økt kunne bli usynlig for andre enheter etter mange bytter i økten. Fikset at «Angre» i delt økt kunne viske ut en medspillers bytte uten varsel. Mindre stabilitets- og ytelsesforbedringer.' },
    { version: '2.2.6', text: 'Ny «Korriger tid» i Innstillinger - fjern dødtid siden siste bytte/mål automatisk, eller trekk fra en valgfri tid, om klokka fikk gå for lenge.' },
    { version: '2.2.5', text: 'Rangeringstrekantene vises nå bare når en spiller faktisk skiller seg fra snittet - bufferen strammes gradvis og jevnt inn gjennom kampen (10 % ved start → 5 % ved 10 min → 2,5 % ved 20 min), ingen brå hopp.' },
    { version: '2.2.4', text: 'Fikset at appen i en vanlig Mac/PC-nettleser kunne klemmes inn i en smal, liggende stripe - viser nå alltid en stående telefonramme på desktop.' },
    { version: '2.2.3', text: 'Delt kamp-kode velges nå blant faktisk ledige koder i stedet for å gjette blindt - unngår at det blir vanskeligere å opprette en økt etter hvert som flere koder er i bruk.' },
    { version: '2.2.2', text: '"Bytt" omdøpt til "Bytte?" i spillerinfo-boblen. Fikset at kamper "lagret" til delt Historikk siden v2.0.7 aldri faktisk ble lagret (manglende databasekolonne) - viser nå en synlig feilmelding hvis lagring skulle mislykkes igjen.' },
    { version: '2.2.1', text: 'Fikset skjev "telefon i nettleser"-ramme på desktop (viste kort og bred i stedet for høyreist). Innstillinger-vinduet før kamp henter nå alltid siste lagrede standardverdier. Redesignet scrollbar til å matche appen, og fjernet duplikat-tittel i endringsloggen.' },
    { version: '2.2', text: 'To nye valg for Bytteforslag: rangér etter kamp- eller total spilletid, og velg innbytter etter ventetid eller lavest spilletid. Ekte tilfeldig valg ved uavgjort.' },
    { version: '2.1.17', text: 'Fikset at Forslag-knappen mistet markeringen med en gang - andre trykk (bekreft bytte) gjorde ingenting.' },
    { version: '2.1.16', text: '"Forslag"-knappen bekrefter nå bytte med et andre trykk, akkurat som multiBytte - grønn med avbryt-kryss.' },
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

  /* ---------------- Ny versjon: spør før den tas i bruk ----------------
     Samme modell som Anestesiappen (se sw.js). Appen ber nettleseren se etter en ny versjon ved oppstart,
     når den hentes frem, når nettet er tilbake og hvert 30. minutt mens den er synlig. Nettleserens egen
     sjekk er for treg, og på iOS kommer den ofte ikke i det hele tatt. Finnes det en ny versjon, ligger den
     ferdig nedlastet og venter til brukeren trykker «Oppdater nå». */
  var UPDATE_CHECK_EVERY_MS = 30 * 60 * 1000;
  /** @type {ServiceWorkerRegistration|null} */
  var swRegistration = null;
  /** @type {ServiceWorker|null} */
  var waitingWorker = null;
  var updateDismissed = false;
  var updateAccepted = false;

  // Under utvikling (localhost, lokalt nett) skal endrede filer vises med en gang, så der er service workeren
  // av, som i Anestesiappen. ?sw=on slår den på, for å teste selve oppdateringen.
  /** @returns {boolean} */
  function isDevHost(){
    return /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
  }
  /** @returns {boolean} */
  function serviceWorkerAllowed(){
    return !isDevHost() || new URLSearchParams(location.search).get('sw') === 'on';
  }

  function initAppUpdates(){
    if (!('serviceWorker' in navigator)) return;
    if (!serviceWorkerAllowed()){
      // En tidligere registrert worker ville ellers fortsatt servert gamle filer.
      navigator.serviceWorker.getRegistrations().then(function(regs){
        regs.forEach(function(r){ r.unregister(); });
      }).catch(function(){});
      if (window.caches) caches.keys().then(function(names){
        names.forEach(function(n){ if (n.indexOf('trenerapp-') === 0) caches.delete(n); });
      }).catch(function(){});
      return;
    }
    navigator.serviceWorker.addEventListener('controllerchange', function(){
      if (updateAccepted) location.reload();
    });
    navigator.serviceWorker.addEventListener('message', function(event){
      var data = event.data || {};
      if (data.type === 'SW_VERSION' && data.version && data.version !== APP_VERSION){
        qs('updateBannerTitle').textContent = 'Versjon ' + data.version + ' er klar';
      }
    });
    qs('updateNowBtn').addEventListener('click', acceptUpdate);
    qs('updateLaterBtn').addEventListener('click', function(){
      updateDismissed = true; // spør igjen neste gang appen startes
      qs('updateBanner').hidden = true;
    });
    var start = function(){
      navigator.serviceWorker.register('/sw.js').then(function(reg){
        swRegistration = reg;
        if (reg.waiting) showUpdateBanner(reg.waiting);
        reg.addEventListener('updatefound', function(){
          /** @type {any} */
          var worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', function(){
            // Uten en som styrer siden fra før er dette første installasjon, ikke en oppdatering.
            if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
          });
        });
        checkForAppUpdate();
      }).catch(function(){ /* uten service worker går appen rett mot nettet, og er alltid nyeste versjon */ });
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    document.addEventListener('visibilitychange', function(){ if (!document.hidden) checkForAppUpdate(); });
    window.addEventListener('online', checkForAppUpdate);
    window.addEventListener('pageshow', function(e){ if (e.persisted) checkForAppUpdate(); });
    setInterval(function(){ if (!document.hidden) checkForAppUpdate(); }, UPDATE_CHECK_EVERY_MS);
  }

  /** @returns {Promise<any>} */
  function checkForAppUpdate(){
    if (!swRegistration) return Promise.resolve();
    return swRegistration.update().catch(function(){ /* uten nett: prøver igjen senere */ });
  }

  /** @param {ServiceWorker} worker */
  function showUpdateBanner(worker){
    waitingWorker = worker;
    if (updateDismissed || updateAccepted) return;
    qs('updateBannerSub').textContent = state && state.players.length > 0 && !spectatorCode
      ? 'Kampen og klokkene fortsetter der de er.'
      : 'Tar bare et øyeblikk.';
    qs('updateBanner').hidden = false;
    worker.postMessage({ type: 'GET_VERSION' });
  }

  function acceptUpdate(){
    if (!waitingWorker) return;
    updateAccepted = true;
    if (state) saveStateLocally(); // alt skal ligge trygt før siden lastes på nytt
    var btn = qs('updateNowBtn');
    btn.disabled = true;
    btn.textContent = 'Oppdaterer …';
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(function(){ location.reload(); }, 4000); // reserve om nettleseren aldri sier fra
  }

  // «Se etter oppdatering» i versjonsvinduet.
  function checkForUpdateNow(){
    var note = qs('checkUpdateNote');
    if (!swRegistration){
      note.textContent = serviceWorkerAllowed()
        ? 'Du har versjon ' + APP_VERSION + '. Fikk ikke sjekket akkurat nå.'
        : 'Du kjører versjon ' + APP_VERSION + ' lokalt, og ser alltid de nyeste filene.';
      return;
    }
    var reg = swRegistration;
    note.textContent = 'Ser etter oppdatering …';
    updateDismissed = false;
    reg.update().then(function(){
      if (reg.waiting) showUpdateBanner(reg.waiting);
      note.textContent = reg.waiting || reg.installing ? 'Ny versjon funnet.' : 'Du har nyeste versjon (' + APP_VERSION + ').';
    }).catch(function(){
      note.textContent = 'Fikk ikke kontakt. Du har versjon ' + APP_VERSION + '.';
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
  var UNDO_MAX = 20;
  // Call whenever `state` is replaced WHOLESALE by data from somewhere else
  // (joining a session, adopting an incoming realtime update, adopting the
  // server's row on reconnect) rather than by a local, well-scoped
  // mutation. Without this, undoStack/redoStack keep holding snapshots
  // taken from a `state` that's no longer the ancestor of the one now
  // live - pressing "Angre" afterwards would restore that stale snapshot
  // wholesale, silently discarding whatever arrived in the meantime (e.g. a
  // co-editor's own edit, or the entire session just joined). Undo simply
  // doesn't make sense across a boundary like that, so the safest thing is
  // to make there be nothing to undo, rather than undo the wrong thing.
  function clearUndoHistory(){
    undoStack = [];
    redoStack = [];
    updateUndoUI();
  }
  var settingsDirty = false; // true once anything that only takes effect on "OK" (names, kampvarighet, byttetid, first-run feltstørrelse) has been touched since openSettings() - drives the × close button's "save changes?" prompt
  // Draft values for the new Innstillinger screen's steppers - only written
  // to COACH_DEFAULTS_KEY when "Lagre" is pressed (see saveSettingsScreen()).
  var settingsDraftMatchDurationMin = 15;
  var settingsDraftSwapDurationMin = 3;
  var settingsDraftFieldSize = 3;
  var settingsDraftHalves = 1;
  /** @type {'auto'|'on'|'off'} */
  var settingsDraftKeeper = 'auto';
  // Same idea for the pre-kamp Innstillinger-vinduet (#settingsModal): the
  // tallknapper/Kampformat edit these drafts, saveSettings() applies them on
  // OK. The *Init values are what openSettings() found, so a value that was
  // never touched is left exactly as it was (e.g. a byttetid of 2:30 from
  // before the whole-minute buttons - OK alone must not round it).
  var modalDraft = { matchMin: 15, matchMinInit: 15, swapMin: 3, swapMinInit: 3, fieldSize: 3, fieldSizeInit: 3, keeper: false, halves: 1, setup: false };
  /** @type {{match: any, swap: any}} */
  var modalSteps = { match: null, swap: null };
  /** @type {{match: any, swap: any}} */
  var homeSteps = { match: null, swap: null };
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
    share: {
      title: 'Del økt med andre',
      text: 'Slår på sanntidsdeling med en kode. Du velger om andre får redigeringsrettighet (standard), slik at alle i økten kan bytte og styre kampen, eller kun «les». Foreldre får en egen lenke som aldri kan endre noe.'
    },
    endPeriod: {
      title: 'Kampslutt, ny kamp',
      text: 'Avslutter denne kampen, men beholder laget og total spilletid til neste kamp.'
    },
    endReset: {
      title: 'Avslutt økten',
      text: 'Starter helt på nytt: nullstiller spilletid, mål og kamptelling for alle. Krever et andre trykk.'
    },
    leaveMatch: {
      title: 'Til hjemskjermen',
      text: 'Kampen røres ikke. «Fortsett kampen» på hjemskjermen henter deg rett tilbake. Deler du økten, er du fortsatt med i den.'
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
  var avsluttConfirm, transferOwnerConfirm;
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

  /** @param {string} id @returns {any} */
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
      homeTeamName: coachDefaults.homeTeamName,
      homeTeamAbbr: coachDefaults.homeTeamAbbr,
      hasKeeper: keeperDefaultFor(coachDefaults.fieldSize, coachDefaults.keeper),
      halves: coachDefaults.halves,
      halfStage: 1,
      planEnabled: false,
      cup: null,
      keeperMs: {},
      keeperNow: null,
      players: [],
      onField: [],
      onBench: [],
      fieldTimers: {},
      benchTimers: {},
      cumulative: {},
      periodStartCumulative: {},
      matchClock: { baseElapsedMs: 0, sinceTs: nowTs() },
      fieldSize: coachDefaults.fieldSize,
      fieldSlotAssignment: null,
      globalRunning: false,
      defaultDurationMs: coachDefaults.defaultDurationMs,
      matchDurationMs: coachDefaults.matchDurationMs,
      rankByCumulative: coachDefaults.rankByCumulative,
      reorgUsesLastMatch: coachDefaults.reorgUsesLastMatch,
      swapSuggestionBasis: coachDefaults.swapSuggestionBasis,
      swapSuggestionBenchMode: coachDefaults.swapSuggestionBenchMode,
      shareEditable: true,
      sessionOwnerDeviceId: null,
      participants: [],
      goalLog: [],
      swapCount: 0,
      lastActivityAt: nowTs(),
      lastPlayAt: nowTs(),
      continueCount: 0,
      opponentName: '',
      opponentAbbr: '',
      matchHistory: [],
      eventLog: [],
      opIds: [],
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
  //
  // This is also the only gate on UNTRUSTED data: `sessions` is open to anyone
  // with the (public) key, so what comes back from Supabase may be malformed or
  // hostile. Everything the app later puts into innerHTML or does arithmetic on
  // is forced into its expected shape here: ids can't contain markup, names are
  // strings, every timer is a real number, and every player sits in exactly one
  // zone (one in neither would otherwise be invisible for the rest of the match).
  /**
   * @param {any} raw
   * @returns {AppState|null}
   */
  function normalizeState(raw){
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.players)) return null;
    var now = nowTs();
    /** @type {Object<string, boolean>} */
    var known = {};
    raw.players = raw.players.filter(function(p){
      if (!p || typeof p !== 'object' || !isSafeId(p.id) || typeof p.name !== 'string' || !p.name.trim() || known[p.id]) return false;
      known[p.id] = true;
      return true;
    });
    /** @type {Object<string, boolean>} */
    var placed = {};
    /** @param {any} list @returns {string[]} */
    var cleanZone = function(list){
      return (Array.isArray(list) ? list : []).filter(function(id){
        if (typeof id !== 'string' || !known[id] || placed[id]) return false;
        placed[id] = true;
        return true;
      });
    };
    raw.onField = cleanZone(raw.onField);
    raw.onBench = cleanZone(raw.onBench);
    raw.players.forEach(function(p){ if (!placed[p.id]) raw.onBench.push(p.id); });
    /** @param {any} src @param {string[]} ids @returns {Object<string, {baseElapsedMs:number, sinceTs:number}>} */
    var cleanTimers = function(src, ids){
      var out = {};
      ids.forEach(function(id){
        var t = src && typeof src === 'object' ? src[id] : null;
        out[id] = {
          baseElapsedMs: t && isFinite(t.baseElapsedMs) && t.baseElapsedMs > 0 ? Number(t.baseElapsedMs) : 0,
          sinceTs: t && typeof t.sinceTs === 'number' && isFinite(t.sinceTs) ? t.sinceTs : now
        };
      });
      return out;
    };
    raw.fieldTimers = cleanTimers(raw.fieldTimers, raw.onField);
    raw.benchTimers = cleanTimers(raw.benchTimers, raw.onBench);
    /** @param {any} src @returns {Object<string, {fieldMs:number, benchMs:number}>} */
    var cleanCumulative = function(src){
      var out = {};
      Object.keys(src && typeof src === 'object' ? src : {}).forEach(function(id){
        var c = src[id];
        if (!isSafeId(id) || !c || typeof c !== 'object') return;
        out[id] = { fieldMs: isFinite(c.fieldMs) ? Number(c.fieldMs) || 0 : 0, benchMs: isFinite(c.benchMs) ? Number(c.benchMs) || 0 : 0 };
      });
      return out;
    };
    raw.cumulative = cleanCumulative(raw.cumulative);
    raw.periodStartCumulative = cleanCumulative(raw.periodStartCumulative);
    var mc = raw.matchClock;
    raw.matchClock = {
      baseElapsedMs: mc && typeof mc.baseElapsedMs === 'number' && isFinite(mc.baseElapsedMs) && mc.baseElapsedMs > 0 ? mc.baseElapsedMs : 0,
      sinceTs: mc && typeof mc.sinceTs === 'number' && isFinite(mc.sinceTs) ? mc.sinceTs : now
    };
    raw.fieldSize = Math.max(1, Math.min(11, Math.round(Number(raw.fieldSize)) || 3));
    raw.globalRunning = raw.globalRunning === true;
    if (typeof raw.sessionUid !== 'string') delete raw.sessionUid;
    if (typeof raw.sessionOwnerDeviceId !== 'string') raw.sessionOwnerDeviceId = null;
    raw.participants = (Array.isArray(raw.participants) ? raw.participants : []).filter(function(p){
      return p && typeof p === 'object' && typeof p.deviceId === 'string' && typeof p.joinedAt === 'number';
    });
    raw.goalLog = (Array.isArray(raw.goalLog) ? raw.goalLog : []).filter(function(g){
      return g && typeof g === 'object' && (g.team === 'home' || g.team === 'away');
    }).map(function(g){
      return {
        id: typeof g.id === 'string' ? g.id : uid(),
        team: g.team,
        playerId: isSafeId(g.playerId) ? g.playerId : null,
        at: typeof g.at === 'number' && isFinite(g.at) ? g.at : 0,
        matchMs: typeof g.matchMs === 'number' && isFinite(g.matchMs) ? g.matchMs : 0
      };
    });
    raw.matchHistory = (Array.isArray(raw.matchHistory) ? raw.matchHistory : []).filter(function(m){
      return m && typeof m === 'object';
    }).map(function(m){
      var playerMs = {};
      Object.keys(m.playerMs && typeof m.playerMs === 'object' ? m.playerMs : {}).forEach(function(id){
        if (isSafeId(id) && isFinite(m.playerMs[id])) playerMs[id] = Number(m.playerMs[id]) || 0;
      });
      return {
        id: typeof m.id === 'string' ? m.id : uid(),
        opponentName: typeof m.opponentName === 'string' ? m.opponentName : '',
        opponentAbbr: typeof m.opponentAbbr === 'string' ? m.opponentAbbr : '',
        homeScore: Number(m.homeScore) || 0,
        awayScore: Number(m.awayScore) || 0,
        endedAt: Number(m.endedAt) || 0,
        playerMs: playerMs,
        goals: (Array.isArray(m.goals) ? m.goals : []).filter(function(g){
          return g && typeof g === 'object' && typeof g.playerName === 'string';
        }).map(function(g){
          return { playerId: isSafeId(g.playerId) ? g.playerId : '', playerName: g.playerName, matchMs: Number(g.matchMs) || 0 };
        })
      };
    });
    if (!Array.isArray(raw.fieldSlotAssignment)) raw.fieldSlotAssignment = null;
    if (typeof raw.defaultDurationMs !== 'number' || raw.defaultDurationMs <= 0) raw.defaultDurationMs = 180000;
    if (typeof raw.matchDurationMs !== 'number' || raw.matchDurationMs <= 0) raw.matchDurationMs = 1200000;
    if (raw.rankByCumulative === undefined) raw.rankByCumulative = false;
    if (raw.reorgUsesLastMatch === undefined) raw.reorgUsesLastMatch = false;
    if (raw.swapSuggestionBasis !== 'cumulative') raw.swapSuggestionBasis = 'match';
    if (raw.swapSuggestionBenchMode !== 'cumulative') raw.swapSuggestionBenchMode = 'waited';
    if (raw.shareEditable === undefined) raw.shareEditable = true;
    if (typeof raw.swapCount !== 'number') raw.swapCount = 0;
    if (typeof raw.lastActivityAt !== 'number') raw.lastActivityAt = nowTs();
    if (typeof raw.lastPlayAt !== 'number') raw.lastPlayAt = raw.lastActivityAt;
    if (typeof raw.continueCount !== 'number') raw.continueCount = 0;
    if (typeof raw.opponentName !== 'string') raw.opponentName = '';
    if (typeof raw.opponentAbbr !== 'string') raw.opponentAbbr = '';
    if (typeof raw.rev !== 'number' || !isFinite(raw.rev)) raw.rev = 0;
    raw.eventLog = (Array.isArray(raw.eventLog) ? raw.eventLog : []).filter(function(ev){
      return ev && typeof ev === 'object' && typeof ev.k === 'string';
    }).map(function(ev){
      return { k: ev.k, at: Number(ev.at) || 0, ms: Number(ev.ms) || 0, a: isSafeId(ev.a) ? ev.a : null, b: isSafeId(ev.b) ? ev.b : null, team: ev.team === 'away' ? 'away' : 'home' };
    });
    if (typeof raw.hasKeeper !== 'boolean') delete raw.hasKeeper;
    raw.halves = raw.halves === 2 ? 2 : 1;
    raw.halfStage = raw.halfStage === 2 ? 2 : 1;
    raw.planEnabled = raw.planEnabled === true;
    raw.homeTeamName = typeof raw.homeTeamName === 'string' && raw.homeTeamName ? raw.homeTeamName.slice(0, 60) : null;
    raw.homeTeamAbbr = typeof raw.homeTeamAbbr === 'string' && raw.homeTeamAbbr ? raw.homeTeamAbbr.slice(0, 8) : null;
    if (raw.cup && typeof raw.cup === 'object'){
      raw.cup = {
        name: typeof raw.cup.name === 'string' ? raw.cup.name.slice(0, 60) : '',
        matches: (Array.isArray(raw.cup.matches) ? raw.cup.matches : []).filter(function(m){ return m && typeof m === 'object'; }).map(function(m){
          return { id: typeof m.id === 'string' ? m.id : uid(), time: /^\d\d:\d\d$/.test(m.time) ? m.time : '', opponent: typeof m.opponent === 'string' ? m.opponent.slice(0, 60) : '' };
        })
      };
    } else {
      raw.cup = null;
    }
    var keeperMs = {};
    Object.keys(raw.keeperMs && typeof raw.keeperMs === 'object' ? raw.keeperMs : {}).forEach(function(id){
      if (isSafeId(id) && isFinite(raw.keeperMs[id])) keeperMs[id] = Number(raw.keeperMs[id]) || 0;
    });
    raw.keeperMs = keeperMs;
    raw.keeperNow = raw.keeperNow && isSafeId(raw.keeperNow.id) && isFinite(raw.keeperNow.sinceMs) ? { id: raw.keeperNow.id, sinceMs: Number(raw.keeperNow.sinceMs) } : null;
    raw.opIds = (Array.isArray(raw.opIds) ? raw.opIds : []).filter(function(id){ return typeof id === 'string'; }).slice(-OP_ID_MEMORY);
    return raw;
  }

  // Player ids go into data-id attributes and querySelector strings. uid() only
  // ever produces these characters, so anything else is not one of ours.
  /** @param {any} id @returns {boolean} */
  function isSafeId(id){
    return typeof id === 'string' && /^[\w-]{1,64}$/.test(id);
  }

  // Drops timeUpNotified entries that no longer match reality after `state`
  // was replaced wholesale by data from another device: a player who is off
  // the field, or back on the field with time still remaining (a fresh
  // stint someone else gave them), should be able to trigger the beep again
  // next time their timer actually hits zero on this device.
  function resyncTimeUpNotified(){
    var now = nowTs();
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
    if (spectatorCode) return; // foreldrevisningen skal aldri røre en kamp som ligger på telefonen
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (pendingOps.length > 0) localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(pendingOps));
      else localStorage.removeItem(PENDING_OPS_KEY);
    }
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
    state.lastActivityAt = nowTs();
    if (!opRecorded && sessionCode) plainEditPending = true;
    opRecorded = false;
    saveStateLocally();
    pushRemoteState();
  }

  // Same as saveState() but without touching lastActivityAt - for a system
  // correction (the idle auto-pause below) that isn't a real action by anyone.
  function flushState(){
    saveStateLocally();
    // canEdit() gate - "read-only" should mean no writes, full stop.
    if (canEdit()) pushRemoteState();
  }

  /* ---------------- Sync with the shared session ----------------
     The rules, in one place:
     - Every write is conditional: the server only accepts a rev strictly newer than the row's.
       A device that slept through half a match can't roll the row back, whichever code path
       decided to write.
     - Whenever a device may have missed something (the channel (re)connected, the network came
       back, the app came to the foreground, a ping arrived) it reads the row FIRST and only then
       decides who is ahead (reconcileWithServer). Read-only devices do this too.
     - Nothing is written unless something actually changed (remoteDirty). A no-op write would
       bump rev and make everyone else redraw each time a phone locks.
     - Two coaches at once: local actions are recorded as operations (recordOp). If the server
       turns out to be ahead, this device takes the server's state and plays its own unconfirmed
       operations on top, so both coaches' swaps survive. An edit that isn't an operation (angre)
       can't be replayed: the server wins and the coach is told.
     - The database is reached through functions (get_session and friends), because the table
       itself is closed after privacy step 2. Before step 1 has been run they don't exist, and the
       app uses the table directly as it always did, so app and database can be updated in any
       order. See supabase/migrations/ and PROSJEKT-OPPSUMMERING.md. */
  var remoteDirty = false;       // local edits the server hasn't confirmed yet
  var sessionVerified = false;   // the row has been compared with local state since this device entered the session
  var participantChecked = false;
  var pushSeq = 0;               // only the newest write's answer may clear remoteDirty
  /** @type {Promise<void>|null} */
  var reconcileInFlight = null;
  var reconcileGen = 0;
  var reconcileAgain = false;    // a ping arrived while a read was on its way: that read may already be too old
  var lastReconcileAt = 0;
  var RECONCILE_TIMEOUT_MS = 8000;
  var SYNC_WAIT_MS = 3000;       // how long startup/resume waits for the server before carrying on with local state
  /** @type {boolean|null} */
  var rpcAvailable = null;       // null until the database has answered; false = step 1 hasn't been run
  /** @type {string|null} */
  var sessionViewCode = null;    // the read-only code for the parent link (the row's view_code)
  /** @type {any[]} */
  var pendingOps = [];           // operations the server hasn't confirmed, oldest first
  var opRecorded = false;        // set by recordOp, read by saveState: was this save an operation?
  var plainEditPending = false;  // an unconfirmed edit that isn't an operation
  var PENDING_OPS_KEY = 'spillerbytte_pending_ops_v1';
  var OP_ID_MEMORY = 64;
  /** @type {string|null} */
  var spectatorCode = null;      // set while this is a parent link (?se=...): nothing is ever written or stored

  /** @param {any} res @returns {boolean} */
  function isRpcMissing(res){
    return !!(res && res.error && (res.error.code === 'PGRST202' || res.error.code === '42883' || res.status === 404));
  }
  function noteRpcMissing(){
    if (rpcAvailable === false) return;
    rpcAvailable = false;
    if (sessionCode) subscribeToSession(sessionCode); // the pings come from a trigger in step 1 too: listen to the table instead
  }

  // {ok:false} = no contact, {ok:true,row:null} = no such session.
  /** @param {string} code @returns {Promise<{ok:boolean, row:any}>} */
  function fetchSessionRow(code){
    var sentAt = Date.now();
    /** @returns {Promise<{ok:boolean, row:any}>} */
    var direct = function(){
      return sb.from('sessions').select('*').eq('code', code).maybeSingle().then(function(/** @type {any} */ res){
        if (!res || res.error) return { ok: false, row: null };
        return { ok: true, row: res.data || null };
      });
    };
    if (rpcAvailable === false) return direct();
    return sb.rpc('get_session', { p_code: code }).then(function(/** @type {any} */ res){
      if (isRpcMissing(res)){ noteRpcMissing(); return direct(); }
      if (!res || res.error) return { ok: false, row: null };
      rpcAvailable = true;
      var row = Array.isArray(res.data) ? res.data[0] : res.data;
      if (row) noteServerTime(row.server_now, sentAt, Date.now());
      return { ok: true, row: row || null };
    });
  }

  function pushRemoteState(){
    if (!sessionCode || !sb || spectatorCode) return;
    state.rev = (typeof state.rev === 'number' ? state.rev : 0) + 1;
    remoteDirty = true;
    sendRemoteState();
  }

  // force: skip the rev condition - only for a row without a numeric rev when talking to the table
  // directly, which the JSON filter can never match (the database functions handle this themselves).
  /** @param {boolean} [force] */
  function sendRemoteState(force){
    if (!sessionCode || !sb || !sessionVerified || spectatorCode) return; // stays dirty; reconcileWithServer sends it once it's safe
    var code = sessionCode;
    var seq = ++pushSeq;
    var sentIds = pendingOps.map(function(op){ return op.id; });
    var sentAt = Date.now();
    var confirmed = function(){
      pendingOps = pendingOps.filter(function(op){ return sentIds.indexOf(op.id) === -1; });
      if (seq === pushSeq && pendingOps.length === 0){
        remoteDirty = false;
        plainEditPending = false;
      }
      saveStateLocally();
    };
    var direct = function(){
      var query = sb.from('sessions')
        .update({ data: state, origin: deviceOrigin, updated_at: new Date().toISOString() })
        .eq('code', code);
      // data->rev (not ->>): jsonb compares as numbers, text would sort "9" above "10".
      if (!force) query = query.lt('data->rev', state.rev);
      return query.select('code').then(function(/** @type {any} */ res){
        if (code !== sessionCode) return;
        if (res && res.error){ console.warn('Kunne ikke synkronisere', res.error); return; } // still dirty - retried by the heartbeat and on reconnect
        if (res && Array.isArray(res.data) && res.data.length === 0){ reconcileWithServer(); return; } // the server is ahead of this write (or the row is gone)
        confirmed();
      });
    };
    var sent = rpcAvailable === false ? direct() : sb.rpc('update_session', { p_code: code, p_data: state, p_origin: deviceOrigin }).then(function(/** @type {any} */ res){
      if (isRpcMissing(res)){ noteRpcMissing(); return direct(); }
      if (code !== sessionCode) return;
      if (!res || res.error){ console.warn('Kunne ikke synkronisere', res && res.error); return; }
      rpcAvailable = true;
      var row = Array.isArray(res.data) ? res.data[0] : res.data;
      if (row) noteServerTime(row.server_now, sentAt, Date.now());
      if (row && row.updated) confirmed();
      else reconcileWithServer();
    });
    sent.catch(function(/** @type {any} */ e){ console.warn('Kunne ikke synkronisere', e); });
  }

  function flushRemoteIfDirty(){
    if (!sessionCode || !sb || !remoteDirty) return;
    if (!sessionVerified) reconcileWithServer();
    else if (canEdit()) sendRemoteState();
  }

  // True if `incoming` is someone else's session that happens to use the same
  // code: rows are cleaned up after 60 days and three-digit codes get reused, and
  // a phone returning after that still has the old code and a high rev.
  /** @param {AppState} incoming @returns {boolean} */
  function isDifferentSession(incoming){
    if (!state || state.players.length === 0) return false; // nothing local to protect
    return !!incoming.sessionUid && incoming.sessionUid !== state.sessionUid;
  }

  // The one place a remote state replaces this device's state outright.
  /** @param {AppState} incoming */
  function adoptRemoteState(incoming){
    var wasMaster = isMaster();
    state = incoming;
    pendingOps = [];
    plainEditPending = false;
    remoteDirty = false;
    clearUndoHistory(); // see its own comment - this device's undo history predates whatever just arrived
    dropStaleSelection();
    saveStateLocally();
    resyncTimeUpNotified();
    renderAll();
    if (!wasMaster && isMaster()) showOwnerTransferredNotice();
  }

  // The server is ahead and this device has its own unconfirmed operations: keep both.
  /** @param {AppState} server */
  function mergeOntoServer(server){
    var ops = pendingOps.slice();
    var wasMaster = isMaster();
    state = server;
    clearUndoHistory();
    ops.forEach(function(op){
      try { applyOp(op); } catch(e){ console.warn('Kunne ikke spille av en endring', op, e); }
    });
    dropStaleSelection();
    resyncTimeUpNotified();
    saveStateLocally();
    renderAll();
    if (!wasMaster && isMaster()) showOwnerTransferredNotice();
    pushRemoteState();
  }

  // What's marked on this device may no longer be true once another device has moved people.
  function dropStaleSelection(){
    if (selected && (selected.zone === 'field' ? state.onField : state.onBench).indexOf(selected.id) === -1){
      selected = null;
      suggestedPartnerId = null;
    }
    if (suggestedPartnerId && state.onBench.indexOf(suggestedPartnerId) === -1){
      suggestedPartnerId = null;
    }
    multiSelected = multiSelected.filter(function(id){ return !!playerById(id); });
  }

  // Decides what a row from the server means for this device.
  /** @param {AppState} server @param {string|null|undefined} origin @param {boolean} hasRev */
  function applyServerRow(server, origin, hasRev){
    if (isDifferentSession(server)){
      detachFromSession('Koden brukes nå av en annen økt. Kampen fortsetter bare på denne enheten.');
      return;
    }
    sessionVerified = true;
    // Redrawing now would remove the element the finger is on; the pointerup would never arrive
    // and the drag ghost would stay on screen. Taken up when the finger lets go - see onPointerDown.
    if (activeDragCancel){
      pendingRemoteRow = { server: server, origin: origin, hasRev: hasRev };
      return;
    }
    var sameRev = server.rev === state.rev;
    var fromOther = origin !== deviceOrigin;
    var dirty = remoteDirty || pendingOps.length > 0 || plainEditPending;
    if (sameRev && !fromOther){
      // Our own write landed, only the answer got lost.
      pendingOps = [];
      plainEditPending = false;
      remoteDirty = false;
    } else if (server.rev > state.rev || (sameRev && fromOther)){
      if (!canEdit() || !dirty) adoptRemoteState(server);
      else if (pendingOps.length > 0 && !plainEditPending) mergeOntoServer(server);
      else {
        adoptRemoteState(server);
        showNotice('Noe ble endret på en annen enhet samtidig. Sjekk kampen og prøv igjen.');
      }
    } else if (!canEdit()){
      if (!sameRev) adoptRemoteState(server);
    } else {
      remoteDirty = true;
      sendRemoteState(!hasRev);
    }
    if (!participantChecked){
      participantChecked = true;
      if (ensureParticipant()) pushRemoteState();
    }
  }

  // Compares this device with the server row and brings whichever is behind up
  // to date. Never rejects, and safe to call as often as needed.
  /** @returns {Promise<void>} */
  function reconcileWithServer(){
    if (!sessionCode || !sb) return Promise.resolve();
    if (reconcileInFlight){ reconcileAgain = true; return reconcileInFlight; }
    var code = sessionCode;
    var gen = ++reconcileGen;
    /** @param {{ok:boolean, row:any}} result */
    var onRow = function(result){
      if (gen !== reconcileGen) return; // gave up on this one (see below): a late answer may be older than what a newer attempt found
      reconcileInFlight = null;
      if (code !== sessionCode) return;
      if (!result.ok) return; // no contact - the next signal tries again
      lastReconcileAt = Date.now();
      if (!result.row){
        detachFromSession('Den delte økten finnes ikke lenger. Kampen fortsetter bare på denne enheten.');
        return;
      }
      if (result.row.view_code) sessionViewCode = result.row.view_code;
      var rawData = result.row.data;
      var hasRev = !!rawData && typeof rawData === 'object' && typeof rawData.rev === 'number';
      var server = normalizeState(rawData);
      if (!server){
        console.warn('Lagret økt inneholdt ugyldig data, fortsetter med lokal tilstand');
        sessionVerified = true;
        return;
      }
      applyServerRow(server, result.row.origin, hasRev);
    };
    // A request can hang for a minute on iOS. Until the row has been compared nothing
    // can be written, so a stalled request must not block the next attempt that long.
    reconcileInFlight = new Promise(function(resolve){
      var timer = setTimeout(function(){
        if (gen === reconcileGen){ reconcileGen++; reconcileInFlight = null; }
        resolve();
      }, RECONCILE_TIMEOUT_MS);
      fetchSessionRow(code)
        .then(onRow)
        .catch(function(/** @type {any} */ e){
          if (gen === reconcileGen) reconcileInFlight = null;
          console.warn('Kunne ikke hente delt økt', e);
        })
        .then(function(){
          clearTimeout(timer);
          resolve();
          if (reconcileAgain && !reconcileInFlight){ reconcileAgain = false; reconcileWithServer(); }
        });
    });
    return reconcileInFlight;
  }

  // Runs fn once the server has answered, or after SYNC_WAIT_MS at the latest:
  // a hanging connection must never hold up a match on the screen.
  /** @param {() => void} fn */
  function afterSessionSync(fn){
    if (!sessionCode || !sb){ fn(); return; }
    var done = false;
    var once = function(){ if (!done){ done = true; fn(); } };
    reconcileWithServer().then(once, once);
    setTimeout(once, SYNC_WAIT_MS);
  }

  /** @param {string} message */
  function detachFromSession(message){
    leaveSession();
    showNotice(message);
  }

  /* ---------------- Operations: every change that can be replayed on top of a newer state ---------------- */

  // Applies one change to `state`. Must stay valid when run later, on a state another coach has
  // changed in the meantime, so each case checks that it still makes sense. op.at is when the
  // coach actually did it, which keeps the times right after a replay.
  /** @param {any} op */
  function applyOp(op){
    if (state.opIds.indexOf(op.id) !== -1) return; // already part of this state (a write whose answer got lost)
    state.opIds.push(op.id);
    if (state.opIds.length > OP_ID_MEMORY) state.opIds.shift();
    var at = op.at;
    switch (op.t){
      case 'swap':
        if (state.onField.indexOf(op.out) === -1 || state.onBench.indexOf(op.in) === -1) return;
        logEvent('swap', at, op.out, op.in);
        swapFieldAndBench(op.out, op.in, at);
        break;
      case 'toField':
        if (state.onBench.indexOf(op.p) === -1 || state.onField.length >= (state.fieldSize || 3)) return;
        logEvent('toField', at, op.p, null);
        commitBenchStint(op.p, at);
        state.onBench = state.onBench.filter(function(x){ return x !== op.p; });
        state.onField.push(op.p);
        state.fieldTimers[op.p] = { baseElapsedMs: 0, sinceTs: at };
        delete state.benchTimers[op.p];
        delete timeUpNotified[op.p];
        break;
      case 'toBench':
        if (state.onField.indexOf(op.p) === -1) return;
        logEvent('toBench', at, op.p, null);
        commitFieldStint(op.p, at);
        state.onField = state.onField.filter(function(x){ return x !== op.p; });
        delete state.fieldTimers[op.p];
        state.onBench.push(op.p);
        state.benchTimers[op.p] = { baseElapsedMs: 0, sinceTs: at };
        delete timeUpNotified[op.p];
        break;
      case 'pos':
        syncFieldSlots();
        var arr = state.fieldSlotAssignment;
        if (!arr) return;
        var ia = arr.indexOf(op.a), ib = arr.indexOf(op.b);
        if (ia === -1 || ib === -1) return;
        arr[ia] = op.b;
        arr[ib] = op.a;
        break;
      case 'goal':
        if (state.goalLog.some(function(g){ return g.id === op.goal.id; })) return;
        state.goalLog.push(op.goal);
        logEvent('goal', at, op.goal.playerId, null, op.goal.team);
        break;
      case 'ungoal':
        var before = state.goalLog.length;
        state.goalLog = state.goalLog.filter(function(g){ return g.id !== op.goalId; });
        if (state.goalLog.length !== before) logEvent('ungoal', at, null, null);
        break;
      case 'clock':
        if (op.run === state.globalRunning) return;
        if (op.run) startClockAt(at); else stopClockAt(at);
        logEvent(op.run ? 'start' : 'pause', at, null, null);
        break;
      case 'set':
        Object.keys(op.fields).forEach(function(k){ state[k] = op.fields[k]; });
        break;
      case 'trim':
        trimElapsedTime(op.ms);
        if (op.pause) pauseClock();
        if (op.continueReset) state.continueCount = 0;
        break;
      case 'roster':
        applyRoster(op);
        break;
      case 'halftime':
        if (state.halfStage === 2) return;
        if (state.globalRunning) stopClockAt(at);
        state.halfStage = 2;
        break;
      case 'endMatch':
        applyEndMatch(!!op.reorganize, at, op.nextOpponentName, op.nextOpponentAbbr);
        break;
      case 'reset':
        applyReset();
        break;
      case 'participant':
        ensureParticipant();
        break;
      default:
        return;
    }
    if (op.t === 'swap' || op.t === 'toField' || op.t === 'toBench' || op.t === 'pos' || op.t === 'goal' || op.t === 'ungoal' || op.t === 'clock') state.lastPlayAt = at;
  }

  // Runs a change now and remembers it until the server has confirmed it. The caller still decides
  // when to save (saveState) and draw, so one tap can consist of several operations.
  /** @param {any} op */
  function recordOp(op){
    op.at = op.at || nowTs();
    op.id = uid();
    applyOp(op);
    if (sessionCode){
      pendingOps.push(op);
      opRecorded = true;
    }
  }

  // For the many small settings that are just "these fields now have these values".
  /** @param {Object<string, any>} fields */
  function setShared(fields){
    recordOp({ t: 'set', fields: fields });
    saveState();
  }

  /** @param {string} k @param {number} at @param {string|null} a @param {string|null} b @param {'home'|'away'} [team] */
  function logEvent(k, at, a, b, team){
    state.eventLog.push({ k: k, at: at, ms: matchClockElapsed(at), a: a, b: b, team: team === 'away' ? 'away' : 'home' });
    if (state.eventLog.length > 300) state.eventLog.shift();
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
    if (spectatorCode) return false;
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
    if (spectatorCode) return false;
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
    state.participants.push({ deviceId: deviceId, joinedAt: nowTs() });
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
    var mins = Math.max(0, Math.round((nowTs() - joinedAt) / 60000));
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
      var healthy = !!sb && networkOnline && realtimeSubscribed;
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
    var channel = sb.channel('session-' + code);
    if (rpcAvailable === false){
      // Before privacy step 1: the row arrives with the update, as it always has.
      channel.on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: 'code=eq.' + code },
        function(/** @type {any} */ payload){
          if (!payload.new || payload.new.origin === deviceOrigin) return;
          var hasRev = payload.new.data && typeof payload.new.data.rev === 'number';
          var normalized = normalizeState(payload.new.data);
          if (!normalized){ console.warn('Mottok ugyldig delt tilstand fra økt, ignorerer'); return; }
          if (!isNewerRevision(normalized)){ console.warn('Ignorerte en foreldet delt tilstand (rev ' + normalized.rev + ' < ' + state.rev + ')'); return; }
          applyServerRow(normalized, payload.new.origin, hasRev);
        }
      );
    } else {
      // Only a ping with no names in it (a trigger in the database sends it): the row itself is
      // fetched by whoever knows the code.
      channel.on('broadcast', { event: 'changed' }, function(/** @type {any} */ message){
        var ping = message && message.payload;
        if (!ping || ping.origin === deviceOrigin) return;
        if (typeof ping.rev === 'number' && ping.rev < state.rev) return;
        reconcileWithServer();
      });
    }
    realtimeChannel = channel.subscribe(function(/** @type {string} */ status){
      realtimeSubscribed = (status === 'SUBSCRIBED');
      updateSessionCodeUI();
      // Fires again after every reconnect. Realtime doesn't replay what was
      // missed while disconnected, so read the row first and let
      // reconcileWithServer() decide who is ahead - never push blindly (that's
      // how a dormant phone once clobbered an active match).
      if (realtimeSubscribed) reconcileWithServer();
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
    sessionVerified = false;
    participantChecked = false;
    remoteDirty = false;
    pendingOps = [];
    plainEditPending = false;
    pendingRemoteRow = null;
    sessionViewCode = null;
    try { localStorage.removeItem(SESSION_CODE_KEY); } catch(e){}
    updateSessionCodeUI();
  }

  // Ownership has to go somewhere when the owner leaves, or nobody can administer
  // the session any more. No-op for a non-owner, or with nobody else to hand it to.
  function handOffOwnershipIfOwner(){
    if (!isMaster()) return;
    var target = longestTenuredOtherParticipant();
    if (!target) return;
    setShared({ sessionOwnerDeviceId: target.deviceId });
  }

  function generateCode(){
    return String(Math.floor(Math.random()*1000)).padStart(3,'0');
  }

  // Picks a random code that ISN'T already a row in `sessions`, by fetching
  // every code currently in use and choosing uniformly among whatever's
  // left out of the 1000 possible (000-999) - callback(code) with a
  // genuinely free one, or callback(null) if the fetch itself failed or
  // literally every code is taken right now. Blind random-and-hope-it's-
  // free (see generateCode() above, still used as createNewSession()'s own
  // fallback) degrades badly as the table fills up - at 90% full it's
  // still fine, but well before 100% full its fixed 5-attempt retry budget
  // starts failing outright even though free codes still exist elsewhere.
  // Checking first instead succeeds in one shot for as long as any code at
  // all remains free.
  function pickFreeCode(callback){
    if (!sb){ callback(null); return; }
    sb.from('sessions').select('code').then(function(res){
      if (!res || res.error || !Array.isArray(res.data)){ callback(null); return; }
      var used = {};
      res.data.forEach(function(row){ used[row.code] = true; });
      var free = [];
      for (var i = 0; i < 1000; i++){
        var code = String(i).padStart(3, '0');
        if (!used[code]) free.push(code);
      }
      if (free.length === 0){ callback(null); return; }
      callback(free[Math.floor(Math.random() * free.length)]);
    });
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
    state.sessionUid = uid();
    state.participants = []; // devices from an earlier session on this phone aren't part of this one
    ensureParticipant();

    function onCreated(code){
      sessionCode = code;
      sessionVerified = true; // this device just wrote the row itself
      participantChecked = true;
      remoteDirty = false;
      pendingOps = [];
      plainEditPending = false;
      saveStateLocally(); // right away: the code and sessionUid must never be out of step (see isDifferentSession)
      try { localStorage.setItem(SESSION_CODE_KEY, code); } catch(e){}
      subscribeToSession(code);
      updateSessionCodeUI();
      callback(code);
    }

    // Blind generate-and-retry - kept only as a fallback now, for the two
    // cases pickFreeCode() below can't handle on its own: (1) its own
    // select() failed (network hiccup - still worth trying blind rather
    // than giving up outright), and (2) two devices fetching the free-code
    // list at nearly the same moment and both landing on the same code -
    // the insert fails on the table's own unique constraint either way, so
    // this loop (not the free-code lookup) is what actually recovers from
    // that rare race.
    var attempts = 0;
    function blindRetryInsert(){
      attempts++;
      var code = generateCode();
      sb.from('sessions').insert({ code: code, data: state, origin: deviceOrigin }).then(function(res){
        if (res && res.error){
          if (attempts < 5) { blindRetryInsert(); return; }
          callback(null);
          return;
        }
        onCreated(code);
      });
    }

    var createDirect = function(){
      pickFreeCode(function(code){
        if (!code){ blindRetryInsert(); return; }
        sb.from('sessions').insert({ code: code, data: state, origin: deviceOrigin }).then(function(res){
          if (res && res.error){ blindRetryInsert(); return; } // someone else grabbed it between our fetch and this insert
          onCreated(code);
        });
      });
    };
    if (rpcAvailable === false){ createDirect(); return; }
    // The server picks the code: nobody can list which ones are taken any more.
    sb.rpc('create_session', { p_data: state, p_origin: deviceOrigin }).then(function(/** @type {any} */ res){
      if (isRpcMissing(res)){ rpcAvailable = false; createDirect(); return; }
      var row = res && !res.error ? (Array.isArray(res.data) ? res.data[0] : res.data) : null;
      if (!row){ callback(null); return; }
      rpcAvailable = true;
      sessionViewCode = row.view_code || null;
      onCreated(row.code);
    }).catch(function(){ callback(null); });
  }

  // onError: no contact with the database at all - not the same thing as a code
  // that doesn't exist, and telling someone at the pitch "wrong code" sends them
  // looking for the wrong problem.
  /** @param {string} code @param {() => void} onSuccess @param {() => void} onNotFound @param {() => void} onError */
  function joinSession(code, onSuccess, onNotFound, onError){
    if (!sb){ onError(); return; }
    fetchSessionRow(code).then(function(result){
      if (!result.ok){ onError(); return; }
      if (!result.row){ onNotFound(); return; }
      var viewCode = result.row.view_code || null;
      var normalized = normalizeState(result.row.data);
      if (!normalized){ console.warn('Økten fantes, men data var ugyldig'); onNotFound(); return; }
      var incoming = normalized;
      var finish = function(){
        state = incoming;
        clearUndoHistory(); // this device's own pre-join history (if any) has nothing to do with the session it's adopting now
        selected = null;
        suggestedPartnerId = null;
        multiMode = false;
        multiSelected = [];
        sessionCode = code;
        sessionViewCode = viewCode;
        sessionVerified = true;
        participantChecked = true;
        remoteDirty = false;
        pendingOps = [];
        plainEditPending = false;
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
      };
      // The code submits itself on the third digit and there are only 1000 of
      // them, so a typo can land in a stranger's match. Nothing is replaced until
      // the coach has seen what they're about to join.
      if (state.players.length > 0 && sessionCode !== code) askJoinConfirm(code, incoming, finish);
      else finish();
    }).catch(function(){ onError(); });
  }

  /** @type {(() => void)|null} */
  var pendingJoinFinish = null;
  /** @param {string} code @param {AppState} incoming @param {() => void} finish */
  function askJoinConfirm(code, incoming, finish){
    var names = incoming.players.slice(0, 3).map(function(p){ return p.name; }).join(', ');
    var more = incoming.players.length > 3 ? ' og ' + (incoming.players.length - 3) + ' til' : '';
    var against = incoming.opponentName ? ', mot ' + incoming.opponentName : '';
    els.joinConfirmText.textContent = 'Økt ' + code + ': ' + (names || 'ingen spillere ennå') + more + against + '. ' +
      'Kampen som ligger på denne enheten blir erstattet og kan ikke hentes tilbake.';
    pendingJoinFinish = finish;
    els.joinConfirmModal.classList.add('open');
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
  //
  // The pitch often has no coverage at exactly the moment a match ends, and the
  // match summary only exists right then - so a row that can't be sent waits in
  // localStorage and is retried on startup, on reconnect and when the app comes
  // back to the foreground. The row carries a client-made id when possible, so a
  // retry after a lost response can't save the same match twice.
  var HISTORY_QUEUE_KEY = 'spillerbytte_history_queue_v1';
  var HISTORY_QUEUE_MAX = 50;

  /** @returns {any[]} */
  function loadHistoryQueue(){
    try {
      var parsed = JSON.parse(localStorage.getItem(HISTORY_QUEUE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch(e){ return []; }
  }
  /** @param {any[]} queue */
  function saveHistoryQueue(queue){
    try {
      if (queue.length === 0) localStorage.removeItem(HISTORY_QUEUE_KEY);
      else localStorage.setItem(HISTORY_QUEUE_KEY, JSON.stringify(queue.slice(-HISTORY_QUEUE_MAX)));
    } catch(e){ console.warn('Kunne ikke lagre historikk-køen', e); }
  }
  /** @param {any} row @returns {Promise<boolean>} */
  function insertHistoryRow(row){
    if (!sb) return Promise.resolve(false);
    return sb.from('match_history').insert(row).then(function(res){
      if (!res.error || res.error.code === '23505') return true; // 23505: already saved by an earlier attempt
      console.warn('Kunne ikke lagre kamp til historikk', res.error);
      return false;
    }).catch(function(e){
      console.warn('Kunne ikke lagre kamp til historikk', e);
      return false;
    });
  }
  /** @param {HistoryMatchEntry} entry @returns {Promise<boolean>} */
  function saveMatchToHistory(entry){
    /** @type {Object<string, any>} */
    var row = {
      ended_at: new Date(entry.endedAt).toISOString(),
      opponent_name: entry.opponentName || '',
      opponent_abbr: entry.opponentAbbr || '',
      home_score: entry.homeScore || 0,
      away_score: entry.awayScore || 0,
      players: entry.players || [],
      goals: entry.goals || [],
      origin: deviceOrigin
    };
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.id)) row.id = entry.id;
    return insertHistoryRow(row).then(function(ok){
      if (!ok) saveHistoryQueue(loadHistoryQueue().concat([row]));
      return ok;
    });
  }
  var historyQueueFlushing = false;
  function flushHistoryQueue(){
    if (historyQueueFlushing || !sb) return;
    var queue = loadHistoryQueue();
    if (queue.length === 0) return;
    historyQueueFlushing = true;
    /** @type {Object<string, boolean>} */
    var sent = {};
    var next = function(){
      var row = queue.shift();
      if (!row){
        // Re-read rather than overwrite: a match may have been queued while this ran.
        saveHistoryQueue(loadHistoryQueue().filter(function(r){ return !sent[r.ended_at]; }));
        historyQueueFlushing = false;
        return;
      }
      insertHistoryRow(row).then(function(ok){
        if (ok) sent[row.ended_at] = true;
        next();
      });
    };
    next();
  }
  // Shared by Kampslutt and Avslutt: the summary popup opens before the save has
  // answered, so the outcome is reported in that same popup.
  /** @param {HistoryMatchEntry} entry */
  function saveToHistoryWithNote(entry){
    if (els.matchSummaryHistoryNote) els.matchSummaryHistoryNote.hidden = true;
    saveMatchToHistory(entry).then(function(ok){
      if (ok || !els.matchSummaryHistoryNote) return;
      els.matchSummaryHistoryNote.textContent = 'Fikk ikke kontakt med databasen. Kampen er lagret på denne enheten og sendes til Historikk automatisk når det er mulig.';
      els.matchSummaryHistoryNote.hidden = false;
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
      reorg_uses_last_match: d.reorgUsesLastMatch,
      swap_suggestion_basis: d.swapSuggestionBasis,
      swap_suggestion_bench_mode: d.swapSuggestionBenchMode
    };
  }
  // Stall og nyere valg ligger i en egen jsonb-kolonne (privacy step 1). Skrives i et eget kall, så en
  // database uten kolonnen aldri kan velte lagringen av resten av innstillingene.
  function saveTeamExtras(){
    if (!sb || !isTeamAccountSignedIn()) return;
    var d = loadCoachDefaults();
    sb.from('team_settings').update({ extras: { roster: roster, halves: d.halves, keeper: d.keeper } }).eq('user_id', adminUser.id)
      .then(function(/** @type {any} */ res){ if (res && res.error) console.warn('Kunne ikke lagre stallen på kontoen', res.error); })
      .catch(function(/** @type {any} */ e){ console.warn('Kunne ikke lagre stallen på kontoen', e); });
  }
  /** @param {any} row @returns {CoachDefaults} */
  function rowToCoachDefaults(row){
    var extras = row.extras && typeof row.extras === 'object' ? row.extras : {};
    if (Array.isArray(extras.roster)){
      addNamesToRoster(extras.roster.filter(function(/** @type {any} */ n){ return typeof n === 'string' && n.trim(); }));
    }
    return {
      halves: extras.halves === 2 ? 2 : 1,
      keeper: extras.keeper === 'on' || extras.keeper === 'off' ? extras.keeper : 'auto',
      homeTeamName: row.home_team_name,
      homeTeamAbbr: row.home_team_abbr,
      matchDurationMs: row.match_duration_ms,
      defaultDurationMs: row.default_duration_ms,
      fieldSize: row.field_size,
      rankByCumulative: !!row.rank_by_cumulative,
      reorgUsesLastMatch: !!row.reorg_uses_last_match,
      swapSuggestionBasis: row.swap_suggestion_basis === 'cumulative' ? 'cumulative' : 'match',
      swapSuggestionBenchMode: row.swap_suggestion_bench_mode === 'cumulative' ? 'cumulative' : 'waited'
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

  // null = no contact (not the same as "no matches saved"). Anyone may INSERT a
  // row (see above), and the admin is the one reading them, so these fields are
  // forced into shape here rather than trusted further down.
  /** @returns {Promise<HistoryMatchEntry[]|null>} */
  function fetchMatchHistory(){
    if (!sb) return Promise.resolve(null);
    return sb.from('match_history').select('*').order('ended_at', { ascending: false }).then(function(res){
      if (res.error){ console.warn('Kunne ikke hente historikk', res.error); return null; }
      return (res.data || []).map(function(row){
        return {
          id: String(row.id),
          endedAt: new Date(row.ended_at).getTime(),
          opponentName: String(row.opponent_name || ''),
          opponentAbbr: String(row.opponent_abbr || ''),
          homeScore: Number(row.home_score) || 0,
          awayScore: Number(row.away_score) || 0,
          players: (Array.isArray(row.players) ? row.players : []).filter(function(p){ return p && typeof p === 'object'; }).map(function(p){
            return { id: String(p.id || ''), name: String(p.name || ''), ms: Number(p.ms) || 0, goals: Number(p.goals) || 0 };
          }),
          goals: (Array.isArray(row.goals) ? row.goals : []).filter(function(g){ return g && typeof g === 'object'; }).map(function(g){
            return { team: g.team === 'away' ? 'away' : 'home', scorerName: String(g.scorerName || ''), matchMs: Number(g.matchMs) || 0 };
          }),
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
  var registrationInProgress = false;
  var pendingPasswordRecovery = false;
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
    sb.auth.onAuthStateChange(function(/** @type {string} */ event, /** @type {any} */ session){
      if (event === 'PASSWORD_RECOVERY'){
        // Kan komme før appen er ferdig startet: init() ser etter flagget.
        pendingPasswordRecovery = true;
        if (els.newPasswordModal) els.newPasswordModal.classList.add('open');
      }
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
      // fall back to.
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
      // (Not during registration: that flow writes the account's first row itself,
      // with the chosen team name - seeding here too would race it and could win.)
      if (!wasTeamAccount && isTeamAccountSignedIn() && !registrationInProgress){
        var signedInId = adminUser.id;
        fetchTeamSettings(signedInId).then(function(remote){
          // Signed out (or switched account) while this was on its way.
          if (!adminUser || adminUser.id !== signedInId) return;
          if (remote) saveCoachDefaults(remote);
          // No row yet (a Historikk-admin-only login, or an account that
          // predates this feature) - leave the local cache as the seed and
          // push it up, so the account has something from here on.
          else upsertTeamSettings(signedInId, loadCoachDefaults());
          if (els.settingsScreen && els.settingsScreen.classList.contains('open')) openSettingsScreen();
          else if (els.settingsStorageNote) updateSettingsStorageNote();
        });
      } else if (wasTeamAccount && !isTeamAccountSignedIn() && els.settingsStorageNote){
        updateSettingsStorageNote();
      }
    });
  }

  /** @param {any} err @returns {boolean} */
  function isWrongPasswordError(err){
    return !!err && (err.code === 'invalid_credentials' || (err.status === 400 && err.code !== 'email_not_confirmed'));
  }
  /** @param {any} err @returns {string} */
  function authErrorMessage(err){
    if (err && err.code === 'email_not_confirmed') return 'E-posten er ikke bekreftet ennå. Se etter bekreftelsen i innboksen din.';
    if (isWrongPasswordError(err)) return 'Feil e-post eller passord.';
    if (err && err.status === 429) return 'For mange forsøk på kort tid. Vent litt og prøv igjen.';
    return 'Fikk ikke kontakt med innloggingen. Sjekk nettet og prøv igjen.';
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
  var historyListFailed = false;


  function fetchAndRenderHistoryList(){
    historyListLoading = true;
    renderHistoryList();
    fetchMatchHistory().then(function(list){
      historyListLoading = false;
      historyListFailed = !list;
      if (list) historyListCache = list; // no contact: keep showing what was already fetched
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
    els.historyEmpty.textContent = historyListFailed
      ? 'Fikk ikke kontakt med databasen. Sjekk nettet og prøv igjen.'
      : admin
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
        return '<div class="history-row-goal history-row-goal-' + (g.team === 'away' ? 'away' : 'home') + '">' +
          '<span class="history-row-goal-time">' + formatMs(g.matchMs) + '</span>' +
          '<span class="history-row-goal-scorer">' + escapeHtml(g.scorerName) + '</span>' +
        '</div>';
      }).join('');
      var goalsBlock = goalRows
        ? '<div class="history-row-goals-title">Mål</div><div class="history-row-goals">' + goalRows + '</div>'
        : '';
      // `|| 0` is unreachable in practice (visible already means visibleUntil
      // is truthy) - it's here only so the type checker can see visibleUntil
      // is used as a number, since it can't narrow that from the separate
      // `visible` boolean above.
      var daysLeft = visible ? Math.max(1, Math.ceil(((m.visibleUntil || 0) - Date.now()) / 86400000)) : 0;
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
      return '<div class="history-row' + (expanded ? ' expanded' : '') + '" data-id="' + escapeHtml(m.id) + '">' +
        '<div class="history-row-main">' +
          (historySelectMode ? '<input type="checkbox" class="history-row-check"' + (selected ? ' checked' : '') + '>' : '') +
          '<div class="history-row-text">' +
            '<div class="history-row-top">' +
              '<span class="history-row-opponent">vs ' + escapeHtml(opponent) + '</span>' +
              '<span class="history-row-score">' + (Number(m.homeScore) || 0) + ' - ' + (Number(m.awayScore) || 0) + '</span>' +
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

  // Only ever reached signed in (the tile is hidden otherwise) - see the
  // onAuthStateChange listener above, which closes it again on logout.
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
    return state.globalRunning ? t.baseElapsedMs + sinceMs(now, t.sinceTs) : t.baseElapsedMs;
  }

  /** @param {string} id @param {number} now @returns {number} */
  function benchElapsed(id, now){
    var t = state.benchTimers[id];
    if (!t) return 0;
    if (state.globalRunning) return t.baseElapsedMs + sinceMs(now, t.sinceTs);
    return t.baseElapsedMs;
  }

  /** @param {number} now @returns {number} */
  function matchClockElapsed(now){
    var t = state.matchClock;
    if (!t) return 0;
    return state.globalRunning ? t.baseElapsedMs + sinceMs(now, t.sinceTs) : t.baseElapsedMs;
  }

  // sinceTs can come from another phone whose clock runs a few seconds ahead of
  // this one. Time never runs backwards (formatMs would show it as "+0:05").
  /** @param {number} now @param {number} sinceTs @returns {number} */
  function sinceMs(now, sinceTs){
    return Math.max(0, now - sinceTs);
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
    var end = state.halves === 2 && state.halfStage !== 2 ? state.matchDurationMs / 2 : state.matchDurationMs;
    return end - matchClockElapsed(now);
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

  // Suppresses a rank triangle for anyone whose playtime sits within this
  // fraction of the squad's average - purely a GUI decluttering choice
  // (see computeRankBadges() below), never touches the actual numbers
  // anything else reads. Without it, a badge was assigned by raw rank
  // alone, so two players hovering right at a rank boundary (classically
  // "2nd-least" vs "2nd-most") could flip their triangle from a
  // practically meaningless few-second difference the instant the clock
  // ticked past the other - comparing against the average instead of the
  // immediate neighbor means a cluster of similar times near the middle
  // just shows no badge at all rather than visibly flickering between two
  // different ones.
  //
  // The buffer itself shrinks as the match clock (not any player's own
  // playtime - the shared match clock, so it advances the same way
  // regardless of who's on the field when) advances: a few seconds'
  // difference is a huge relative swing in the first minutes (everyone's
  // numbers are still tiny), so a wide 10% window keeps that from
  // flickering, but the same 10% would hide genuinely meaningful gaps once
  // real minutes have piled up later on - tightening it over the course of
  // the match keeps the triangles just as decluttered early and just as
  // informative late. Ramps linearly (0.5 percentage points/min for the
  // first 10 minutes, then 0.25pp/min to minute 20, flat after that) -
  // deliberately not three flat steps with hard jumps at 10/20 min, which
  // would just relocate the original flicker problem to those two exact
  // instants instead of actually fixing it.
  /** @param {number} elapsedMin @param {number} fromMin @param {number} fromVal @param {number} toMin @param {number} toVal @returns {number} */
  function lerp(elapsedMin, fromMin, fromVal, toMin, toVal){
    var t = (elapsedMin - fromMin) / (toMin - fromMin);
    return fromVal + t * (toVal - fromVal);
  }
  /** @param {number} now @returns {number} */
  function rankBadgeBuffer(now){
    var elapsedMin = matchClockElapsed(now) / 60000;
    if (elapsedMin <= 0) return 0.10;
    if (elapsedMin < 10) return lerp(elapsedMin, 0, 0.10, 10, 0.05);
    if (elapsedMin < 20) return lerp(elapsedMin, 10, 0.05, 20, 0.025);
    return 0.025;
  }

  // Returns {playerId: 'most'|'most2'|'least2'|'least'} across the whole squad
  // (both zones), so it's easy to see who to start next match with. Basis is
  // either the current period only (default) or the full cross-match
  // cumulative total, per the "Kumulert rangering" setting. Swap
  // suggestions (computeSwapSuggestion) are entirely separate and keep
  // acting on real ms values regardless of what's badged here.
  // The triangles are drawn into each token by renderField()/renderBench(), but
  // those only run when something is re-rendered (a swap, a goal ...) - not
  // on the 250ms clock tick - so with a running clock and no other action the
  // triangles stayed stale until the next re-render. updateRankBadgesOnly()
  // (called from updateTimersOnly) refreshes just the triangle elements in
  // place when the ranking actually changed, never rebuilding the tokens (that
  // would cancel a drag in progress). To keep the first seconds calm - everyone's
  // times are tiny and differ by almost nothing - the clock-driven refresh waits
  // until RANK_LIVE_AFTER_MS of match time; a re-render caused by an action
  // still shows them straight away.
  var RANK_LIVE_AFTER_MS = 30 * 1000;
  var lastRankSig = '';
  /** @param {number} now */
  function updateRankBadgesOnly(now){
    if (matchClockElapsed(now) < RANK_LIVE_AFTER_MS) return;
    var badges = computeRankBadges(now);
    var sig = JSON.stringify(badges);
    if (sig === lastRankSig) return;
    lastRankSig = sig;
    Array.prototype.forEach.call(document.querySelectorAll('#field .token, #bench .token'), function(/** @type {HTMLElement} */ el){
      var avatar = el.querySelector('.avatar');
      if (!avatar) return;
      var rank = badges[el.dataset.id || ''];
      var cur = avatar.querySelector('.badge-rank');
      if (cur && rank && cur.classList.contains('rank-' + rank)) return;
      if (cur) cur.remove();
      if (rank) avatar.insertAdjacentHTML('beforeend', rankBadgeHtml(rank).replace('class="badge-rank', 'class="badge-rank rank-live'));
    });
  }

  function computeRankBadges(now){
    var badges = {};
    var msFor = state.rankByCumulative ? cumulativeFieldMs : currentPeriodFieldMs;
    var all = state.players.map(function(p){ return { id: p.id, ms: msFor(p.id, now) }; });
    var n = all.length;
    if (n < 2) return badges;
    all.sort(function(a,b){ return b.ms - a.ms; });
    if (all[0].ms === all[n-1].ms) return badges;
    var mean = all.reduce(function(sum, x){ return sum + x.ms; }, 0) / n;
    var buffer = rankBadgeBuffer(now);
    var highCutoff = mean * (1 + buffer);
    var lowCutoff = mean * (1 - buffer);
    if (all[0].ms > highCutoff) badges[all[0].id] = 'most';
    if (all[n-1].ms < lowCutoff) badges[all[n-1].id] = 'least';
    if (n >= 4){
      if (all[1].ms > highCutoff) badges[all[1].id] = 'most2';
      if (all[n-2].ms < lowCutoff) badges[all[n-2].id] = 'least2';
    }
    return badges;
  }

  // Picks whichever id in `ids` has the highest metricFor() value (lowest,
  // if `lowest` is true) - an exact tie (common here: a batch swap/reorg
  // gives several players the same sinceTs, so their elapsed times stay
  // identical until something changes one of them) is broken by a genuine
  // random pick among the tied ids, rather than always favoring whichever
  // one happened to sort first.
  /** @param {string[]} ids @param {(id: string) => number} metricFor @param {boolean} [lowest] @returns {string|null} */
  function pickByMetric(ids, metricFor, lowest){
    /** @type {string|null} */
    var best = null;
    /** @type {number|null} */
    var bestVal = null;
    /** @type {string[]} */
    var tied = [];
    ids.forEach(function(id){
      var val = metricFor(id);
      // Checked on bestVal (not best) so the type checker can narrow it to
      // non-null on the ternary just after - the two are always set
      // together below, so this is the same condition either way.
      if (bestVal === null || (lowest ? val < bestVal : val > bestVal)){
        best = id; bestVal = val; tied = [id];
      } else if (val === bestVal){
        tied.push(id);
      }
    });
    if (tied.length <= 1) return best;
    return tied[Math.floor(Math.random() * tied.length)];
  }

  // Picks the swap the "Forslag" button recommends.
  //
  // Field player (who to sub OUT): among those who have actually exceeded
  // the defined swap time (byttetid) in their current stint - not just
  // whoever has the most playtime overall, since that player might have
  // only just come on - whoever has the most spilletid, per
  // state.swapSuggestionBasis ('match': this match/period only, same as
  // the K figure in the spillerboble; 'cumulative': lifetime across
  // matches, same as the T figure).
  //
  // Bench player (who to sub IN): per state.swapSuggestionBenchMode -
  // 'waited' (default) always picks whoever's current bench stint has run
  // longest, i.e. whoever has been waiting longest since their own last
  // swap - so nobody subbed off after you comes in before you. 'cumulative'
  // (stored name kept for saved settings/Supabase rows) instead picks
  // whoever has the LEAST spilletid in THIS match/period only - never the
  // lifetime total, and independent of swapSuggestionBasis (which only
  // governs who goes OUT). The coach opts into it knowingly, since it can
  // put the player who was just subbed off straight back on ahead of
  // someone who has waited longer, if they happen to have played least.
  //
  // Returns null when nobody on the field is actually due yet, or the
  // bench is empty.
  /** @param {number} now @returns {{fieldId:string, benchId:string}|null} */
  function computeSwapSuggestion(now){
    if (state.onBench.length === 0) return null;
    var msFor = state.swapSuggestionBasis === 'cumulative' ? cumulativeFieldMs : currentPeriodFieldMs;
    var keeper = keeperIdNow();
    var due = state.onField.filter(function(id){ return id !== keeper && fieldElapsed(id, now) >= state.defaultDurationMs; });
    if (due.length === 0) return null;
    var fieldId = pickByMetric(due, function(id){ return msFor(id, now); });
    var benchId = state.swapSuggestionBenchMode === 'cumulative'
      ? pickByMetric(state.onBench, function(id){ return currentPeriodFieldMs(id, now); }, true)
      : pickByMetric(state.onBench, function(id){ return benchElapsed(id, now); });
    if (!fieldId || !benchId) return null;
    return { fieldId: fieldId, benchId: benchId };
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
      matchClock: cloneStateValue(state.matchClock || { baseElapsedMs: 0, sinceTs: nowTs() }),
      globalRunning: !!state.globalRunning,
      defaultDurationMs: state.defaultDurationMs,
      matchDurationMs: state.matchDurationMs,
      fieldSize: state.fieldSize,
      fieldSlotAssignment: cloneStateValue(state.fieldSlotAssignment || null),
      rankByCumulative: !!state.rankByCumulative,
      reorgUsesLastMatch: !!state.reorgUsesLastMatch,
      swapSuggestionBasis: state.swapSuggestionBasis === 'cumulative' ? 'cumulative' : 'match',
      swapSuggestionBenchMode: state.swapSuggestionBenchMode === 'cumulative' ? 'cumulative' : 'waited',
      shareEditable: !!state.shareEditable,
      sessionOwnerDeviceId: state.sessionOwnerDeviceId,
      participants: cloneStateValue(state.participants || []),
      goalLog: cloneStateValue(state.goalLog || []),
      swapCount: typeof state.swapCount === 'number' ? state.swapCount : 0,
      lastActivityAt: state.lastActivityAt,
      lastPlayAt: state.lastPlayAt,   // not restored by restoreState() - an undo is itself a play action
      continueCount: state.continueCount || 0,
      opponentName: state.opponentName || '',
      opponentAbbr: state.opponentAbbr || '',
      matchHistory: cloneStateValue(state.matchHistory || []),
      eventLog: cloneStateValue(state.eventLog || []),
      halfStage: state.halfStage,
      keeperMs: cloneStateValue(state.keeperMs || {}),
      keeperNow: cloneStateValue(state.keeperNow || null),
      opIds: [],
      rev: typeof state.rev === 'number' ? state.rev : 0
    };
  }

  // Only what the undoable actions (swap, goal, move, time correction) actually
  // change. Settings aren't undoable and have no snapshot of their own, so an
  // older snapshot would silently carry their OLD values along: undoing a swap
  // must not also revert the match length, the opponent, a player's new name or
  // an ownership hand-off made since. (A changed roster clears the undo history
  // instead - see saveSettings().)
  /** @param {AppState} snap */
  function restoreState(snap){
    if (!snap) return;
    state.onField = (snap.onField || []).slice();
    state.onBench = (snap.onBench || []).slice();
    state.fieldTimers = cloneStateValue(snap.fieldTimers || {});
    state.benchTimers = cloneStateValue(snap.benchTimers || {});
    state.cumulative = cloneStateValue(snap.cumulative || {});
    state.periodStartCumulative = cloneStateValue(snap.periodStartCumulative || {});
    state.matchClock = cloneStateValue(snap.matchClock || { baseElapsedMs: 0, sinceTs: nowTs() });
    state.globalRunning = !!snap.globalRunning;
    state.fieldSlotAssignment = Array.isArray(snap.fieldSlotAssignment) ? cloneStateValue(snap.fieldSlotAssignment) : null;
    state.goalLog = cloneStateValue(snap.goalLog || []);
    state.swapCount = typeof snap.swapCount === 'number' ? snap.swapCount : state.swapCount;
    state.continueCount = typeof snap.continueCount === 'number' ? snap.continueCount : state.continueCount;
    state.eventLog = cloneStateValue(snap.eventLog || []);
    state.halfStage = snap.halfStage === 2 ? 2 : 1;
    state.keeperMs = cloneStateValue(snap.keeperMs || {});
    state.keeperNow = cloneStateValue(snap.keeperNow || null);
  }

  // Call BEFORE mutating state for any undoable action - pushes the
  // pre-mutation snapshot onto the undo stack, capped at UNDO_MAX so
  // undoLastAction() can be pressed repeatedly to step back that many moves.
  // A genuine new action invalidates any pending redo (standard undo/redo
  // semantics), so this also clears redoStack.
  function pushUndoSnapshot(){
    state.lastPlayAt = nowTs(); // every undoable action is a real play action - see forgottenMatchInfo()
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
    state.lastPlayAt = nowTs();
    pendingOps = []; // the restored state replaces them; see plainEditPending
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
    state.lastPlayAt = nowTs();
    pendingOps = [];
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
    updateLauncherResume();
    els.launcherTile.classList.remove('lifted');
    els.launcherScreen.classList.remove('hidden');
  }

  /** @param {string} id @returns {Player|null} */
  function playerById(id){
    for (var i=0;i<state.players.length;i++){ if (state.players[i].id === id) return state.players[i]; }
    return null;
  }

  function escapeHtml(str){
    return String(str === null || str === undefined ? '' : str).replace(/[&<>"']/g, function(c){
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
    // The designs place the clock differently, so #field's padding is read rather than assumed.
    var fieldStyle = els.field ? getComputedStyle(els.field) : null;
    var padTop = (fieldStyle && parseFloat(fieldStyle.paddingTop)) || 98;
    var padBottom = (fieldStyle && parseFloat(fieldStyle.paddingBottom)) || 16;

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
    var availH = Math.max(140, wrapH - (padTop + padBottom) - 12 - rowGap * (rowCount - 1) - (formation.hasKeeper ? 6 : 0));
    var perRowH = availH / rowCount;
    // avatar + label (margin-top 8 + ~1.2 line-height) + timer (margin-top
    // 3 + ~1.2 line-height), with label/timer font sizes both ~0.23x the
    // avatar (matches the old tiers' own ratios) - solves perRowH for the
    // avatar size that makes the whole stack fit exactly. (Used to also
    // budget room for a .field-pos-tag pill above the avatar - that moved
    // into #selectionInfo's popup instead, see updateSelectionInfo(), so
    // tokens on the pitch itself are back to just avatar+label+timer.)
    // Designene kan legge ring og BYTT-merke rundt spilleren, og sier fra om plassen det tar.
    var tokenExtra = (fieldStyle && parseFloat(fieldStyle.getPropertyValue('--token-extra'))) || 0;
    var avatarFromHeight = (perRowH - 11 - tokenExtra) / 1.546;

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
    var design = document.documentElement.getAttribute('data-design') || 'a';
    return lastFieldAvatarSize <= (design !== 'a' ? 38 : 50);
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
  // NFF: 3v3 spilles uten keeper, 5v5 og 7v7 med (4+1 og 6+1). Økter fra før 2.4.0 har ikke feltet
  // hasKeeper og beholder tabellen over, ellers ville spillere byttet plass midt i en kamp.
  var FORMATIONS_WITH_KEEPER = {
    1: { rows:[1],     roles:['K'],         hasKeeper:true },
    2: { rows:[1,1],   roles:['K','S'],     hasKeeper:true },
    3: { rows:[1,2],   roles:['K','S'],     hasKeeper:true },
    4: { rows:[1,2,1], roles:['K','B','S'], hasKeeper:true },
    5: { rows:[1,2,2], roles:['K','B','S'], hasKeeper:true }
  };
  var FORMATIONS_WITHOUT_KEEPER = {
    6:  { rows:[2,2,2], roles:['B','M','S'], hasKeeper:false },
    7:  { rows:[3,3,1], roles:['B','M','S'], hasKeeper:false },
    8:  { rows:[3,3,2], roles:['B','M','S'], hasKeeper:false },
    9:  { rows:[3,3,3], roles:['B','M','S'], hasKeeper:false },
    10: { rows:[4,3,3], roles:['B','M','S'], hasKeeper:false },
    11: { rows:[4,4,3], roles:['B','M','S'], hasKeeper:false }
  };
  /** @param {number} fieldSize @param {string} [pref] @returns {boolean} */
  function keeperDefaultFor(fieldSize, pref){
    if (pref === 'on') return true;
    if (pref === 'off') return false;
    return fieldSize >= 5;
  }
  /** @returns {{rows:number[], roles:string[], hasKeeper:boolean}} */
  function fieldFormationRows(fieldSize){
    var n = Math.max(1, Math.min(11, fieldSize || 3));
    if (state && state.hasKeeper === true && FORMATIONS_WITH_KEEPER[n]) return FORMATIONS_WITH_KEEPER[n];
    if (state && state.hasKeeper === false && FORMATIONS_WITHOUT_KEEPER[n]) return FORMATIONS_WITHOUT_KEEPER[n];
    return FIELD_FORMATIONS[n] || FIELD_FORMATIONS[3];
  }

  // Positions only mean anything from 5v5 up - at 3v3 (and the in-between
  // 4v4) the kids are too young for fixed spots and just chase the ball
  // everywhere, so the field stays the old free-for-all (see renderField()'s
  // branch on this). From 5v5 up, every field slot has a genuine identity
  // (see fieldSlotTags below) that a sub inherits when swapped on, and that
  // two on-field players can trade directly by dragging one onto the other.
  function fieldHasPositions(){
    return (state.fieldSize || 3) >= 5 || state.hasKeeper === true;
  }

  /* ---------------- Keeper-rotasjon ---------------- */
  var KEEPER_HISTORY_KEY = 'spillerbytte_keeper_history_v1';
  /** @returns {string|null} */
  function keeperIdNow(){
    if (!fieldHasPositions() || !fieldFormationRows(state.fieldSize).hasKeeper) return null;
    syncFieldSlots();
    var arr = state.fieldSlotAssignment;
    return (arr && arr[0]) || null;
  }
  // Klokketid i mål, ført på den som står der. Kalles ved tegning og ved kampslutt.
  /** @param {number} now */
  function syncKeeperTime(now){
    if (!state.keeperMs) state.keeperMs = {};
    var id = keeperIdNow(), clock = matchClockElapsed(now), cur = state.keeperNow;
    if (cur && cur.id !== id){
      state.keeperMs[cur.id] = (state.keeperMs[cur.id] || 0) + Math.max(0, clock - cur.sinceMs);
      cur = null;
      state.keeperNow = null;
    }
    if (!cur && id) state.keeperNow = { id: id, sinceMs: clock };
  }
  /** @param {string} id @param {number} now @returns {number} */
  function keeperMsThisMatch(id, now){
    var ms = (state.keeperMs && state.keeperMs[id]) || 0;
    if (state.keeperNow && state.keeperNow.id === id) ms += Math.max(0, matchClockElapsed(now) - state.keeperNow.sinceMs);
    return ms;
  }
  /** @returns {Object<string, number>} */
  function loadKeeperHistory(){
    try { var h = JSON.parse(localStorage.getItem(KEEPER_HISTORY_KEY) || '{}'); return h && typeof h === 'object' ? h : {}; }
    catch(e){ return {}; }
  }
  /** @param {number} now */
  function bankKeeperHistory(now){
    if (spectatorCode) return;
    var h = loadKeeperHistory();
    state.players.forEach(function(p){
      var ms = keeperMsThisMatch(p.id, now);
      if (ms > 0) h[p.name] = (Number(h[p.name]) || 0) + ms;
    });
    try { localStorage.setItem(KEEPER_HISTORY_KEY, JSON.stringify(h)); } catch(e){}
  }
  // Den som har stått minst i mål, over alle kamper på denne enheten.
  /** @param {number} now @returns {{id:string, name:string, ms:number}|null} */
  function suggestNextKeeper(now){
    if (!fieldFormationRows(state.fieldSize).hasKeeper || state.players.length < 2) return null;
    var h = loadKeeperHistory(), current = keeperIdNow();
    /** @type {any} */
    var best = null;
    state.players.forEach(function(p){
      if (p.id === current) return;
      var ms = (Number(h[p.name]) || 0) + keeperMsThisMatch(p.id, now);
      if (!best || ms < best.ms || (ms === best.ms && p.name.localeCompare(best.name, 'nb') < 0)) best = { id: p.id, name: p.name, ms: ms };
    });
    return best;
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
    // (string|null)[], not string[] - an empty slot is a real, meaningful
    // value here (see the null-filling/mapping right below), not an absence.
    /** @type {(string|null)[]} */
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
    recordOp({ t: 'pos', a: idA, b: idB });
    saveState();
    renderAll();
    var pa = playerById(idA), pb = playerById(idB);
    if (pa && pb) showUndoToast(firstName(pa.name) + ' og ' + firstName(pb.name) + ' byttet plass');
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
    renderScore();
  }

  function renderScore(){
    els.homeTeamLabel.textContent = homeAbbr();
    els.homeScoreBtn.setAttribute('aria-label', 'Registrer mål for ' + homeName());
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
    setShared({ opponentName: name, opponentAbbr: abbr });
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
  var GOAL_CONFIRM_WINDOW_MS = 8000; // bare en dobbeltregistrering: ellers fanger Angre-stripen feil
  /** @type {'home'|'away'|null} */
  var pendingGoalTeam = null;
  /** @type {string|null} */
  var pendingGoalPlayerId = null;

  /** @param {'home'|'away'} team @param {string|null} playerId */
  function registerGoal(team, playerId){
    pushUndoSnapshot();
    var now = nowTs();
    recordOp({ t: 'goal', at: now, goal: { id: uid(), team: team, playerId: playerId || null, at: now, matchMs: matchClockElapsed(now) } });
    saveState();
    renderAll();
    var scorer = playerId ? playerById(playerId) : null;
    showUndoToast(team === 'home' ? 'Mål: ' + (scorer ? firstName(scorer.name) : homeName()) : 'Mål til ' + (state.opponentName || 'motstanderen'));
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
    if (last && (now - last.at) < GOAL_CONFIRM_WINDOW_MS) return 'Et mål ble nettopp registrert. Er du sikker?';
    return null;
  }

  // Away goals stay anonymous (see onHomePlayerPicked for the home flow),
  // so only the duplicate-goal check applies here - gated by the same
  // shared-state 30s window, keyed on the synced goalLog rather than a
  // local timer, so it also catches a second device registering the same
  // goal.
  function onAwayScoreTap(){
    if (!canEdit()) return;
    var msg = goalConfirmMessage('away', null, nowTs());
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
    var msg = goalConfirmMessage('home', playerId, nowTs());
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
    recordOp({ t: 'ungoal', goalId: state.goalLog[idx].id });
    saveState();
    renderAll();
    showUndoToast('Målet er fjernet');
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
    recordOp({ t: 'ungoal', goalId: last.id });
    saveState();
    renderAll();
    showUndoToast('Målet er fjernet');
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
    /** @type {number|null} */
    var dividerBeforeIndex = null;
    if (goalPlayerMode === 'view'){
      rows = rows.filter(function(p){ return (goalBadges.counts[p.id] || 0) > 0; });
      rows.sort(function(a,b){ return (goalBadges.counts[b.id] || 0) - (goalBadges.counts[a.id] || 0); });
    } else {
      var onFieldSet = {};
      state.onField.forEach(function(id){ onFieldSet[id] = true; });
      var onFieldPlayers = rows.filter(function(p){ return onFieldSet[p.id]; });
      var benchPlayers = rows.filter(function(p){ return !onFieldSet[p.id]; });
      var groupByRole = fieldHasPositions() && fieldFormationRows(state.fieldSize).rows.length >= 3;
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
        (interactive ? ' type="button" data-id="' + escapeHtml(p.id) + '"' + (disabled ? ' disabled' : '') : '') + '>';
      return (i === dividerBeforeIndex ? '<div class="goal-player-divider"></div>' : '') +
        openTag +
        '<span class="goal-player-row-avatar">' + escapeHtml(initials(p.name, singleLetter)) + '</span>' +
        '<span class="goal-player-row-name">' + escapeHtml(p.name) + '</span>' +
        (n > 0 ? '<span class="goal-player-row-count">' + n + '</span>' : '') +
        (goalPlayerMode === 'view' && n > 0
          ? '<button type="button" class="goal-time-btn" data-id="' + escapeHtml(p.id) + '" aria-label="Vis måltidspunkt for ' + escapeHtml(p.name) + '">🕐</button>'
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
    // Always the upright phone ratio now, never vw>vh's own landscape
    // variant - matches #viewport-frame.desktop-preview #app's own CSS
    // sizing (style.css), which already only ever computes the upright
    // 440:956 box regardless of window shape. A desktop window that
    // happened to be exactly phone-landscape-shaped used to skip
    // .desktop-preview entirely here (this diff read as ~0) and fall
    // through to the real full-bleed layout, which is where the actual
    // landscape (row) CSS lives - fine for a genuinely rotated phone, but
    // on a real desktop window there's no phone to rotate, so it just
    // rendered the mobile "rotated" layout at full browser width instead
    // of the upright mockup. Comparing against upright every time means
    // any wide desktop window gets the same consistent letterboxed
    // upright preview, no exceptions.
    var targetRatio = 440/956;
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
  // The settle animation is for tokens that actually moved. Every token is rebuilt
  // on every render, and with a shared session that happens on each remote update,
  // so replaying it for everyone made the whole team blink each time.
  /** @type {Object<string, string>} */
  var lastZoneById = {};
  /** @param {string} id @param {'field'|'bench'} zone @returns {string} */
  function enterClassFor(id, zone){
    var moved = lastZoneById[id] !== zone;
    lastZoneById[id] = zone;
    return moved ? ' token-enter' : '';
  }

  /** @param {string} id @param {number} now @param {Object} rankBadges @param {Object} goalBadges @param {boolean} singleLetter */
  function buildFieldTokenEl(id, now, rankBadges, goalBadges, singleLetter){
    var p = playerById(id);
    if (!p) return null;
    var elapsed = fieldElapsed(id, now);
    var timeUp = elapsed >= state.defaultDurationMs;
    var farOver = timeUp && elapsed >= state.defaultDurationMs * OVERTIME_FACTOR;
    var isChecked = multiMode && multiSelected.indexOf(id) !== -1;
    var el = document.createElement('div');
    el.className = 'token field-token' + enterClassFor(id, 'field') + (isChecked ? ' multi-checked' : '');
    el.dataset.id = id;
    el.innerHTML =
      '<div class="avatar' + (timeUp ? ' time-up' : '') + '">' + escapeHtml(initials(p.name, singleLetter)) +
        rankBadgeHtml(rankBadges[id]) +
        goalBadgeHtml(id, goalBadges) +
        (farOver ? '<div class="badge-warning overtime">⇅</div>' : timeUp ? '<div class="badge-warning due">⇅</div>' : '') +
        (isChecked ? '<div class="badge-check">✓</div>' : '') +
      '</div>' +
      '<div class="label">' + escapeHtml(p.name) + '</div>' +
      '<div class="timer' + (farOver ? ' overtime' : timeUp ? ' due' : '') + '">' + formatMs(elapsed) + '</div>' +
      // Vises bare i designene som bruker dem (designs.css).
      '<div class="level-tag"></div><div class="stint-bar"><i></i></div>';
    paintStint(el, elapsed);
    attachTokenEvents(el, id, 'field');
    return el;
  }

  // Hvor langt spilleren er kommet mot byttetiden, for ring og stolpe i designene. Nivået står også
  // som tekst, så tilstanden aldri bare ligger i en farge.
  /** @param {HTMLElement} el @param {number} elapsed */
  function paintStint(el, elapsed){
    var d = state.defaultDurationMs;
    var level = elapsed >= d * OVERTIME_FACTOR ? 'over' : elapsed >= d ? 'due' : elapsed >= d - PREWARN_MS ? 'soon' : '';
    el.style.setProperty('--stint', String(Math.min(1, elapsed / d)));
    el.style.setProperty('--list-order', String(-Math.floor(elapsed / 1000)));
    if (el.dataset.level !== level){
      el.dataset.level = level;
      var tag = el.querySelector('.level-tag');
      if (tag) tag.textContent = level === 'over' ? 'BYTT NÅ' : level === 'due' ? 'BYTT' : '';
    }
  }

  function renderField(){
    els.field.innerHTML = '';
    var now = nowTs();
    syncKeeperTime(now);
    var rankBadges = computeRankBadges(now);
    lastRankSig = JSON.stringify(rankBadges);
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
      // syncFieldSlots() always leaves this as a real array once
      // fieldHasPositions() is true (only the !fieldHasPositions() branch
      // sets it to null) - re-read into a local so the type checker can see
      // that too, same pattern as fieldPositionTagFor()/performPositionSwap().
      var slots = state.fieldSlotAssignment;
      if (!slots) return;
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
          // `slots ? ... : null` (not a bare slots[slotIdx]) only because the
          // type checker won't carry the `if (!slots) return;` narrowing
          // above into this forEach callback's closure - slots can't
          // actually be null here.
          var id = slots ? slots[slotIdx] : null;
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
    var now = nowTs();
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
      el.className = 'token bench-token' + enterClassFor(id, 'bench') + (isChecked ? ' multi-checked' : '');
      el.dataset.id = id;
      el.innerHTML =
        '<div class="avatar bench-avatar">' + escapeHtml(initials(p.name)) +
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

  // Full refresh of every time-dependent display (tokens, bench, match clock,
  // countdown). Called on every render AND by the 250ms tick below while
  // running - it must NOT early-return when paused: renderAll()/settings/
  // picker changes while paused still need the clock + countdown redrawn.
  function updateTimersOnly(){
    var now = nowTs();
    Array.prototype.forEach.call(els.field.querySelectorAll('.field-token'), function(el){
      var id = el.dataset.id;
      var elapsed = fieldElapsed(id, now);
      var timerEl = el.querySelector('.timer');
      var avatarEl = el.querySelector('.avatar');
      timerEl.textContent = formatMs(elapsed);
      var timeUp = elapsed >= state.defaultDurationMs;
      var farOver = timeUp && elapsed >= state.defaultDurationMs * OVERTIME_FACTOR;
      paintStint(el, elapsed);
      notePrewarn(id, elapsed);
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
        if (!spectatorCode) playTimeUpBeep();
        maybeTip('due');
      }
    });
    Array.prototype.forEach.call(els.bench.querySelectorAll('.bench-token'), function(el){
      var id = el.dataset.id;
      el.querySelector('.stopwatch').textContent = formatMs(benchElapsed(id, now));
    });
    els.matchClock.textContent = formatMs(matchClockDisplayMs(now));
    var countdown = matchCountdownMs(now);
    els.matchCountdown.textContent = (state.halves === 2 ? (state.halfStage === 2 ? '2. ' : '1. ') : '') + formatMs(countdown);
    els.matchCountdown.classList.toggle('overtime', countdown < 0);
    updateRankBadgesOnly(now);
    updateSelectionInfo();
    if (state.globalRunning) checkMatchAlarms(now);
    var second = Math.floor(now / 1000);
    if (second !== lastPanelsSecond){
      lastPanelsSecond = second;
      renderMatchPanels(now);
    }
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
            '<span class="si-swap-label">Bytte?</span>' +
          '</button>' +
        '</div>';
      selectionInfoRenderedId = selected.id;
    }
    var now = nowTs();
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

  // "Slipp for å bytte" card shown while a dragged player hovers over someone
  // they can swap with - same glass card as the player info popup
  // (#selectionInfo) and docked in the same spot, so it reads as the same
  // family. pointer-events:none always (it must never intercept the drop).
  /** @param {string} fromId @param {string} toId @param {boolean} positionOnly */
  function showDropHint(fromId, toId, positionOnly){
    var a = playerById(fromId), b = playerById(toId);
    if (!a || !b) return;
    els.dropHint.innerHTML =
      '<div class="dh-names"><span class="dh-name">' + escapeHtml(a.name) + '</span><span class="dh-arrows" aria-hidden="true">⇄</span><span class="dh-name">' + escapeHtml(b.name) + '</span></div>' +
      '<div class="dh-action">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
          '<path d="M8 17V5M8 5L4.7 8.3M8 5L11.3 8.3" stroke="#32b45a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<path d="M16 7v12M16 19l-3.3-3.3M16 19l3.3-3.3" stroke="#32b45a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>' +
        '<span class="dh-label">' + (positionOnly ? 'Slipp for å bytte plass' : 'Slipp for å bytte') + '</span>' +
      '</div>';
    els.dropHint.classList.add('visible');
  }
  function hideDropHint(){ els.dropHint.classList.remove('visible'); }

  /** @type {WakeLockSentinel|null} */
  var wakeLock = null;
  // "Hold skjermen våken" is a preference of THIS device (set under
  // Innstillinger on the home screen), not match state: it used to live in
  // the synced session state, which meant one device's toggle changed
  // everyone's and a read-only viewer couldn't change their own. A device
  // that has never saved the preference falls back to what its old session
  // state said (older builds stored it there), otherwise on.
  var WAKELOCK_KEY = 'spillerbytte_wakelock_v1';
  /** @returns {boolean} */
  function wakeLockWanted(){
    try {
      var v = localStorage.getItem(WAKELOCK_KEY);
      if (v !== null) return v === '1';
    } catch(e){}
    return (/** @type {any} */ (state)).wakeLockEnabled !== false;
  }
  /** @param {boolean} on */
  function setWakeLockWanted(on){
    try { localStorage.setItem(WAKELOCK_KEY, on ? '1' : '0'); } catch(e){}
    if (on){
      requestWakeLock();
    } else if (wakeLock){
      wakeLock.release().catch(function(){});
      wakeLock = null;
    }
  }
  function requestWakeLock(){
    if (!('wakeLock' in navigator)) return;
    if (!wakeLockWanted()) return;
    navigator.wakeLock.request('screen').then(function(lock){
      wakeLock = lock;
    }).catch(function(){ /* e.g. low-power mode - not critical, ignore */ });
  }

  // Not only 'suspended': iOS reports 'interrupted' after a screen lock or a phone
  // call, and the beep then stays silent until the next user gesture resumes it.
  function ensureAudioUnlocked(){
    // Uten dette demper iPhone lyden når stillebryteren står på, og det gjør den ofte på banen.
    try {
      var session = /** @type {any} */ (navigator).audioSession;
      if (session && session.type !== 'playback') session.type = 'playback';
    } catch(e){}
    if (!audioCtx){
      try { audioCtx = new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)(); }
      catch(e){ audioCtx = null; }
    }
    if (audioCtx && audioCtx.state !== 'running'){
      audioCtx.resume().catch(function(){});
    }
  }

  /** @param {Array<[number, number, number]>} tones - [frekvens, start, lengde] */
  function playTones(tones){
    if (!audioCtx) return;
    var ctx = audioCtx;
    try {
      tones.forEach(function(tone){
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        var t0 = ctx.currentTime + tone[1];
        osc.type = 'triangle';
        osc.frequency.value = tone[0];
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tone[2]);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + tone[2] + 0.02);
      });
    } catch(e){ console.warn('Kunne ikke spille lyd', e); }
  }
  function playWhistle(){
    playTones([[2100, 0, 0.32], [2100, 0.42, 0.32], [2100, 0.84, 0.7]]);
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
  }
  /** @param {string} key @returns {boolean} */
  function soundPref(key){
    try { return localStorage.getItem('spillerbytte_sound_' + key + '_v1') !== '0'; } catch(e){ return true; }
  }
  /** @param {string} key @param {boolean} on */
  function setSoundPref(key, on){
    try { localStorage.setItem('spillerbytte_sound_' + key + '_v1', on ? '1' : '0'); } catch(e){}
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
      recordOp({ t: 'swap', out: fieldSelected[i], in: benchSelected[i] });
    }
    multiMode = false;
    multiSelected = [];
    saveState();
    updateMultiSelectUI();
    renderAll();
    showUndoToast(fieldSelected.length + ' bytter utført');
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
    selected = null;
    animateAndPerformSwap(fieldId, benchId);
  }

  // Core swap mutation, no undo snapshot of its own - callers decide the
  // undo granularity (performSwap snapshots once per swap; a multi-swap
  // batch snapshots once for the whole batch, see performMultiSwap).
  /** @param {string} fieldId @param {string} benchId @param {number} [at] */
  function swapFieldAndBench(fieldId, benchId, at){
    if (state.onField.indexOf(fieldId) === -1 || state.onBench.indexOf(benchId) === -1){
      return;
    }
    var now = typeof at === 'number' ? at : nowTs();
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
    recordOp({ t: 'swap', out: fieldId, in: benchId });
  }

  /* ---------------- Drag & drop ---------------- */

  function attachTokenEvents(el, id, zone){
    el.addEventListener('pointerdown', function(e){ onPointerDown(e, id, zone); });
  }

  /** @type {(() => void)|null} */
  var activeDragCancel = null; // set from pointerdown to pointerup on a token; a second finger is ignored meanwhile
  /** @type {{server:AppState, origin:any, hasRev:boolean}|null} */
  var pendingRemoteRow = null; // a remote update that arrived during a drag - see applyServerRow()
  var DRAG_WATCHDOG_MS = 15000;

  function onPointerDown(e, id, zone){
    if (e.isPrimary === false || activeDragCancel) return;
    if (!canEdit()){
      // Tilskuere og lesere kan se spillerinfo, men ikke flytte noen.
      e.preventDefault();
      selected = selected && selected.id === id ? null : { id: id, zone: zone };
      applySelectionStyles();
      return;
    }
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
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    var watchdog;

    try { sourceEl.setPointerCapture(pointerId); } catch(err){}

    function clearHoverTarget(){
      if (hoverTargetEl){ hoverTargetEl.classList.remove('drop-target'); hoverTargetEl = null; }
      hideDropHint();
    }

    // Remote updates wait while a finger is down (see adoptRemoteState), so a
    // pointerup that somehow never arrives must not be able to hold them up for good.
    function armWatchdog(){
      clearTimeout(watchdog);
      watchdog = setTimeout(cancelDrag, DRAG_WATCHDOG_MS);
    }

    function onMove(ev){
      if (ev.pointerId !== pointerId) return;
      armWatchdog();
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
        var overIsField = false;
        if (overToken && overId && overId !== id){
          overIsField = state.onField.indexOf(overId) !== -1;
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
          showDropHint(id, overId || '', zone === 'field' && overIsField);
        } else if (!isValidTarget){
          clearHoverTarget();
        }
      }
    }

    // Everything that ends a press, whatever the reason. A remote update that
    // waited is taken up here, BEFORE the drop is acted on, so the drop works on
    // the current team and not on the one the drag started from.
    function settle(){
      settled = true;
      clearTimeout(watchdog);
      try { sourceEl.releasePointerCapture(pointerId); } catch(err){}
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      sourceEl.classList.remove('drag-source-hidden');
      clearHoverTarget();
      if (ghost){ ghost.remove(); ghost = null; }
      activeDragCancel = null;
      if (pendingRemoteRow){
        var waiting = pendingRemoteRow;
        pendingRemoteRow = null;
        applyServerRow(waiting.server, waiting.origin, waiting.hasRev);
      }
    }

    function onUp(ev){
      if (settled || ev.pointerId !== pointerId) return;
      var wasDragging = dragging;
      settle();
      if (wasDragging) handleDrop(id, zone, ev.clientX, ev.clientY);
      else handleTap(id, zone);
    }

    // The system took the touch away (a notification swipe, the screen locking).
    // The coach never let go on purpose, so nothing may happen to the team.
    function onCancel(ev){
      if (settled || ev.pointerId !== pointerId) return;
      cancelDrag();
    }

    function cancelDrag(){
      if (settled) return;
      settle();
    }

    activeDragCancel = cancelDrag;
    armWatchdog();
    // On document, not the token: the events still reach it through the capture
    // above, and they keep working if the token is ever replaced during the press.
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
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
    var out = playerById(fieldId), inn = playerById(benchId);
    if (out && inn) showUndoToast(firstName(out.name) + ' ⇄ ' + firstName(inn.name));
    // The field player now lives in the bench list, and vice versa.
    flashSwapped(/** @type {HTMLElement|null} */ (els.bench.querySelector('[data-id="' + fieldId + '"]')));
    flashSwapped(/** @type {HTMLElement|null} */ (els.field.querySelector('[data-id="' + benchId + '"]')));
  }

  /** @param {string} id @param {'field'|'bench'} fromZone @param {number} clientX @param {number} clientY */
  function handleDrop(id, fromZone, clientX, clientY){
    selected = null;
    suggestedPartnerId = null;
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
    var now = nowTs();

    if (inField && fromZone === 'bench'){
      if (state.onBench.indexOf(id) === -1){ renderAll(); return; }
      if (state.onField.length >= (state.fieldSize || 3)){
        renderAll();
        flashDropRejected(id, fromZone);
        return;
      }
      pushUndoSnapshot();
      recordOp({ t: 'toField', p: id, at: now });
      saveState();
      renderAll();
      showUndoToast('Flyttet til banen');
    } else if (inBench && fromZone === 'field'){
      if (state.onField.indexOf(id) === -1){ renderAll(); return; }
      pushUndoSnapshot();
      recordOp({ t: 'toBench', p: id, at: now });
      saveState();
      renderAll();
      showUndoToast('Flyttet til benken');
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
    freezeClocksOf(state, ts);
  }

  /** @param {AppState} s @param {number} ts */
  function freezeClocksOf(s, ts){
    Object.keys(s.fieldTimers).forEach(function(id){
      var t = s.fieldTimers[id];
      t.baseElapsedMs = t.baseElapsedMs + sinceMs(ts, t.sinceTs);
      t.sinceTs = ts;
    });
    Object.keys(s.benchTimers).forEach(function(id){
      var t = s.benchTimers[id];
      t.baseElapsedMs = t.baseElapsedMs + sinceMs(ts, t.sinceTs);
      t.sinceTs = ts;
    });
    s.matchClock.baseElapsedMs += sinceMs(ts, s.matchClock.sinceTs);
    s.matchClock.sinceTs = ts;
  }

  /** @param {AppState} s @param {number} ts */
  function startClocksOf(s, ts){
    Object.keys(s.fieldTimers).forEach(function(id){ s.fieldTimers[id].sinceTs = ts; });
    Object.keys(s.benchTimers).forEach(function(id){ s.benchTimers[id].sinceTs = ts; });
    s.matchClock.sinceTs = ts;
  }

  // Start and stop are the only places the clocks change state, and they have to
  // be applied to the undo/redo snapshots as well. A snapshot is the match as it
  // would have been without one action, and that alternative match stopped and
  // started at the same moments as this one. Left alone, a snapshot from before a
  // pause comes back "running since before the pause": undoing a swap after a
  // 10-minute break started the clock and added the 10 minutes to every player.
  /** @param {number} ts */
  function stopClockAt(ts){
    freezeClocksOf(state, ts);
    state.globalRunning = false;
    undoStack.concat(redoStack).forEach(function(snap){
      if (!snap.globalRunning) return;
      freezeClocksOf(snap, ts);
      snap.globalRunning = false;
    });
  }
  /** @param {number} ts */
  function startClockAt(ts){
    startClocksOf(state, ts);
    state.globalRunning = true;
    undoStack.concat(redoStack).forEach(function(snap){
      if (snap.globalRunning) return;
      startClocksOf(snap, ts);
      snap.globalRunning = true;
    });
  }

  // Removes `ms` of elapsed time from the match clock and from every
  // currently-open fieldTimers/benchTimers entry (both on-field and bench,
  // whichever zone each player happens to be in right now) - the "someone
  // forgot to press Kampslutt and the clock kept running" correction tool
  // (see #correctTimeModal/#removeDeadTimeConfirmModal). Deliberately
  // leaves state.cumulative untouched: that only holds STINTS THAT ALREADY
  // COMMITTED (a real swap), which by definition can't be part of unwanted
  // trailing dead time - only the still-open tail (the live timers this
  // function touches) can be. freezeTimersAt(now) first normalizes
  // baseElapsedMs to a real "as of now" value while running (same guard
  // togglePlayPause uses - calling it while already paused would wrongly
  // add a stale sinceTs gap), then every base gets clamped at 0 so this
  // can never wrap negative; re-anchoring sinceTs to `now` afterward (only
  // if still running) is what stops the trimmed amount from silently
  // growing back the moment time keeps advancing.
  /** @param {number} ms @param {boolean} [continueReset] */
  function subtractDeadTime(ms, continueReset){
    if (!(ms > 0)) return;
    pushUndoSnapshot();
    recordOp({ t: 'trim', ms: ms, continueReset: !!continueReset });
    saveState();
    renderAll();
  }

  // The mutation half of subtractDeadTime() - no undo snapshot, save or
  // render of its own, so a caller that is about to do its own (e.g.
  // clampMatchToDuration() right before endMatchPeriod()) isn't pushing
  // redundant intermediate states.
  /** @param {number} ms */
  function trimElapsedTime(ms){
    var now = nowTs();
    if (state.globalRunning) freezeTimersAt(now);
    state.matchClock.baseElapsedMs = Math.max(0, state.matchClock.baseElapsedMs - ms);
    Object.keys(state.fieldTimers).forEach(function(id){
      var t = state.fieldTimers[id];
      t.baseElapsedMs = Math.max(0, t.baseElapsedMs - ms);
    });
    Object.keys(state.benchTimers).forEach(function(id){
      var t = state.benchTimers[id];
      t.baseElapsedMs = Math.max(0, t.baseElapsedMs - ms);
    });
    if (state.globalRunning){
      state.matchClock.sinceTs = now;
      Object.keys(state.fieldTimers).forEach(function(id){ state.fieldTimers[id].sinceTs = now; });
      Object.keys(state.benchTimers).forEach(function(id){ state.benchTimers[id].sinceTs = now; });
    }
  }

  /* ---------------- Glemt kampslutt ---------------- */

  // "Du glemte å avslutte kampen": regelen, uttrykt i klokketid (ikke
  // veggklokke, så den også stemmer for en pauset klokke):
  //   - Kamptiden er ute (klokka >= kamplengden).
  //   - Det har vært KONTINUERLIG stille (ingen spillhandling - bytte, mål,
  //     flytting, angre, start/pause, Fortsett) i minst
  //     (1 + continueCount) x 20 % av kamplengden, regnet fra det SENESTE av
  //     «kamptiden gikk ut» og «siste spillhandling». Hver handling starter
  //     altså tellingen på nytt, og hver «Fortsett» krever lenger stille
  //     neste gang (1x, 2x, 3x ...), slik at en kamp med feil innstilt
  //     kamptid ikke maser. Klokka over 120 % følger av dette av seg selv.
  //   - Målet er det SENESTE av kamplengden og siste spillhandling: et bytte
  //     etter full tid var ekte og blir stående.
  var FORGOTTEN_QUIET_FRACTION = 0.2;

  // Klokkeverdien (ms) da siste spillhandling skjedde. Går klokka, er det
  // nå minus tiden siden handlingen (start/pause er selv en handling, så
  // en pause kan ikke ligge «mellom»); står den, er det bare nå-verdien.
  /** @param {number} now @returns {number} */
  function clockAtLastPlay(now){
    var elapsed = matchClockElapsed(now);
    if (!state.globalRunning) return elapsed;
    var lp = typeof state.lastPlayAt === 'number' ? state.lastPlayAt : now;
    return Math.max(0, elapsed - Math.max(0, now - lp));
  }

  // Hvor klokka stilles tilbake til: det seneste av kamplengden og siste
  // spillhandling (aldri forbi nå-verdien).
  /** @param {number} now @returns {number} */
  function matchEndTargetMs(now){
    return Math.min(matchClockElapsed(now), Math.max(state.matchDurationMs, clockAtLastPlay(now)));
  }

  // Hvor mye som kan fjernes for å komme tilbake til kampslutt (0 om ingenting).
  /** @returns {number} */
  function matchOvertimeMs(){
    var now = nowTs();
    return Math.max(0, matchClockElapsed(now) - matchEndTargetMs(now));
  }

  // Null når regelen ikke er oppfylt; ellers hvor klokka stilles tilbake til og hvor lenge det har vært stille.
  /** @param {number} now @returns {{target:number, trim:number, quiet:number}|null} */
  function forgottenMatchInfo(now){
    var d = state.matchDurationMs, clock = matchClockElapsed(now);
    if (!(d > 0) || clock < d) return null;
    var quiet = clock - Math.max(d, clockAtLastPlay(now));
    var need = (1 + (state.continueCount || 0)) * FORGOTTEN_QUIET_FRACTION * d;
    if (quiet < need) return null;
    var target = matchEndTargetMs(now);
    return { target: target, trim: clock - target, quiet: quiet };
  }

  // Mutasjonen alene (ingen angre-snapshot, lagring eller tegning) - for
  // kallere som gjør sitt eget, f.eks. rett før endMatchPeriod().
  // `excess` kan regnes ut på forhånd: pushUndoSnapshot() stempler lastPlayAt, og da ville
  // «siste handling» plutselig være nå og ingenting bli trukket fra.
  /** @param {number} [excess] */
  function rollBackToMatchEnd(excess){
    if (excess === undefined){
      var now = nowTs();
      excess = matchClockElapsed(now) - matchEndTargetMs(now);
    }
    if (excess > 0) trimElapsedTime(excess);
  }

  function pauseClock(){
    if (!state.globalRunning) return;
    stopClockAt(nowTs());
  }

  // Klokketid siden siste spillhandling - det eneste «dødtid» kan være. Står
  // klokka, har ingenting gått siden den ble stoppet, uansett hvor lenge pausen varte.
  /** @param {number} now @returns {number} */
  function deadTimeSinceLastPlay(now){
    if (!state.globalRunning) return 0;
    return Math.max(0, matchClockElapsed(now) - clockAtLastPlay(now));
  }

  // Kort melding øverst (samme felt som auto-pause-varselet, bare med egen tekst).
  var autoPauseDefaultText = '';
  /** @param {string} text */
  function showNotice(text){
    if (!els.autoPauseNotice) return;
    if (!autoPauseDefaultText) autoPauseDefaultText = els.autoPauseNotice.textContent || '';
    els.autoPauseNotice.textContent = text;
    els.autoPauseNotice.classList.add('show');
    clearTimeout(autoPauseNoticeTimer);
    autoPauseNoticeTimer = setTimeout(function(){
      els.autoPauseNotice.classList.remove('show');
      els.autoPauseNotice.textContent = autoPauseDefaultText;
    }, 4500);
  }

  // Hintet etter «Fortsett»: klokka lyser og en boble peker på den i 10 s -
  // oftest er det kamptiden som er stilt for kort, og den endres ved å trykke på klokka.
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  var clockHintTimer;
  function showClockHint(){
    els.clockHint.classList.add('visible');
    els.matchClock.classList.add('clock-halo');
    clearTimeout(clockHintTimer);
    clockHintTimer = setTimeout(hideClockHint, 10000);
  }
  function hideClockHint(){
    clearTimeout(clockHintTimer);
    els.clockHint.classList.remove('visible');
    els.matchClock.classList.remove('clock-halo');
  }

  /** @type {{auto:boolean, thenEnd:boolean}} */
  var forgottenCtx = { auto: true, thenEnd: false };
  var forgottenOpen = false;

  /** @param {{auto:boolean, thenEnd:boolean}} ctx */
  function openForgottenSheet(ctx){
    forgottenCtx = ctx;
    forgottenOpen = true;
    fillForgottenSheet();
    els.forgottenModal.classList.add('open');
  }
  function closeForgottenSheet(){
    forgottenOpen = false;
    els.forgottenModal.classList.remove('open');
  }
  // Tegnes på nytt hvert sekund mens arket er åpent - klokka går videre i bakgrunnen.
  function fillForgottenSheet(){
    var now = nowTs(), clock = matchClockElapsed(now), target = matchEndTargetMs(now);
    var trim = Math.max(0, clock - target);
    els.forgottenTitle.textContent = forgottenCtx.auto ? '⏸ Kampen er satt på pause' : 'Still klokka tilbake til kampslutt';
    els.forgottenInfo.textContent = (forgottenCtx.auto
        ? 'Kamptiden gikk ut for ' + formatMs(Math.max(0, clock - state.matchDurationMs)) + ' siden, og det har ikke skjedd noe på en stund. '
        : 'Fjerner ' + formatMs(trim) + ' fra klokka og spillerne. ') +
      'Alle spillernes tider tilbakestilles til det de var ved kampslutt (' + formatMs(target) + ').';
    /** @type {Array<[string, number]>} */
    var rows = [['Klokka', clock]];
    state.onField.slice(0, 2).forEach(function(id){ var p = playerById(id); if (p) rows.push([p.name + ' (på banen)', fieldElapsed(id, now)]); });
    state.onBench.slice(0, 1).forEach(function(id){ var p = playerById(id); if (p) rows.push([p.name + ' (innbytter)', benchElapsed(id, now)]); });
    els.forgottenPreview.innerHTML = rows.map(function(r){
      return '<div><span>' + escapeHtml(r[0]) + '</span><span class="fp-to">' + formatMs(r[1]) + ' → ' + formatMs(Math.max(0, r[1] - trim)) + '</span></div>';
    }).join('');
    els.forgottenContinueBtn.textContent = forgottenCtx.auto ? 'Fortsett' : 'Avbryt';
  }

  function forgottenReset(){
    var thenEnd = forgottenCtx.thenEnd;
    closeForgottenSheet();
    if (!canEdit()) return;
    var excess = matchOvertimeMs(); // før pushUndoSnapshot() stempler lastPlayAt
    pushUndoSnapshot();
    // Pause: kampen er over - uten den ville klokka bare begynt å telle overtid på nytt.
    recordOp({ t: 'trim', ms: Math.max(0, excess), pause: true, continueReset: true });
    saveState();
    renderAll();
    showNotice('Klokka er stilt tilbake til kampslutt (' + formatMs(matchClockElapsed(nowTs())) + '). Du kan angre.');
    if (thenEnd) els.endBtn.click();
  }

  function forgottenContinue(){
    var ctx = forgottenCtx;
    closeForgottenSheet();
    if (!ctx.auto) return;
    if (canEdit()){
      setShared({ continueCount: (state.continueCount || 0) + 1, lastPlayAt: nowTs() }); // neste spørsmål krever lenger stille
    }
    if (ctx.thenEnd) els.endBtn.click(); else showClockHint();
  }

  // Aktiveres bare når appen er åpen og brukeren ikke er midt i noe: ingen
  // åpne vinduer/skjermer, ingen markering, ingen dra. Returnerer true om
  // arket ble åpnet.
  /** @returns {boolean} */
  function checkForgottenMatch(){
    if (forgottenOpen || state.players.length === 0 || !canEdit()) return false;
    if (document.querySelector('.modal.open, .history-screen.open')) return false;
    if (!els.launcherScreen.classList.contains('hidden')) return false;
    if (selected || multiMode || document.querySelector('.ghost-token')) return false;
    if (!forgottenMatchInfo(nowTs())) return false;
    openForgottenSheet({ auto: true, thenEnd: false });
    return true;
  }
  // Hvert sekund: oppdater arket hvis det er åpent (lukk det om en annen
  // enhet allerede har svart), ellers se om regelen er oppfylt.
  function forgottenTick(){
    runTips();
    if (forgottenOpen){
      if (forgottenCtx.auto && !forgottenMatchInfo(nowTs())) closeForgottenSheet();
      else fillForgottenSheet();
      return;
    }
    checkForgottenMatch();
  }

  /* ---- manuell justering: «Trekk fra tid» eller «Sett klokka til» ---- */
  var manual = { tab: 'sub', sub: 0, set: 0, clockSec: 0, thenEnd: false };
  /** @type {{match: any, swap: any}} */
  var manualSteps = { match: null, swap: null };
  function manualSecs(){ return manual.tab === 'sub' ? manual.sub : manual.set; }
  /** @param {number} sec */
  function setManualSecs(sec){
    var v = Math.max(0, Math.min(manual.clockSec, sec));
    if (manual.tab === 'sub') manual.sub = v; else manual.set = v;
    updateManualClockUI();
  }
  function updateManualClockUI(){
    Array.prototype.forEach.call(els.manualClockTabs.children, function(/** @type {HTMLElement} */ b){
      b.classList.toggle('active', b.dataset.tab === manual.tab);
    });
    els.manualMinLabel.textContent = manual.tab === 'sub' ? 'min fjernes' : 'min';
    els.manualSecLabel.textContent = manual.tab === 'sub' ? 'sek fjernes' : 'sek';
    manualSteps.match.refresh(); manualSteps.swap.refresh();
    var subSec = manual.tab === 'sub' ? manual.sub : manual.clockSec - manual.set;
    els.manualClockPreview.innerHTML = 'Klokka blir <b>' + formatMs((manual.clockSec - subSec) * 1000) + '</b> · fjerner <b>' + formatMs(subSec * 1000) + '</b> fra klokka og spillerne.';
  }
  /** @param {string} tab @param {boolean} [thenEnd] */
  function openManualClock(tab, thenEnd){
    var now = nowTs(), clock = matchClockElapsed(now), target = matchEndTargetMs(now);
    manual.clockSec = Math.floor(clock / 1000);
    manual.sub = Math.max(0, Math.floor((clock - target) / 1000));
    manual.set = Math.floor(target / 1000);
    manual.tab = tab;
    manual.thenEnd = !!thenEnd;
    updateManualClockUI();
    els.manualClockModal.classList.add('open');
  }
  function applyManualClock(){
    els.manualClockModal.classList.remove('open');
    if (!canEdit()) return;
    var clock = matchClockElapsed(nowTs());
    var subMs = manual.tab === 'sub' ? manual.sub * 1000 : clock - manual.set * 1000;
    subMs = Math.max(0, Math.min(clock, subMs));
    if (subMs > 0){
      subtractDeadTime(subMs, true); // årsaken er rettet - neste gang kan det spørres som vanlig
    }
    els.removeDeadTimeBtn.hidden = deadTimeSinceLastPlay(nowTs()) < 60000;
    if (manual.thenEnd) els.endBtn.click();
  }

  function togglePlayPause(){
    if (!canEdit()) return;
    ensureAudioUnlocked();
    recordOp({ t: 'clock', run: !state.globalRunning });
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
    if (!state.globalRunning || !canEdit()) return;
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
      var activityGap = nowTs() - (state.lastActivityAt || 0);
      if (activityGap <= IDLE_AUTO_PAUSE_MS) return;
      stopClockAt(last + clockOffsetMs);
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
    var gap = nowTs() - (state.lastActivityAt || 0);
    if (gap > IDLE_RESET_SUGGEST_MS){
      if (!isMaster()) return; // only the owner can actually reset a shared session
      if (isIdleSuggestSnoozed('reset')) return;
      idleSuggestShown = true;
      openIdleSuggestModal('reset');
      return;
    }
    var hasElapsedTime = state.globalRunning || matchClockElapsed(nowTs()) > 0;
    if (gap > IDLE_END_PERIOD_SUGGEST_MS && hasElapsedTime && !forgottenMatchInfo(nowTs())){
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
      els.idleSuggestText.textContent = 'Det har ikke skjedd noe i denne økten på over en time. Vil du avslutte perioden (Kampslutt)?' +
        (matchOvertimeMs() > 0 ? ' Klokka settes tilbake til kampslutt (' + formatMs(matchEndTargetMs(nowTs())) + ').' : '');
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
  // larger. Called on open and (first-run only, before Kampformat
  // locks) when the field size changes - never from typing or
  // blur, so it can't run mid-click.
  function syncNameRows(){
    var fieldSize = Math.max(1, Math.min(11, modalDraft.fieldSize || state.fieldSize || 3));
    var floor = Math.max(fieldSize + 1, MIN_NAME_ROWS);
    var rows = Array.prototype.slice.call(els.nameRows.querySelectorAll('.name-row'));
    while (rows.length < floor){
      rows.push(addNameRow(null, '', rows.length + 1));
    }
  }

  // Byttetid defaults to ~15% of kamptid, rounded up to the nearest whole
  // minute (10 min match -> 2 min, 20 min -> 3 min) - live as "Kamptid" is
  // changed. Byttetid stays freely adjustable afterwards, this is just the
  // suggested starting point.
  function applyMatchDurationSuggestion(){
    modalDraft.swapMin = Math.min(30, Math.max(1, Math.ceil(modalDraft.matchMin * 0.15)));
    if (modalSteps.swap) modalSteps.swap.refresh();
  }

  // Nearest of the four Kampformat buttons (an odd saved size, e.g. 4, lands
  // on the closest preset rather than matching none).
  /** @param {number} n @returns {number} */
  function nearestFormat(n){
    return [3, 5, 7, 11].reduce(function(a, b){ return Math.abs(b - n) < Math.abs(a - n) ? b : a; });
  }
  function updateModalFormatButtons(){
    Array.prototype.forEach.call(els.fieldFormatSeg.children, function(btn){
      btn.classList.toggle('active', parseInt(btn.dataset.size, 10) === modalDraft.fieldSize);
    });
    Array.prototype.forEach.call(qs('keeperSeg').children, function(btn){
      btn.classList.toggle('active', (btn.dataset.keeper === 'on') === modalDraft.keeper);
    });
    Array.prototype.forEach.call(qs('halvesSeg').children, function(btn){
      btn.classList.toggle('active', parseInt(btn.dataset.halves, 10) === modalDraft.halves);
    });
  }

  /* ---------------- Match duration picker (tap the match clock) ---------------- */

  var durationPickerValue = 20; // live value while the popup is open, minutes
  /** @type {any} */
  var durationStep = null;

  function commitDurationPickerValue(){
    setShared({ matchDurationMs: durationPickerValue * 60000, continueCount: 0 }); // kamptiden er rettet - årsaken til «Fortsett» er borte
    renderAll();
  }

  function openDurationPicker(){
    if (!canEdit()) return;
    hideClockHint();
    durationPickerValue = Math.max(1, Math.min(180, Math.round(state.matchDurationMs / 60000)));
    durationStep.refresh();
    els.matchDurationPickerModal.classList.add('open');
  }

  /** @param {boolean} [isFirstRun] @param {boolean} [joinedEmpty] */
  function openSettings(isFirstRun, joinedEmpty){
    var master = isMaster();
    // A blank, not-yet-configured match (no players registered yet) has
    // nothing of its own to lose - re-pull the "Standardverdier for ny
    // kamp" fields from Innstillinger/coachDefaults every time this screen
    // opens, so a change made there shows up immediately instead of only
    // on the NEXT genuinely fresh session (see resetMatch(), the only
    // other place state gets these from coachDefaults). Once players exist,
    // this state is "real" and is left alone - only resetMatch() replaces it.
    if (isFirstRun && master && state.players.length === 0){
      var coachDefaults = loadCoachDefaults();
      state.matchDurationMs = coachDefaults.matchDurationMs;
      state.defaultDurationMs = coachDefaults.defaultDurationMs;
      state.fieldSize = coachDefaults.fieldSize;
      state.rankByCumulative = coachDefaults.rankByCumulative;
      state.reorgUsesLastMatch = coachDefaults.reorgUsesLastMatch;
      state.swapSuggestionBasis = coachDefaults.swapSuggestionBasis;
      state.swapSuggestionBenchMode = coachDefaults.swapSuggestionBenchMode;
      state.homeTeamName = coachDefaults.homeTeamName;
      state.homeTeamAbbr = coachDefaults.homeTeamAbbr;
      state.hasKeeper = keeperDefaultFor(coachDefaults.fieldSize, coachDefaults.keeper);
      state.halves = coachDefaults.halves;
    }
    els.settingsModal.classList.add('open');
    els.cancelBtn.style.display = isFirstRun ? 'none' : '';
    els.settingsCloseBtn.style.display = isFirstRun ? 'none' : '';
    els.joinedEmptyNote.hidden = !joinedEmpty;
    els.masterOnlyNote.hidden = master;
    settingsDirty = false;
    els.nameRows.innerHTML = '';
    modalDraft.fieldSizeInit = state.fieldSize || 3;
    modalDraft.fieldSize = isFirstRun ? nearestFormat(modalDraft.fieldSizeInit) : modalDraft.fieldSizeInit;
    modalDraft.matchMin = modalDraft.matchMinInit = Math.max(1, Math.round(state.matchDurationMs / 60000));
    modalDraft.swapMin = modalDraft.swapMinInit = Math.max(1, Math.round(state.defaultDurationMs / 60000));

    state.players.forEach(function(p, idx){
      addNameRow(p.id, p.name, idx+1, state.onField.indexOf(p.id) !== -1);
    });
    syncNameRows(); // tops up to fieldSize+1 rows, or MIN_NAME_ROWS, whichever is larger

    // Kamptid and Kampformat are only chosen when the session is set up; during a
    // running match kamptid is changed by tapping the clock.
    var setup = isFirstRun && master;
    modalDraft.setup = !!setup;
    modalDraft.keeper = state.hasKeeper === true || (state.hasKeeper === undefined && fieldFormationRows(state.fieldSize).hasKeeper);
    modalDraft.halves = state.halves === 2 ? 2 : 1;
    els.matchDurationRow.hidden = !setup;
    els.fieldFormatRow.hidden = !setup;
    qs('keeperRow').hidden = !setup;
    qs('halvesRow').hidden = !setup;
    qs('modalTeamRow').hidden = !master;
    /** @type {HTMLInputElement} */ (qs('modalHomeName')).value = homeName();
    /** @type {HTMLInputElement} */ (qs('modalHomeAbbr')).value = homeAbbr();
    qs('openShareBtn').hidden = !sessionCode;
    qs('attendanceWrap').hidden = !setup || roster.length === 0;
    if (setup) renderAttendance();
    updateModalFormatButtons();
    modalSteps.match.refresh(); modalSteps.swap.refresh();
    modalSteps.match.setLocked(!master); modalSteps.swap.setLocked(!master);
    els.shareSessionToggle.checked = !!sessionCode;
    els.shareSessionRow.hidden = !master;
    els.choiceGroup.hidden = !master;
    els.choiceFold.dataset.open = 'false';
    els.choiceFoldBtn.setAttribute('aria-expanded', 'false');
    updateShareModeUI();
    els.rankByCumulativeToggle.checked = !!state.rankByCumulative;
    els.swapSuggestionBasisToggle.checked = state.swapSuggestionBasis === 'cumulative';
    els.swapSuggestionBenchModeToggle.checked = state.swapSuggestionBenchMode === 'cumulative';
    els.reorgLastMatchToggle.checked = !!state.reorgUsesLastMatch;
    refreshChoices();
    // Meaningless before a real match/roster exists (isFirstRun) - nothing
    // has been ticking yet. "Fjern dødtid" itself only shows once there's
    // actually a meaningful gap (>1 min) since the last real action -
    // otherwise it's just clutter for the completely normal case of
    // opening settings moments after doing something.
    els.correctTimeRow.hidden = !master || isFirstRun;
    var rollBackMs = matchOvertimeMs();
    els.rollBackBtn.hidden = !master || isFirstRun || rollBackMs <= 0;
    els.rollBackBtn.textContent = '⏪ Still klokka tilbake til kampslutt (fjerner ' + formatMs(rollBackMs) + ')';
    els.removeDeadTimeBtn.hidden = isFirstRun || !master || deadTimeSinceLastPlay(nowTs()) < 60000;
    // "Bli med i delt økt" only makes sense when this device isn't already
    // in a session - once it is, leaving/closing is "Forlat økt" under
    // "Avslutt" instead, not a re-labelled join button (that used to say
    // "Gå ut av delt økt", which read like it led to starting/continuing
    // something, not just closing the app).
    els.joinExistingBtn.hidden = !!sessionCode;

    transferOwnerConfirm.disarm();
    var transferTarget = master ? longestTenuredOtherParticipant() : null;
    els.transferOwnerRow.hidden = !transferTarget;
    els.joinedEmptyNote.hidden = !joinedEmpty;
    if (transferTarget) els.transferOwnerNote.textContent = 'Til enheten som ' + formatJoinedAgo(transferTarget.joinedAt);
  }

  /** @param {string|null} id @param {string} name @param {number} indexHint @param {boolean} [locked] @param {boolean} [fadeIn] @returns {HTMLElement} */
  function addNameRow(id, name, indexHint, locked, fadeIn){
    // Kun økt-eieren kan endre navn. En spiller på banen kan få navnet rettet (en skrivefeil skal ikke
    // måtte vente), men ikke fjernes herfra.
    var masterLocked = !isMaster();
    var fieldLocked = !!locked && !masterLocked;
    var row = document.createElement('div');
    row.className = 'name-row' + (masterLocked ? ' locked' : '') + (fieldLocked ? ' on-field' : '') + (fadeIn ? ' name-row-enter' : '');
    row.dataset.id = id || '';
    row.innerHTML =
      '<div class="name-input-wrap">' +
        '<input type="text" value="' + escapeHtml(name||'') + '" placeholder="Spiller ' + indexHint + '" autocomplete="off"' + (masterLocked ? ' disabled' : '') + '>' +
        (masterLocked || fieldLocked ? '' :
          '<span class="name-row-clear-divider" aria-hidden="true"></span>' +
          '<button type="button" class="name-row-clear-btn" aria-label="Fjern">×</button>') +
      '</div>' +
      (masterLocked || fieldLocked
        ? '<span class="locked-row-note" title="' + (masterLocked ? 'Kun økt-eieren kan endre spillernavn' : 'På banen: kan ikke fjernes her') + '">🔒</span>'
        : '');
    els.nameRows.appendChild(row);
    var wrap = row.querySelector('.name-input-wrap');
    if (masterLocked) return row;
    var input = /** @type {HTMLInputElement} */ (row.querySelector('input'));
    var removeBtn = /** @type {HTMLElement|null} */ (row.querySelector('.name-row-clear-btn'));
    if (removeBtn) removeBtn.addEventListener('click', function(){
      row.remove();
      settingsDirty = true;
      if (modalDraft.setup) renderAttendance();
    });
    input.addEventListener('input', function(){
      clearFieldInvalid(wrap);
      if (modalDraft.setup) renderAttendance();
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
    homeSteps.match.refresh();
    homeSteps.swap.refresh();
    Array.prototype.forEach.call(els.settingsFieldFormat.children, function(btn){
      btn.classList.toggle('active', parseInt(btn.dataset.size, 10) === settingsDraftFieldSize);
    });
    Array.prototype.forEach.call(qs('settingsHalvesSeg').children, function(btn){
      btn.classList.toggle('active', parseInt(btn.dataset.halves, 10) === settingsDraftHalves);
    });
    Array.prototype.forEach.call(qs('settingsKeeperSeg').children, function(btn){
      btn.classList.toggle('active', btn.dataset.keeper === settingsDraftKeeper);
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
    settingsDraftFieldSize = nearestFormat(d.fieldSize);
    settingsDraftHalves = d.halves;
    settingsDraftKeeper = d.keeper;
    updateSettingsStepperUI();
    renderStallList();
    renderDesignPicker();
    /** @type {HTMLInputElement} */ (qs('settingsWhistleToggle')).checked = soundPref('whistle');
    /** @type {HTMLInputElement} */ (qs('settingsPrewarnToggle')).checked = soundPref('prewarn');
    qs('deleteAccountWrap').hidden = !isTeamAccountSignedIn();
    els.settingsWakeLockToggle.checked = wakeLockWanted();
    els.settingsDefaultRankCumulative.checked = d.rankByCumulative;
    els.settingsDefaultReorgLastMatch.checked = d.reorgUsesLastMatch;
    els.settingsDefaultSwapBasisCumulative.checked = d.swapSuggestionBasis === 'cumulative';
    els.settingsDefaultSwapBenchByPlaytime.checked = d.swapSuggestionBenchMode === 'cumulative';
    refreshChoices();
    els.settingsSavedNote.hidden = true;
    updateSettingsStorageNote();
    els.settingsScreen.classList.add('open');
  }
  function closeSettingsScreen(){
    els.settingsScreen.classList.remove('open');
  }
  function saveSettingsScreen(){
    var name = els.settingsHomeName.value.trim() || 'Hjemmelag';
    var abbr = (els.settingsHomeAbbr.value.trim() || deriveAbbrFromName(name)).toUpperCase();
    /** @type {CoachDefaults} */
    var defaults = {
      homeTeamName: name,
      homeTeamAbbr: abbr,
      matchDurationMs: settingsDraftMatchDurationMin * 60000,
      defaultDurationMs: settingsDraftSwapDurationMin * 60000,
      fieldSize: settingsDraftFieldSize,
      rankByCumulative: els.settingsDefaultRankCumulative.checked,
      reorgUsesLastMatch: els.settingsDefaultReorgLastMatch.checked,
      swapSuggestionBasis: els.settingsDefaultSwapBasisCumulative.checked ? 'cumulative' : 'match',
      swapSuggestionBenchMode: els.settingsDefaultSwapBenchByPlaytime.checked ? 'cumulative' : 'waited',
      halves: settingsDraftHalves,
      keeper: settingsDraftKeeper
    };
    // Local cache always gets written, signed in or not - see this
    // function's own doc comment above initAccountAndSettings.
    saveCoachDefaults(defaults);
    els.settingsSavedNote.textContent = 'Lagret ✓';
    els.settingsSavedNote.hidden = false;
    if (isTeamAccountSignedIn()){
      upsertTeamSettings(adminUser.id, defaults).then(function(ok){
        if (!ok) els.settingsSavedNote.textContent = 'Lagret lokalt, men kontoen kunne ikke oppdateres akkurat nå.';
        else els.settingsSavedNote.textContent = 'Lagret ✓';
      });
      saveTeamExtras();
    }
  }

  function initAccountAndSettings(){
    migrateOldDefaultTeam();
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
          els.accountLoginNote.textContent = authErrorMessage(res.error);
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
      }).catch(function(e){
        els.accountLoginBtn.disabled = false;
        els.accountLoginNote.textContent = authErrorMessage(e);
        els.accountLoginNote.style.display = '';
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
      registrationInProgress = true; // see onAuthStateChange
      sb.auth.signUp({ email: email, password: password }).then(function(res){
        els.registerSubmitBtn.disabled = false;
        registrationInProgress = false;
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
        // Saved locally right away, in both cases below: without a session the
        // first real login seeds the account from this local copy.
        var defaults = loadCoachDefaults();
        defaults.homeTeamName = teamName;
        defaults.homeTeamAbbr = deriveAbbrFromName(teamName).slice(0, 4) || defaults.homeTeamAbbr;
        saveCoachDefaults(defaults);
        // No session back means the project requires e-post-bekreftelse
        // first (a Supabase project setting, not something this app
        // controls) - can't create the team_settings row yet since RLS
        // requires auth.uid(), so this waits for a real login afterwards.
        if (!session || !user){
          els.registerNote.textContent = 'Sjekk e-posten din for å bekrefte kontoen, og logg inn etterpå.';
          els.registerNote.style.display = '';
          return;
        }
        upsertTeamSettings(user.id, defaults).then(function(){
          closeRegisterScreen();
          openSettingsScreen();
        });
      }).catch(function(e){
        els.registerSubmitBtn.disabled = false;
        registrationInProgress = false;
        els.registerNote.textContent = authErrorMessage(e);
        els.registerNote.style.display = '';
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
    Array.prototype.forEach.call(els.settingsFieldFormat.children, function(btn){
      btn.addEventListener('click', function(){
        settingsDraftFieldSize = parseInt(btn.dataset.size, 10);
        updateSettingsStepperUI();
      });
    });
    Array.prototype.forEach.call(qs('settingsHalvesSeg').children, function(btn){
      btn.addEventListener('click', function(){ settingsDraftHalves = btn.dataset.halves === '2' ? 2 : 1; updateSettingsStepperUI(); });
    });
    Array.prototype.forEach.call(qs('settingsKeeperSeg').children, function(btn){
      btn.addEventListener('click', function(){ settingsDraftKeeper = btn.dataset.keeper; updateSettingsStepperUI(); });
    });
    qs('settingsWhistleToggle').addEventListener('change', function(e){ setSoundPref('whistle', e.target.checked); });
    qs('settingsPrewarnToggle').addEventListener('change', function(e){ setSoundPref('prewarn', e.target.checked); });
    qs('stallAddBtn').addEventListener('click', addStallFromInput);
    qs('stallAddInput').addEventListener('keydown', function(e){ if (e.key === 'Enter') addStallFromInput(); });
    qs('accountForgotLink').addEventListener('click', function(){
      var email = els.accountLoginEmail.value.trim();
      if (!email){
        els.accountLoginNote.textContent = 'Skriv inn e-posten din først.';
        els.accountLoginNote.style.display = '';
        return;
      }
      if (!sb) return;
      sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/' }).then(function(/** @type {any} */ res){
        els.accountLoginNote.textContent = res && res.error && res.error.status !== 400
          ? authErrorMessage(res.error)
          : 'Finnes kontoen, kommer det en e-post med en lenke. Sjekk også søppelpost.';
        els.accountLoginNote.style.display = '';
      }).catch(function(/** @type {any} */ e){
        els.accountLoginNote.textContent = authErrorMessage(e);
        els.accountLoginNote.style.display = '';
      });
    });
    els.newPasswordModal = qs('newPasswordModal');
    if (pendingPasswordRecovery) els.newPasswordModal.classList.add('open');
    qs('newPasswordSaveBtn').addEventListener('click', function(){
      var input = /** @type {HTMLInputElement} */ (qs('newPasswordInput'));
      var note = qs('newPasswordNote');
      if (!sb || !input.value) return;
      sb.auth.updateUser({ password: input.value }).then(function(/** @type {any} */ res){
        if (res && res.error){
          note.textContent = res.error.code === 'weak_password' ? 'Passordet er for svakt.' : authErrorMessage(res.error);
          note.style.display = '';
          return;
        }
        els.newPasswordModal.classList.remove('open');
        showNotice('Passordet er endret.');
      }).catch(function(/** @type {any} */ e){
        note.textContent = authErrorMessage(e);
        note.style.display = '';
      });
    });
    var deleteArm = createConfirmArm({
      armedEls: [qs('deleteAccountBtn')],
      labelEl: qs('deleteAccountBtn'),
      restingLabel: 'Slett konto',
      confirmLabel: 'Trykk igjen for å slette kontoen for godt'
    });
    qs('deleteAccountBtn').addEventListener('click', function(){
      if (!deleteArm.press() || !sb) return;
      var note = qs('deleteAccountNote');
      sb.rpc('delete_my_account').then(function(/** @type {any} */ res){
        if (res && res.error){
          note.textContent = isRpcMissing(res) ? 'Sletting er ikke tilgjengelig ennå. Be admin oppdatere databasen.' : 'Kunne ikke slette kontoen akkurat nå.';
          note.hidden = false;
          return;
        }
        sb.auth.signOut();
        closeSettingsScreen();
        showNotice('Kontoen er slettet.');
      }).catch(function(){
        note.textContent = 'Kunne ikke slette kontoen akkurat nå.';
        note.hidden = false;
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
    // nothing left to branch on here.
    els.historyTile.addEventListener('click', function(){
      if (isTeamAccountSignedIn()) openHistoryScreen();
      else openAccountLoginModal();
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

    // Undo snapshots refer to the old team: restoring one would bring back a
    // removed player's place on the field, or lose a new player from both zones.
    var oldIds = {};
    state.players.forEach(function(p){ oldIds[p.id] = true; });
    var rosterChanged = newPlayers.length !== state.players.length ||
      newPlayers.some(function(p){ return !oldIds[p.id]; });
    if (rosterChanged) clearUndoHistory();

    /** @type {Object<string, any>} */
    var rosterOp = { t: 'roster', players: newPlayers, keptIds: keptIds };
    // Only overwritten when actually changed - see modalDraft.
    if (modalDraft.matchMin !== modalDraft.matchMinInit) rosterOp.matchDurationMs = modalDraft.matchMin * 60000;
    if (modalDraft.swapMin !== modalDraft.swapMinInit) rosterOp.defaultDurationMs = modalDraft.swapMin * 60000;
    if (modalDraft.fieldSize !== modalDraft.fieldSizeInit) rosterOp.fieldSize = modalDraft.fieldSize;
    if (modalDraft.setup){
      rosterOp.hasKeeper = modalDraft.keeper;
      rosterOp.halves = modalDraft.halves;
    }
    var teamName = /** @type {HTMLInputElement} */ (qs('modalHomeName')).value.trim();
    var teamAbbr = /** @type {HTMLInputElement} */ (qs('modalHomeAbbr')).value.trim().toUpperCase();
    if (teamName) rosterOp.homeTeamName = teamName;
    if (teamAbbr) rosterOp.homeTeamAbbr = teamAbbr;
    recordOp(rosterOp);
    // Et nytt lag står på banen fra start: de første i lista, så justerer treneren etterpå.
    if (wasEmpty){
      state.players.slice(0, state.fieldSize || 3).forEach(function(p){ recordOp({ t: 'toField', p: p.id }); });
      state.eventLog = [];
    }
        addNamesToRoster(newPlayers.map(function(p){ return p.name; }));
    saveTeamExtras();

    saveState();
    els.settingsModal.classList.remove('open');
    renderAll();
    // Roster just went from nothing to a real team - "rett før man kommer
    // inn i kampen, før jeg flytter spillere inn på banen" is exactly this
    // moment, so this is where the (skippable) opponent prompt belongs, not
    // tucked away in settings itself.
    if (wasEmpty) openOpponentModal();
  }

  /** @param {any} op */
  function applyRoster(op){
    var newPlayers = op.players, keptIds = {};
    newPlayers.forEach(function(/** @type {Player} */ p){ keptIds[p.id] = true; });
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
    newPlayers.forEach(function(/** @type {Player} */ p){
      if (!oldIds[p.id]){
        state.onBench.push(p.id);
        state.benchTimers[p.id] = { baseElapsedMs: 0, sinceTs: op.at };
      }
    });
    state.players = newPlayers.map(function(/** @type {Player} */ p){ return { id: p.id, name: p.name }; });
    if (typeof op.matchDurationMs === 'number'){ state.matchDurationMs = op.matchDurationMs; state.continueCount = 0; }
    if (typeof op.defaultDurationMs === 'number') state.defaultDurationMs = op.defaultDurationMs;
    if (typeof op.fieldSize === 'number') state.fieldSize = op.fieldSize;
    if (typeof op.hasKeeper === 'boolean') state.hasKeeper = op.hasKeeper;
    if (op.halves === 1 || op.halves === 2) state.halves = op.halves;
    if (typeof op.homeTeamName === 'string') state.homeTeamName = op.homeTeamName;
    if (typeof op.homeTeamAbbr === 'string') state.homeTeamAbbr = op.homeTeamAbbr;
  }

  function buildExportText(){
    var now = nowTs();
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
    var now = nowTs();
    var goalBadges = computeGoalBadges();
    var rows = state.players.map(function(p){
      return { name: p.name, k: currentPeriodFieldMs(p.id, now), t: cumulativeFieldMs(p.id, now), goals: goalBadges.counts[p.id] || 0 };
    });
    rows.sort(function(a,b){ return b.k - a.k; });
    els.endMatchSummary.innerHTML = rows.map(function(r){
      return '<div class="ems-row">' +
        '<span class="ems-name">' + escapeHtml(r.name) + (r.goals > 0 ? ' <span class="ems-goals">' + r.goals + ' mål</span>' : '') + '</span>' +
        '<span class="ems-time">' + formatCumulative(r.k) + '</span>' +
        '<span class="ems-time">' + formatCumulative(r.t) + '</span>' +
      '</div>';
    }).join('');
  }

  // Kampslutt på ett ark: alt som trengs for å avslutte, uten en rekke spørsmål etter hverandre.
  var END_PREFS_KEY = 'spillerbytte_end_prefs_v1';
  function openEndSheet(){
    var now = nowTs();
    var home = teamGoalCount('home'), away = teamGoalCount('away');
    els.endSheetScore.textContent = homeAbbr() + ' ' + home + ' – ' + away + ' ' + (state.opponentAbbr || state.opponentName || '?');
    var swaps = state.swapCount || 0;
    els.endSheetMeta.textContent = formatMs(matchClockElapsed(now)) + ' spilt · ' + swaps + (swaps === 1 ? ' bytte' : ' bytter');
    var nameById = {};
    state.players.forEach(function(p){ nameById[p.id] = firstName(p.name); });
    var goals = state.goalLog.filter(function(g){ return g.team === 'home'; }).slice().sort(function(a,b){ return a.matchMs - b.matchMs; });
    els.endSheetGoals.hidden = goals.length === 0;
    els.endSheetGoals.textContent = goals.length ? 'Mål: ' + goals.map(function(g){ return (nameById[g.playerId || ''] || 'Ukjent') + ' ' + formatMs(g.matchMs); }).join(', ') : '';
    renderEndMatchSummary();
    var nextKeeper = suggestNextKeeper(now);
    els.endSheetKeeper.hidden = !nextKeeper;
    els.endSheetKeeper.textContent = nextKeeper ? 'Neste i mål: ' + firstName(nextKeeper.name) + ' (har stått ' + formatCumulative(nextKeeper.ms) + ')' : '';
    /** @type {any} */
    var prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(END_PREFS_KEY) || '{}') || {}; } catch(e){}
    els.endSaveToggle.checked = prefs.save !== false;
    els.endReorgToggle.checked = !!prefs.reorg;
    var next = cupNextMatch(now);
    els.endNextOpponent.value = next ? next.opponent : '';
    var editable = canEdit();
    els.endChoices.hidden = !editable;
    els.endPeriodWrap.hidden = !editable;
    els.endResetWrap.hidden = !isMaster();
    els.closeSessionRow.hidden = !sessionCode;
    els.endSheetTitle.textContent = editable ? 'Kampslutt' : 'Stillingen nå';
    avsluttConfirm.disarm();
    els.endMatchModal.classList.add('open');
  }
  function saveEndPrefs(){
    try { localStorage.setItem(END_PREFS_KEY, JSON.stringify({ save: els.endSaveToggle.checked, reorg: els.endReorgToggle.checked })); } catch(e){}
  }

  // "Hvilke motstandere har vi spilt mot, og hva ble stillingen" (see
  // state.matchHistory, archived in endMatchPeriod) - most recent match
  // first, each with its own players-by-playtime breakdown so a cup day's
  // several matches stay readable separately, distinct from the running
  // cross-match totals in .end-match-summary below this in the same modal.
  // A player who has since been removed from the roster still shows (by
  // whatever name they had then) rather than silently vanishing from a
  // match they actually played in. Shown in the Cup window.
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
          '<span class="mh-score">' + (Number(m.homeScore) || 0) + ' - ' + (Number(m.awayScore) || 0) + '</span>' +
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
    var now = nowTs();
    var calc = computeMatchScoreAndPlayerMs(now);
    var entry = buildHistoryArchiveEntry(now, calc);
    entry.durationMs = matchClockElapsed(now);
    entry.events = state.eventLog.slice();
    lastMatchSummary = entry;
    if (saveToHistory) saveToHistoryWithNote(entry);
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
    // Cleared here (not just at the two saveMatchToHistory() call sites)
    // so a stale failure note from a PREVIOUS match this popup showed never
    // lingers onto a new one that didn't even ask to be saved this time.
    if (els.matchSummaryHistoryNote) els.matchSummaryHistoryNote.hidden = true;
    var opponent = entry.opponentName || (entry.opponentAbbr ? entry.opponentAbbr : 'Ukjent motstander');
    els.matchSummaryHeadline.textContent =
      homeName() + ' vs ' + opponent + ' · ' + entry.homeScore + ' - ' + entry.awayScore;
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
      return '<div class="match-summary-goal match-summary-goal-' + (g.team === 'away' ? 'away' : 'home') + '">' +
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
    var timeline = buildTimelineHtml(entry);
    els.matchSummaryTimeline.innerHTML = timeline;
    els.matchSummaryTimeline.hidden = !timeline;
    els.matchSummaryTimelineTitle.hidden = !timeline;
    els.matchSummaryModal.classList.add('open');
  }

  /** @param {HistoryMatchEntry} entry @returns {string} */
  function buildTimelineHtml(entry){
    var nameById = {};
    (entry.players || []).forEach(function(p){ nameById[p.id] = firstName(p.name); });
    var nm = function(/** @type {string|null} */ id){ return escapeHtml((id && nameById[id]) || 'Ukjent'); };
    return (entry.events || []).map(function(ev){
      var text = ev.k === 'swap' ? nm(ev.a) + ' ut, ' + nm(ev.b) + ' inn'
        : ev.k === 'goal' ? (ev.team === 'home' ? 'Mål: ' + nm(ev.a) : 'Mål til motstanderen')
        : ev.k === 'toField' ? nm(ev.a) + ' inn'
        : ev.k === 'toBench' ? nm(ev.a) + ' ut'
        : ev.k === 'ungoal' ? 'Mål fjernet'
        : '';
      return text ? '<div class="timeline-row' + (ev.k === 'goal' ? ' goal' : '') + '"><span>' + formatMs(ev.ms) + '</span><span>' + text + '</span></div>' : '';
    }).join('');
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

  /** @param {boolean} reorganize @param {boolean} saveToHistory @param {{name:string, abbr:string}} [nextOpponent] */
  function endMatchPeriod(reorganize, saveToHistory, nextOpponent){
    var now = nowTs();
    // Built before anything is reset, and only here: if this end has to be replayed on top of a
    // newer state (another coach changed something at the same moment), the match must not be
    // saved to Historikk twice.
    var summaryEntry = buildHistoryArchiveEntry(now, computeMatchScoreAndPlayerMs(now));
    summaryEntry.durationMs = matchClockElapsed(now);
    summaryEntry.events = state.eventLog.slice();
    lastMatchSummary = summaryEntry;
    syncKeeperTime(now);
    bankKeeperHistory(now);
    // The shared Supabase archive - state.matchHistory is synced shared-session state and gets wiped
    // by resetMatch() same as everything else, which is right for "this session's matches so far"
    // but wrong for a durable record.
    if (saveToHistory) saveToHistoryWithNote(summaryEntry);
    recordOp({ t: 'endMatch', at: now, reorganize: reorganize, nextOpponentName: nextOpponent ? nextOpponent.name : '', nextOpponentAbbr: nextOpponent ? nextOpponent.abbr : '' });
    selected = null;
    suggestedPartnerId = null;
    undoStack = [];
    redoStack = [];
    multiMode = false;
    multiSelected = [];
    saveState();
  }

  // The state half of Kampslutt. Runs again if the end is replayed, so it only depends on state.
  /** @param {boolean} reorganize @param {number} now @param {string} [nextName] @param {string} [nextAbbr] */
  function applyEndMatch(reorganize, now, nextName, nextAbbr){
    // Each player's time in this match, read before the stints are banked.
    var calc = computeMatchScoreAndPlayerMs(now);
    var homeScore = calc.homeScore, awayScore = calc.awayScore, playerMs = calc.playerMs;
    // commitFieldStint/commitBenchStint bank the current stint into state.cumulative; the timers
    // are replaced below, so nothing can count it a second time.
    state.onField.forEach(function(id){ commitFieldStint(id, now); });
    state.onBench.forEach(function(id){ commitBenchStint(id, now); });
    if (!Array.isArray(state.matchHistory)) state.matchHistory = [];
    state.matchHistory.push({
      id: uid(),
      opponentName: state.opponentName || '',
      opponentAbbr: state.opponentAbbr || '',
      homeScore: homeScore,
      awayScore: awayScore,
      endedAt: now,
      playerMs: playerMs,
      // Snapshots the scorer's name (not just id) so "Eksporter spillerdata" still shows who scored
      // even after a player is later removed from the roster. Away goals have no playerId.
      goals: state.goalLog
        .filter(function(g){ return g.team === 'home' && g.playerId; })
        .map(function(g){
          var id = /** @type {string} */ (g.playerId);
          var p = playerById(id);
          return { playerId: id, playerName: p ? p.name : '(fjernet spiller)', matchMs: g.matchMs };
        })
    });
    // "Kampslutt" means a new match (a cup day is several, not halves of one), so the goals,
    // the swap count and the opponent don't carry over.
    state.goalLog = [];
    state.eventLog = [];
    state.swapCount = 0;
    state.continueCount = 0;
    state.halfStage = 1;
    state.keeperMs = {};
    state.keeperNow = null;
    state.opponentName = nextName || '';
    state.opponentAbbr = nextAbbr || '';

    if (reorganize){
      // reorgUsesLastMatch: each player's time in the match that just ended; otherwise the total.
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
    state.onField.forEach(function(id){ state.fieldTimers[id] = { baseElapsedMs: 0, sinceTs: now }; });
    state.onBench.forEach(function(id){ state.benchTimers[id] = { baseElapsedMs: 0, sinceTs: now }; });
    state.matchClock = { baseElapsedMs: 0, sinceTs: now };
    state.globalRunning = false;
    // Baseline for "current period" (see currentPeriodFieldMs): the next match counts from here.
    state.periodStartCumulative = cloneStateValue(state.cumulative);
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
    // defaultState() sets these back to null/[] - losing sessionOwnerDeviceId
    // here would silently un-master the very device that's allowed to call
    // this function, locking everyone (including the real owner) out of
    // isMaster()-gated controls for the rest of the shared session. Only inside
    // a session, though: after leaving someone else's, a new local match has
    // nothing to do with that session's owner and devices.
    recordOp({ t: 'reset' });
    saveState();
    updateUndoUI();
    updateMultiSelectUI();
    els.endMatchModal.classList.remove('open');
    els.settingsModal.classList.remove('open');
    renderAll();
    openSettings(true);
  }

  // A new, empty match. Inside a shared session the session itself lives on: losing the owner would
  // lock everyone out of the owner's controls, and a lower rev would make every other device reject
  // the reset as out of date. After leaving someone else's session, none of that carries over.
  // Kamptid, byttetid and format come fresh from defaultState(), so a change in Innstillinger
  // applies to the very next match.
  function applyReset(){
    var keepOwnerDeviceId = sessionCode ? state.sessionOwnerDeviceId : null;
    var keepParticipants = sessionCode ? state.participants : [];
    var keepSessionUid = sessionCode ? state.sessionUid : undefined;
    var keepRev = state.rev;
    var keepOpIds = state.opIds;
    state = defaultState();
    state.sessionOwnerDeviceId = keepOwnerDeviceId;
    state.participants = keepParticipants;
    if (keepSessionUid) state.sessionUid = keepSessionUid;
    state.rev = keepRev;
    state.opIds = keepOpIds;
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

  /* ---------------- Stripe nederst: bekreftelse med Angre ---------------- */

  /** @type {ReturnType<typeof setTimeout>|undefined} */
  var toastTimer;
  /** @type {(() => void)|null} */
  var toastAction = null;
  /** @param {string} text @param {string|null} [actionLabel] @param {(() => void)|null} [action] @param {number} [ms] */
  function showToast(text, actionLabel, action, ms){
    if (!els.undoToast) return;
    els.undoToastText.textContent = text;
    els.undoToastBtn.hidden = !actionLabel;
    if (actionLabel) els.undoToastBtn.textContent = actionLabel;
    toastAction = action || null;
    els.undoToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms || 5000);
  }
  function hideToast(){
    clearTimeout(toastTimer);
    toastAction = null;
    if (els.undoToast) els.undoToast.classList.remove('show');
  }
  /** @param {string} text */
  function showUndoToast(text){
    showToast(text, 'Angre', function(){ undoLastAction(); });
  }
  /** @param {string} name @returns {string} */
  function firstName(name){
    return String(name || '').trim().split(/\s+/)[0] || '';
  }

  /* ---------------- Tips første gang ---------------- */

  var TIPS = {
    swap: 'Dra en spiller over en annen for å bytte, eller trykk på begge.',
    goal: 'Trykk på tallet ved klokka for å registrere mål. Hold inne for å fjerne.',
    due: 'Merket betyr at byttetiden er nådd. «Bytt» ved benken bytter den som har spilt lengst.'
  };
  var TIPS_KEY = 'spillerbytte_tips_seen_v1';
  var lastTipAt = 0;
  /** @param {string} key */
  function maybeTip(key){
    if (spectatorCode || !canEdit() || !els.launcherScreen || !els.launcherScreen.classList.contains('hidden')) return;
    if (Date.now() - lastTipAt < 15000 || (els.undoToast && els.undoToast.classList.contains('show'))) return;
    /** @type {any} */
    var seen = {};
    try { seen = JSON.parse(localStorage.getItem(TIPS_KEY) || '{}') || {}; } catch(e){}
    if (seen[key] || !TIPS[key]) return;
    seen[key] = true;
    try { localStorage.setItem(TIPS_KEY, JSON.stringify(seen)); } catch(e){}
    lastTipAt = Date.now();
    showToast(TIPS[key], null, null, 7000);
  }
  function runTips(){
    if (state.players.length === 0 || document.querySelector('.modal.open')) return;
    if (state.onBench.length > 0 && state.onField.length > 0) maybeTip('swap');
    else maybeTip('goal');
    if (matchClockElapsed(nowTs()) > 60000) maybeTip('goal');
  }

  /* ---------------- Alarmer: omganger, full tid, forvarsel ---------------- */

  var PREWARN_MS = 30000;
  /** @type {Object<string, boolean>} */
  var prewarned = {};
  var fullTimeNotified = false;
  /** @param {string} id @param {number} elapsed */
  function notePrewarn(id, elapsed){
    var d = state.defaultDurationMs;
    if (elapsed < d - PREWARN_MS){ delete prewarned[id]; return; }
    if (elapsed >= d || prewarned[id] || !state.globalRunning) return;
    prewarned[id] = true;
    if (!spectatorCode && soundPref('prewarn')) playTones([[1320, 0, 0.14]]);
  }
  /** @param {number} now */
  function checkMatchAlarms(now){
    var clock = matchClockElapsed(now), d = state.matchDurationMs;
    if (state.halves === 2 && state.halfStage !== 2 && clock >= d / 2 && canEdit()){
      // Stoppes nøyaktig på halvtid, også om telefonen var låst akkurat da.
      recordOp({ t: 'halftime', at: now - (clock - d / 2) });
      saveState();
      updatePlayPauseUI();
      updateTimersOnly();
      if (soundPref('whistle')) playWhistle();
      showNotice('Første omgang er ferdig. Klokka står til du trykker Start.');
      return;
    }
    if (clock >= d){
      if (fullTimeNotified) return;
      fullTimeNotified = true;
      if (!spectatorCode && soundPref('whistle')) playWhistle();
      if (!spectatorCode) showNotice('Full tid');
    } else {
      fullTimeNotified = false;
    }
  }

  /* ---------------- Neste bytte og rettferdighet ---------------- */

  var lastPanelsSecond = -1;
  /** @type {{at:number, rev:number, plan:any}|null} */
  var planCache = null;

  // Kampens spilletid fram til full tid hvis planen følges, regnet fra stillingen akkurat nå. Keeperen
  // står utenfor rotasjonen. Hver gang byttetiden er nådd byttes så mange som det er rettferdig å bytte.
  /** @param {number} now */
  function computeRotationPlan(now){
    var clock = matchClockElapsed(now), total = state.matchDurationMs;
    var interval = Math.max(60000, state.defaultDurationMs);
    var keeper = keeperIdNow();
    /** @type {Object<string, number>} */
    var played = {};
    /** @type {Object<string, number>} */
    var stint = {};
    state.players.forEach(function(p){ played[p.id] = currentPeriodFieldMs(p.id, now); });
    var field = state.onField.slice(), bench = state.onBench.slice();
    field.forEach(function(id){ stint[id] = fieldElapsed(id, now); });
    var rotating = field.filter(function(id){ return id !== keeper; });
    var t = clock;
    /** @type {{atMs:number, pairs:{out:string, in:string}[]}[]} */
    var changes = [];
    if (bench.length > 0 && rotating.length > 0){
      for (var guard = 0; guard < 200; guard++){
        var longest = 0;
        rotating.forEach(function(id){ if (stint[id] > longest) longest = stint[id]; });
        var dt = Math.max(30000, interval - longest);
        if (t + dt >= total - 30000) break; // ingen bytter det siste halve minuttet
        field.forEach(function(id){ played[id] += dt; stint[id] = (stint[id] || 0) + dt; });
        t += dt;
        rotating.sort(function(a, b){ return played[b] - played[a]; });
        bench.sort(function(a, b){ return played[a] - played[b]; });
        var pairs = [];
        for (var i = 0; i < bench.length && i < rotating.length; i++){
          if (stint[rotating[i]] < interval * 0.75 || played[rotating[i]] <= played[bench[i]]) break;
          pairs.push({ out: rotating[i], in: bench[i] });
        }
        pairs.forEach(function(pair){
          rotating[rotating.indexOf(pair.out)] = pair.in;
          field[field.indexOf(pair.out)] = pair.in;
          bench[bench.indexOf(pair.in)] = pair.out;
          stint[pair.in] = 0;
        });
        if (pairs.length > 0) changes.push({ atMs: t, pairs: pairs });
      }
    }
    if (total > t) field.forEach(function(id){ played[id] += total - t; });
    var values = state.players.filter(function(p){ return p.id !== keeper; }).map(function(p){ return played[p.id]; });
    var max = values.length ? Math.max.apply(null, values) : 0, min = values.length ? Math.min.apply(null, values) : 0;
    var sum = values.reduce(function(a, b){ return a + b; }, 0);
    return { changes: changes, projected: played, keeper: keeper, average: values.length ? sum / values.length : 0, spread: max - min };
  }
  /** @param {number} now */
  function cachedPlan(now){
    if (!planCache || planCache.rev !== state.rev || now - planCache.at > 5000 || now < planCache.at){
      planCache = { at: now, rev: state.rev, plan: computeRotationPlan(now) };
    }
    return planCache.plan;
  }

  /** @param {number} now @returns {{fieldId:string, benchId:string, inMs:number}|null} */
  function computeNextSwap(now){
    if (state.onBench.length === 0 || state.onField.length === 0) return null;
    if (state.planEnabled){
      var plan = cachedPlan(now);
      if (plan.changes.length > 0){
        var c = plan.changes[0];
        return { fieldId: c.pairs[0].out, benchId: c.pairs[0].in, inMs: Math.max(0, c.atMs - matchClockElapsed(now)) };
      }
    }
    var due = computeSwapSuggestion(now);
    if (due) return { fieldId: due.fieldId, benchId: due.benchId, inMs: 0 };
    var keeper = keeperIdNow();
    /** @type {any} */
    var soonest = null;
    state.onField.forEach(function(id){
      if (id !== keeper && (!soonest || fieldElapsed(id, now) > fieldElapsed(soonest, now))) soonest = id;
    });
    if (!soonest) return null;
    var benchId = state.swapSuggestionBenchMode === 'cumulative'
      ? pickByMetric(state.onBench, function(id){ return currentPeriodFieldMs(id, now); }, true)
      : pickByMetric(state.onBench, function(id){ return benchElapsed(id, now); });
    if (!benchId) return null;
    return { fieldId: soonest, benchId: benchId, inMs: Math.max(0, state.defaultDurationMs - fieldElapsed(soonest, now)) };
  }

  /** @type {string} */
  var lastNextPair = '';
  /** @param {number} now */
  function renderMatchPanels(now){
    if (!els.nextSwapBar) return;
    var next = spectatorCode ? null : computeNextSwap(now);
    els.nextSwapBar.hidden = !next;
    var pair = '';
    if (next){
      var out = playerById(next.fieldId), inn = playerById(next.benchId);
      if (out && inn){
        pair = next.fieldId + '|' + next.benchId;
        els.nextSwapLabel.textContent = next.inMs > 0 ? 'Neste bytte om ' + formatMs(next.inMs) : 'Neste bytte';
        els.nextSwapNames.textContent = firstName(out.name) + ' ut ⇄ ' + firstName(inn.name) + ' inn';
        els.nextSwapBar.classList.toggle('ready', next.inMs === 0);
        els.nextSwapBtn.hidden = !canEdit() || multiMode;
      }
    }
    if (pair !== lastNextPair || document.querySelector('.token') && !document.querySelector('.token.next-out, .token.next-in')){
      lastNextPair = pair;
      Array.prototype.forEach.call(document.querySelectorAll('.token.next-out, .token.next-in'), function(el){ el.classList.remove('next-out', 'next-in'); });
      if (next){
        var a = els.field.querySelector('[data-id="' + next.fieldId + '"]'), b = els.bench.querySelector('[data-id="' + next.benchId + '"]');
        if (a) a.classList.add('next-out');
        if (b) b.classList.add('next-in');
      }
    }
    renderFairness(now);
  }

  /** @param {number} now */
  function renderFairness(now){
    var line = els.fairnessLine;
    if (!line) return;
    var clock = matchClockElapsed(now);
    var nextMatch = clock === 0 ? cupNextMatch(now) : null;
    if (nextMatch){
      var mins = cupMinutesUntil(nextMatch, now);
      line.textContent = 'Neste kamp ' + nextMatch.time + (nextMatch.opponent ? ' mot ' + nextMatch.opponent : '') + (mins > 0 ? ' (om ' + mins + ' min)' : '');
      line.hidden = false;
      return;
    }
    if (clock < 60000 || state.players.length <= (state.fieldSize || 3)){
      line.hidden = true;
      return;
    }
    var msFor = state.rankByCumulative ? cumulativeFieldMs : currentPeriodFieldMs;
    var keeper = keeperIdNow();
    /** @type {any} */
    var hi = null;
    /** @type {any} */
    var lo = null;
    state.players.forEach(function(p){
      if (p.id === keeper) return;
      if (!hi || msFor(p.id, now) > msFor(hi.id, now)) hi = p;
      if (!lo || msFor(p.id, now) < msFor(lo.id, now)) lo = p;
    });
    if (!hi || !lo) return;
    var gap = msFor(hi.id, now) - msFor(lo.id, now);
    line.textContent = 'Størst forskjell ' + formatCumulative(gap) + ': ' + firstName(hi.name) + ' mest, ' + firstName(lo.name) + ' minst';
    line.hidden = false;
  }

  /* ---------------- Bytteplan ---------------- */

  function openPlanModal(){
    renderPlanModal();
    els.planModal.classList.add('open');
  }
  function renderPlanModal(){
    var now = nowTs();
    planCache = null;
    var plan = cachedPlan(now);
    var nameOf = function(/** @type {string} */ id){ var p = playerById(id); return p ? firstName(p.name) : '?'; };
    qs('planSummary').textContent = state.onBench.length === 0
      ? 'Ingen på benken, så det er ingen bytter å planlegge.'
      : 'Alle får rundt ' + formatCumulative(plan.average) + ' i denne kampen, med ' + formatCumulative(plan.spread) + ' mellom mest og minst. Planen regnes på nytt ut fra stillingen nå.';
    var toggle = /** @type {HTMLInputElement} */ (qs('planEnabledToggle'));
    toggle.checked = !!state.planEnabled;
    toggle.disabled = !canEdit();
    qs('planList').innerHTML = plan.changes.map(function(/** @type {any} */ c){
      return '<div class="plan-row"><span class="plan-time">' + formatMs(c.atMs) + '</span><span>' +
        c.pairs.map(function(/** @type {any} */ pair){ return escapeHtml(nameOf(pair.out)) + ' ut, ' + escapeHtml(nameOf(pair.in)) + ' inn'; }).join('<br>') +
      '</span></div>';
    }).join('') || '<p class="sub">Ingen flere bytter før full tid.</p>';
    qs('planPlayers').innerHTML = state.players.slice().sort(function(a, b){ return plan.projected[b.id] - plan.projected[a.id]; }).map(function(p){
      return '<div class="plan-row"><span>' + escapeHtml(p.name) + (p.id === plan.keeper ? ' <span class="plan-tag">Keeper</span>' : '') + '</span><span class="plan-time">' + formatCumulative(plan.projected[p.id] || 0) + '</span></div>';
    }).join('');
    var next = suggestNextKeeper(now);
    var keeperBox = qs('planKeeper');
    keeperBox.hidden = !next;
    if (next){
      qs('planKeeperText').textContent = 'Neste i mål: ' + next.name + ' (har stått ' + formatCumulative(next.ms) + ')';
      var btn = qs('planKeeperBtn');
      btn.hidden = !canEdit();
      btn.textContent = 'Sett i mål nå';
      btn.dataset.id = next.id;
    }
  }
  /** @param {string} id */
  function putInGoal(id){
    if (!canEdit()) return;
    var keeper = keeperIdNow();
    if (!keeper || keeper === id) return;
    if (state.onField.indexOf(id) !== -1){
      performPositionSwap(keeper, id);
    } else {
      animateAndPerformSwap(keeper, id); // en innbytter arver plassen til den som går ut
    }
  }

  /* ---------------- Cup ---------------- */

  /** @returns {{id:string, time:string, opponent:string}[]} */
  function cupMatches(){
    return state.cup && Array.isArray(state.cup.matches) ? state.cup.matches : [];
  }
  /** @param {{time:string}} match @param {number} now @returns {number} */
  function cupMinutesUntil(match, now){
    var parts = match.time.split(':');
    var d = new Date(now);
    d.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
    return Math.round((d.getTime() - now) / 60000);
  }
  /** @param {number} now */
  function cupNextMatch(now){
    var upcoming = cupMatches().filter(function(m){ return m.time && cupMinutesUntil(m, now) > 0; })
      .sort(function(a, b){ return a.time < b.time ? -1 : 1; });
    return upcoming[0] || null;
  }
  /** @param {any} cup */
  function saveCup(cup){
    setShared({ cup: cup });
    renderFairness(nowTs());
  }
  function openCupModal(){
    renderCupModal();
    els.cupModal.classList.add('open');
  }
  function renderCupModal(){
    var now = nowTs();
    var editable = canEdit();
    var next = cupNextMatch(now);
    qs('cupNext').textContent = next
      ? 'Neste kamp ' + next.time + (next.opponent ? ' mot ' + next.opponent : '') + ' (om ' + cupMinutesUntil(next, now) + ' min)'
      : 'Legg inn kampene, så teller appen ned til neste og foreslår motstanderen ved kampslutt.';
    var nameInput = /** @type {HTMLInputElement} */ (qs('cupNameInput'));
    nameInput.value = state.cup ? state.cup.name : '';
    nameInput.disabled = !editable;
    var list = qs('cupList');
    list.innerHTML = '';
    cupMatches().forEach(function(m){
      var row = document.createElement('div');
      row.className = 'cup-row';
      row.innerHTML = '<input type="time" class="mini-input cup-time" aria-label="Klokkeslett">' +
        '<input type="text" class="mini-input" placeholder="Motstander" maxlength="40" autocomplete="off" aria-label="Motstander">' +
        '<button type="button" class="name-row-clear-btn cup-del" aria-label="Fjern kamp">×</button>';
      var inputs = row.querySelectorAll('input');
      var time = /** @type {HTMLInputElement} */ (inputs[0]), opp = /** @type {HTMLInputElement} */ (inputs[1]);
      time.value = m.time;
      opp.value = m.opponent;
      time.disabled = opp.disabled = !editable;
      var commit = function(){
        saveCup({ name: state.cup ? state.cup.name : '', matches: cupMatches().map(function(x){
          return x.id === m.id ? { id: x.id, time: time.value, opponent: opp.value.trim() } : x;
        }) });
      };
      time.addEventListener('change', commit);
      opp.addEventListener('change', commit);
      /** @type {HTMLElement} */ (row.querySelector('.cup-del')).addEventListener('click', function(){
        if (!editable) return;
        saveCup({ name: state.cup ? state.cup.name : '', matches: cupMatches().filter(function(x){ return x.id !== m.id; }) });
        renderCupModal();
      });
      list.appendChild(row);
    });
    qs('cupAddBtn').hidden = !editable;
    renderMatchHistorySummary();
    qs('cupPlayedTitle').hidden = (state.matchHistory || []).length === 0;
    var nowMs = nowTs();
    var goalsByPlayer = {};
    (state.matchHistory || []).forEach(function(m){
      (m.goals || []).forEach(function(g){ goalsByPlayer[g.playerId] = (goalsByPlayer[g.playerId] || 0) + 1; });
    });
    var liveGoals = computeGoalBadges().counts;
    qs('cupTotals').innerHTML = state.players.slice().sort(function(a, b){ return cumulativeFieldMs(b.id, nowMs) - cumulativeFieldMs(a.id, nowMs); }).map(function(p){
      var g = (goalsByPlayer[p.id] || 0) + (liveGoals[p.id] || 0);
      return '<div class="plan-row"><span>' + escapeHtml(p.name) + (g > 0 ? ' <span class="plan-tag">' + g + ' mål</span>' : '') + '</span><span class="plan-time">' + formatCumulative(cumulativeFieldMs(p.id, nowMs)) + '</span></div>';
    }).join('');
  }

  /* ---------------- Fast stall og frammøte ---------------- */

  function renderAttendance(){
    var box = qs('attendanceChips');
    var inRows = {};
    Array.prototype.forEach.call(els.nameRows.querySelectorAll('.name-row input'), function(inp){
      var v = inp.value.trim().toLowerCase();
      if (v) inRows[v] = true;
    });
    box.innerHTML = roster.map(function(name){
      var on = !!inRows[name.toLowerCase()];
      return '<button type="button" class="att-chip' + (on ? ' on' : '') + '" aria-pressed="' + on + '">' + (on ? '✓ ' : '') + escapeHtml(name) + '</button>';
    }).join('');
    Array.prototype.forEach.call(box.children, function(btn, i){
      btn.addEventListener('click', function(){ toggleAttendance(roster[i]); });
    });
  }
  /** @param {string} name */
  function toggleAttendance(name){
    var rows = Array.prototype.slice.call(els.nameRows.querySelectorAll('.name-row'));
    var lower = name.toLowerCase();
    var existing = rows.filter(function(r){ return r.querySelector('input').value.trim().toLowerCase() === lower; })[0];
    if (existing){
      /** @type {any} */ (existing.querySelector('input')).value = '';
    } else {
      var empty = rows.filter(function(r){ return !r.querySelector('input').value.trim(); })[0];
      if (!empty) empty = addNameRow(null, '', rows.length + 1, false, true);
      /** @type {any} */ (empty.querySelector('input')).value = name;
    }
    settingsDirty = true;
    renderAttendance();
  }
  function renderStallList(){
    var box = qs('stallList');
    box.innerHTML = roster.length === 0
      ? '<p class="toggle-row-sub">Ingen ennå. Navn du bruker i en kamp havner her automatisk.</p>'
      : roster.map(function(name){
          return '<div class="stall-row"><span>' + escapeHtml(name) + '</span><button type="button" class="name-row-clear-btn stall-del" aria-label="Fjern ' + escapeHtml(name) + '">×</button></div>';
        }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.stall-del'), function(btn, i){
      btn.addEventListener('click', function(){
        roster.splice(i, 1);
        saveRoster();
        saveTeamExtras();
        renderStallList();
      });
    });
  }
  function addStallFromInput(){
    var input = /** @type {HTMLInputElement} */ (qs('stallAddInput'));
    var name = input.value.trim();
    if (!name) return;
    addNamesToRoster([name]);
    saveTeamExtras();
    input.value = '';
    renderStallList();
  }

  /* ---------------- Deling: lenke, QR og foreldrevisning ---------------- */

  /** @param {string} code @returns {boolean} */
  function isValidSessionCode(code){
    return /^[0-9]{3}$/.test(code) || /^[A-Z][A-Z2-9]{5}$/.test(code);
  }
  /** @returns {boolean} */
  function isStandalone(){
    return !!(/** @type {any} */ (navigator).standalone) || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }
  /** @param {() => void} done */
  function loadQrLibrary(done){
    if (/** @type {any} */ (window).qrcode){ done(); return; }
    var tag = document.createElement('script');
    tag.src = '/vendor/qrcode-generator-2.0.4.js';
    tag.onload = done;
    document.head.appendChild(tag);
  }
  /** @param {HTMLElement} host @param {string} url */
  function drawQr(host, url){
    host.innerHTML = '';
    loadQrLibrary(function(){
      var lib = /** @type {any} */ (window).qrcode;
      if (!lib) return;
      var qr = lib(0, 'M');
      qr.addData(url);
      qr.make();
      host.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true }); // bare vår egen lenke, ingen data utenfra
    });
  }
  /** @param {string} text @param {HTMLElement} btn */
  function copyWithReceipt(text, btn){
    var original = btn.textContent;
    var done = function(){
      btn.textContent = 'Kopiert ✓';
      setTimeout(function(){ btn.textContent = original; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(function(){});
  }
  /** @param {{title:string, text?:string, url?:string, file?:File|null}} data @param {HTMLElement} btn */
  function shareOrCopy(data, btn){
    /** @type {any} */
    var payload = { title: data.title };
    if (data.text) payload.text = data.text;
    if (data.url) payload.url = data.url;
    if (data.file && navigator.canShare && navigator.canShare({ files: [data.file] })) payload.files = [data.file];
    var fallback = function(){ copyWithReceipt([data.text, data.url].filter(Boolean).join('\n'), btn); };
    if (!navigator.share){ fallback(); return; }
    navigator.share(payload).catch(function(/** @type {any} */ e){
      if (e && e.name === 'AbortError') return; // treneren ombestemte seg
      fallback();
    });
  }
  function openShareSheet(){
    if (!sessionCode) return;
    var joinUrl = location.origin + '/?okt=' + encodeURIComponent(sessionCode);
    // «Kun les»: da gis ikke skrivekoden videre.
    var readOnly = state.shareEditable === false;
    qs('shareEditBlock').hidden = readOnly;
    qs('shareCode').textContent = sessionCode;
    if (!readOnly) drawQr(qs('shareEditQr'), joinUrl);
    /** @type {any} */ (qs('shareEditLinkBtn')).onclick = function(){
      shareOrCopy({ title: 'Bli med i kampen', url: joinUrl }, qs('shareEditLinkBtn'));
    };
    /** @type {any} */ (qs('shareCopyCodeBtn')).onclick = function(){ copyWithReceipt(/** @type {string} */ (sessionCode), qs('shareCopyCodeBtn')); };
    qs('shareViewBlock').hidden = !sessionViewCode;
    qs('shareViewMissing').hidden = !!sessionViewCode;
    if (sessionViewCode){
      var viewUrl = location.origin + '/?se=' + encodeURIComponent(sessionViewCode);
      drawQr(qs('shareViewQr'), viewUrl);
      /** @type {any} */ (qs('shareViewLinkBtn')).onclick = function(){
        shareOrCopy({ title: 'Følg kampen', url: viewUrl }, qs('shareViewLinkBtn'));
      };
    }
    els.shareModal.classList.add('open');
  }

  // Foreldrelenken. Egen kode som bare kan lese. Ingenting lagres, ingen deltaker registreres, og en
  // kamp som ligger på telefonen fra før røres ikke (se saveStateLocally og canEdit).
  /** @param {string} code */
  function startSpectator(code){
    spectatorCode = code;
    document.documentElement.classList.add('spectator');
    state = defaultState();
    els.launcherScreen.classList.add('hidden');
    els.spectatorBar.hidden = false;
    els.sessionCodeBar.style.display = 'none';
    renderAll();
    fetchSpectatorState();
    if (sb){
      sb.channel('view-' + code).on('broadcast', { event: 'changed' }, fetchSpectatorState).subscribe();
    }
    setInterval(function(){ if (!document.hidden) fetchSpectatorState(); }, 15000);
    document.addEventListener('visibilitychange', function(){ if (!document.hidden) fetchSpectatorState(); });
  }
  function fetchSpectatorState(){
    if (!sb || !spectatorCode) return;
    var sentAt = Date.now();
    sb.rpc('get_session_view', { p_view_code: spectatorCode }).then(function(/** @type {any} */ res){
      if (!res || res.error){
        els.spectatorText.textContent = 'Ingen kontakt akkurat nå';
        return;
      }
      var row = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!row){
        els.spectatorText.textContent = 'Fant ikke kampen. Be om en ny lenke.';
        return;
      }
      noteServerTime(row.server_now, sentAt, Date.now());
      var incoming = normalizeState(row.data);
      if (!incoming) return;
      state = incoming;
      dropStaleSelection();
      els.spectatorText.textContent = 'Direkte: ' + homeName() + (state.opponentName ? ' mot ' + state.opponentName : '');
      renderAll();
    }).catch(function(){ els.spectatorText.textContent = 'Ingen kontakt akkurat nå'; });
  }

  /* ---------------- Kamprapport ---------------- */

  /** @param {HistoryMatchEntry} e @returns {string} */
  function buildReportText(e){
    var opponent = e.opponentName || e.opponentAbbr || 'motstanderen';
    var lines = [homeName() + ' ' + e.homeScore + '–' + e.awayScore + ' ' + opponent];
    var scorers = (e.goals || []).filter(function(g){ return g.team === 'home'; });
    if (scorers.length) lines.push('Mål: ' + scorers.map(function(g){ return firstName(g.scorerName) + ' (' + formatMs(g.matchMs) + ')'; }).join(', '));
    var players = (e.players || []).slice().sort(function(a, b){ return b.ms - a.ms; });
    if (players.length) lines.push('Spilletid: ' + players.map(function(p){ return firstName(p.name) + ' ' + formatCumulative(p.ms); }).join(', '));
    return lines.join('\n');
  }
  /** @param {HistoryMatchEntry} e @returns {Promise<File|null>} */
  function buildReportImage(e){
    return new Promise(function(resolve){
      try {
        var c = document.createElement('canvas');
        c.width = 1080;
        c.height = 1080;
        /** @type {any} */
        var g = c.getContext('2d');
        if (!g || !c.toBlob){ resolve(null); return; }
        var font = '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
        var bg = g.createLinearGradient(0, 0, 0, 1080);
        bg.addColorStop(0, '#16294a');
        bg.addColorStop(1, '#081120');
        g.fillStyle = bg;
        g.fillRect(0, 0, 1080, 1080);
        g.fillStyle = '#ffffff';
        g.textAlign = 'center';
        g.font = '600 48px ' + font;
        g.fillText(homeName() + ' mot ' + (e.opponentName || e.opponentAbbr || 'motstanderen'), 540, 170, 960);
        g.font = '700 220px ' + font;
        g.fillText(e.homeScore + ' – ' + e.awayScore, 540, 430);
        g.font = '500 40px ' + font;
        g.fillStyle = 'rgba(255,255,255,.72)';
        g.fillText(new Date(e.endedAt).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' }), 540, 510);
        var scorers = (e.goals || []).filter(function(x){ return x.team === 'home'; });
        g.fillStyle = '#ffffff';
        g.font = '500 44px ' + font;
        scorers.slice(0, 7).forEach(function(x, i){
          g.fillText(firstName(x.scorerName) + '  ' + formatMs(x.matchMs), 540, 620 + i * 62, 960);
        });
        c.toBlob(function(blob){
          resolve(blob ? new File([blob], 'kamprapport.png', { type: 'image/png' }) : null);
        }, 'image/png');
      } catch(err){ resolve(null); }
    });
  }
  /** @param {HTMLElement} btn */
  function shareMatchReport(btn){
    var entry = lastMatchSummary;
    if (!entry) return;
    var text = buildReportText(entry);
    buildReportImage(entry).then(function(file){
      shareOrCopy({ title: 'Kamprapport', text: text, file: file }, btn);
    });
  }

  /* ---------------- Sesongstatistikk ---------------- */

  /** @param {HistoryMatchEntry[]} list */
  function computeSeasonStats(list){
    /** @type {Object<string, {name:string, matches:number, ms:number, goals:number}>} */
    var byName = {};
    var wins = 0, draws = 0, losses = 0, gf = 0, ga = 0;
    list.forEach(function(m){
      if (m.homeScore > m.awayScore) wins++; else if (m.homeScore < m.awayScore) losses++; else draws++;
      gf += m.homeScore;
      ga += m.awayScore;
      (m.players || []).forEach(function(p){
        var key = p.name.trim().toLowerCase();
        if (!key) return;
        if (!byName[key]) byName[key] = { name: p.name, matches: 0, ms: 0, goals: 0 };
        if (p.ms > 0) byName[key].matches++;
        byName[key].ms += p.ms;
        byName[key].goals += p.goals || 0;
      });
    });
    var players = Object.keys(byName).map(function(k){ return byName[k]; }).sort(function(a, b){ return b.ms - a.ms; });
    return { players: players, matches: list.length, wins: wins, draws: draws, losses: losses, goalsFor: gf, goalsAgainst: ga };
  }
  var statsVisible = false;
  function renderSeasonStats(){
    var box = els.historyStats;
    var stats = computeSeasonStats(historyListCache);
    box.innerHTML = '<p class="stats-head">' + stats.matches + (stats.matches === 1 ? ' kamp' : ' kamper') + ': ' + stats.wins + ' seier, ' + stats.draws + ' uavgjort, ' + stats.losses + ' tap · mål ' + stats.goalsFor + '–' + stats.goalsAgainst + '</p>' +
      '<div class="stats-row stats-title"><span>Spiller</span><span>Kamper</span><span>Spilletid</span><span>Snitt</span><span>Mål</span></div>' +
      stats.players.map(function(p){
        return '<div class="stats-row"><span>' + escapeHtml(p.name) + '</span><span>' + p.matches + '</span><span>' + formatCumulative(p.ms) + '</span><span>' + formatCumulative(p.matches ? p.ms / p.matches : 0) + '</span><span>' + p.goals + '</span></div>';
      }).join('') +
      '<button type="button" id="statsExportBtn" class="add-player-row-btn">Eksporter som tabell</button>';
    qs('statsExportBtn').addEventListener('click', function(){
      var csv = ['Spiller;Kamper;Spilletid (min);Snitt (min);Mål'].concat(stats.players.map(function(p){
        return [p.name.replace(/;/g, ','), p.matches, (p.ms / 60000).toFixed(1).replace('.', ','), (p.matches ? p.ms / p.matches / 60000 : 0).toFixed(1).replace('.', ','), p.goals].join(';');
      })).join('\n');
      els.exportText.value = csv;
      els.exportModal.classList.add('open');
    });
  }

  /* ---------------- Design ---------------- */

  var DESIGN_KEY = 'spillerbytte_design_v1';
  var DESIGNS = [
    { id: 'a', name: 'Klassisk', desc: 'Slik appen har sett ut til nå.' },
    { id: 'b', name: 'Forfinet', desc: 'Samme uttrykk, strammere og mørkere gjennom hele appen.' },
    { id: 'c', name: 'Stadion', desc: 'Resultattavle øverst, ring rundt spillerne og knappene nederst.' },
    { id: 'd', name: 'Natt', desc: 'Svart og klart, med store tall og aktivitetsringer.' },
    { id: 'e', name: 'Oversikt', desc: 'Liste i stedet for bane: hvem som står for tur, med tiden som stolper.' }
  ];
  /** @returns {string} */
  function currentDesign(){
    try {
      var d = localStorage.getItem(DESIGN_KEY);
      if (DESIGNS.some(function(x){ return x.id === d; })) return /** @type {string} */ (d);
    } catch(e){}
    return 'a';
  }
  /** @param {string} id */
  function applyDesign(id){
    document.documentElement.setAttribute('data-design', id);
    try { localStorage.setItem(DESIGN_KEY, id); } catch(e){}
    renderDesignPicker();
    if (state && els.field){
      renderAll();
      renderPitchMarkings();
    }
  }
  function renderDesignPicker(){
    var box = qs('designPicker');
    if (!box) return;
    var active = currentDesign();
    box.innerHTML = DESIGNS.map(function(d){
      var on = d.id === active;
      return '<button type="button" role="radio" aria-checked="' + on + '" data-design-id="' + d.id + '" class="design-card' + (on ? ' on' : '') + '">' +
        '<span class="dp dp-' + d.id + '" aria-hidden="true"><i></i><i></i><i></i><b></b></span>' +
        '<span class="design-name">' + escapeHtml(d.name) + '</span>' +
      '</button>';
    }).join('');
    var cur = DESIGNS.filter(function(x){ return x.id === active; })[0];
    qs('designNote').textContent = cur ? cur.desc + ' Valget gjelder denne enheten.' : '';
  }
  function initDesignPicker(){
    qs('designPicker').addEventListener('click', function(e){
      var b = /** @type {HTMLElement} */ (e.target).closest('[data-design-id]');
      if (b) applyDesign(/** @type {HTMLElement} */ (b).dataset.designId || 'a');
    });
    renderDesignPicker();
  }

  /* ---------------- Hjemskjerm: rett inn i kampen ---------------- */

  function updateLauncherResume(){
    if (!els.launcherResumeBtn) return;
    var has = state.players.length > 0 && !spectatorCode;
    els.launcherResumeBtn.hidden = !has;
    if (has){
      els.launcherResumeSub.textContent = homeAbbr() + ' ' + teamGoalCount('home') + '–' + teamGoalCount('away') + (state.opponentAbbr ? ' ' + state.opponentAbbr : '') + ' · ' + formatMs(matchClockDisplayMs(nowTs()));
    }
  }

  function initMatchExtras(){
    els.undoToastBtn.addEventListener('click', function(){
      var action = toastAction;
      hideToast();
      if (action) action();
    });
    els.nextSwapBtn.addEventListener('click', function(){
      if (!canEdit() || multiMode) return;
      var next = computeNextSwap(nowTs());
      if (next) animateAndPerformSwap(next.fieldId, next.benchId);
    });
    els.planBtn.addEventListener('click', openPlanModal);
    qs('openPlanBtn').addEventListener('click', function(){ els.settingsModal.classList.remove('open'); openPlanModal(); });
    qs('planCloseBtn').addEventListener('click', function(){ els.planModal.classList.remove('open'); });
    qs('planEnabledToggle').addEventListener('change', function(e){
      if (!canEdit()) return;
      setShared({ planEnabled: e.target.checked });
      planCache = null;
      renderMatchPanels(nowTs());
    });
    qs('planKeeperBtn').addEventListener('click', function(e){
      putInGoal(e.target.dataset.id);
      renderPlanModal();
    });
    qs('openCupBtn').addEventListener('click', function(){ els.settingsModal.classList.remove('open'); openCupModal(); });
    qs('cupCloseBtn').addEventListener('click', function(){ els.cupModal.classList.remove('open'); });
    qs('cupAddBtn').addEventListener('click', function(){
      if (!canEdit()) return;
      saveCup({ name: state.cup ? state.cup.name : '', matches: cupMatches().concat([{ id: uid(), time: '', opponent: '' }]) });
      renderCupModal();
    });
    qs('cupNameInput').addEventListener('change', function(e){
      if (!canEdit()) return;
      saveCup({ name: e.target.value.trim(), matches: cupMatches() });
    });
    qs('openShareBtn').addEventListener('click', function(){ els.settingsModal.classList.remove('open'); openShareSheet(); });
    qs('shareCloseBtn').addEventListener('click', function(){ els.shareModal.classList.remove('open'); });
    els.matchSummaryShareBtn.addEventListener('click', function(){ shareMatchReport(els.matchSummaryShareBtn); });
    els.historyStatsBtn.addEventListener('click', function(){
      statsVisible = !statsVisible;
      els.historyStatsBtn.classList.toggle('active', statsVisible);
      els.historyStats.hidden = !statsVisible;
      els.historyList.hidden = statsVisible;
      if (statsVisible) renderSeasonStats();
    });
  }

  /* ---------------- Kampoppførsel: to-knapps-valg ---------------- */

  // Fire (tre i pre-kamp-innstillingene) valg mellom to likeverdige
  // alternativer - venstre = kun aktuell kamp, høyre = alle kamper i økten
  // (unntatt bytteforslag-innbytter, som er et eget valg: ventetid mot
  // minst spilletid). Hver `.choice-row[data-choice]` i index.html har én
  // skjult avkryssingsboks som tilstandsbærer: avkrysset = høyre knapp, så
  // all eksisterende kode som leser/skriver `.checked` og lytter på
  // 'change' virker uendret. `invert` snur det for «Bytt om», der lagret
  // reorgUsesLastMatch=true betyr VENSTRE («Kun forrige kamp») - slik at
  // lagrede innstillinger og Supabase-rader ikke trenger migrering.
  // The small symbols next to each title are the same ones the app uses on the
  // pitch (see the legend): the two rank triangles, the Forslag button and the
  // «Avslutt» button. They teach the symbols as a side effect of reading the
  // settings; styled quietly (see .sym* in style.css).
  var SYM = {
    tri: '<span class="sym" aria-hidden="true"><svg viewBox="0 0 14 14"><polygon points="7,2 12,12 2,12" fill="#dc2626" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>' +
         '<svg viewBox="0 0 14 14"><polygon points="2,2 12,2 7,12" fill="#2563eb" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg></span>',
    sugg: '<span class="sym-ico" aria-hidden="true">⇄<i>?</i></span>',
    endp: '<span class="sym-endp" aria-hidden="true">Avslutt</span>'
  };
  /** @type {Object<string, {title:string, sym:string, q:string, l:string, r:string, hl:string, hr:string, invert?:boolean}>} */
  var CHOICES = {
    rank: {
      title: 'Trekantsymboler', sym: SYM.tri, q: 'Rangering på spilletid',
      l: 'Kun denne kampen', r: 'Alle kamper i økten',
      hl: 'Trekantene viser spilletid i denne kampen.',
      hr: 'Trekantene viser spilletid over alle kamper i økten.'
    },
    reorg: {
      title: '«Bytt om» ved Kampslutt', sym: SYM.endp, q: 'Hvem settes opp først neste kamp',
      l: 'Kun forrige kamp', r: 'Alle kamper i økten',
      hl: 'De som spilte minst i forrige kamp settes på banen først.',
      hr: 'De som har spilt minst over alle kamper settes på banen først.',
      invert: true
    },
    basis: {
      title: 'Bytteforslag, utespiller', sym: SYM.sugg, q: 'Hvem foreslås ut',
      l: 'Mest spilt denne kampen', r: 'Mest spilt over alle kamper',
      hl: 'Foreslår den som har spilt mest i denne kampen.',
      hr: 'Foreslår den som har spilt mest over alle kamper.'
    },
    bench: {
      title: 'Bytteforslag, innbytter', sym: SYM.sugg, q: 'Hvem foreslås inn',
      l: 'Lengst ventetid siden forrige bytte', r: 'Minst spilletid denne kampen',
      hl: 'Den som har sittet lengst på benken siden forrige bytte kommer inn først. Ingen som ble byttet ut etter deg kommer inn før deg.',
      hr: 'Den med minst spilletid i kampen kommer inn først, også om hen nettopp ble byttet ut.'
    }
  };

  /** @type {Array<() => void>} */
  var choiceSyncs = [];
  var CHOICE_REDUCED_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Web Animations API (tekstbyttet): finnes i alle nåværende nettlesere, men en
  // manglende støtte skal aldri velte oppstarten - da byttes teksten bare direkte.
  var CHOICE_CAN_ANIMATE = typeof Element.prototype.animate === 'function' && typeof Element.prototype.getAnimations === 'function';
  /** @param {number} ms @returns {number} */
  function choiceMs(ms){ return CHOICE_REDUCED_MOTION ? 0 : ms; }

  // Felles begynnelse (minst to hele ord) står stille når hjelpeteksten
  // bytter - bare resten tones ut og inn. Beregnes ut fra tekstene selv, så
  // en senere tekstendring følger med uten at noe må oppdateres her.
  /** @param {string} a @param {string} b @returns {{pre:string, sufs:string[]}} */
  function splitCommonWords(a, b){
    var wa = a.split(' '), wb = b.split(' '), i = 0;
    while (i < wa.length - 1 && i < wb.length - 1 && wa[i] === wb[i]) i++;
    var pre = i >= 2 ? wa.slice(0, i).join(' ') + ' ' : '';
    return { pre: pre, sufs: [a.slice(pre.length), b.slice(pre.length)] };
  }

  /** @param {HTMLElement} row */
  function setupChoice(row){
    var cfg = CHOICES[row.dataset.choice || ''];
    var input = /** @type {HTMLInputElement} */ (row.querySelector('input'));
    if (!cfg || !input) return;
    var sp = splitCommonWords(cfg.hl, cfg.hr);
    row.insertAdjacentHTML('afterbegin',
      '<p class="choice-title">' + escapeHtml(cfg.title) + cfg.sym + '</p>' +
      '<p class="choice-q">' + escapeHtml(cfg.q) + '</p>' +
      '<div class="choice-seg" role="radiogroup" aria-label="' + escapeHtml(cfg.title) + '">' +
        '<div class="choice-thumb"><div class="choice-pill"></div></div>' +
        '<button type="button" role="radio" aria-checked="true" class="act">' + escapeHtml(cfg.l) + '</button>' +
        '<button type="button" role="radio" aria-checked="false">' + escapeHtml(cfg.r) + '</button>' +
      '</div>' +
      '<div class="choice-help" aria-live="polite">' +
        '<div class="choice-measure" aria-hidden="true"><span>' + escapeHtml(cfg.hl) + '</span><span>' + escapeHtml(cfg.hr) + '</span></div>' +
        '<div class="choice-live"><span class="choice-pre">' + escapeHtml(sp.pre) + '</span><span class="choice-suf">' + escapeHtml(sp.sufs[0]) + '</span></div>' +
      '</div>');
    var seg = /** @type {HTMLElement} */ (row.querySelector('.choice-seg'));
    var thumb = /** @type {HTMLElement} */ (row.querySelector('.choice-thumb'));
    var btns = seg.querySelectorAll('button');
    var sufEl = /** @type {HTMLElement} */ (row.querySelector('.choice-suf'));
    var value = 0;      // 0 = venstre, 1 = høyre
    var p = 0;          // markeringens posisjon 0..1 (mellomverdier under animasjon/drag)
    /** @type {{dead:boolean, raf:number}|null} */
    var anim = null;
    /** @type {{id:number, x0:number, moved:boolean, lastT:number, v:number}|null} */
    var drag = null;
    var helpToken = 0;

    function inputValue(){ return (cfg.invert ? !input.checked : input.checked) ? 1 : 0; }

    /** @param {number} pos */
    function paint(pos){
      thumb.style.transform = 'translateX(' + (pos * 100) + '%)';
      var right = pos > 0.5;
      btns[0].classList.toggle('act', !right);
      btns[1].classList.toggle('act', right);
    }
    function stop(){ if (anim){ anim.dead = true; cancelAnimationFrame(anim.raf); anim = null; } }

    // Rask, myk glidning (0,17 s, ease-out) - samme som godkjent i forslag A.
    /** @param {number} from @param {number} to */
    function run(from, to){
      stop();
      if (choiceMs(1) === 0 || from === to){ p = to; paint(p); return; }
      var a = { dead: false, raf: 0 };
      anim = a;
      var t0 = performance.now();
      /** @param {number} now */
      var frame = function(now){
        if (a.dead) return;
        var t = Math.min(1, (now - t0) / choiceMs(170));
        p = from + (to - from) * (1 - Math.pow(1 - t, 4));
        paint(p);
        if (t < 1){ a.raf = requestAnimationFrame(frame); } else { p = to; paint(to); anim = null; }
      };
      a.raf = requestAnimationFrame(frame);
    }

    // Bare den delen av setningen som faktisk er ulik animeres: gammel slutt
    // tones ut, ny tones inn (fill:'forwards' + cancel i samme tick, så den
    // gamle teksten aldri blinker tilbake et bilde).
    function swapHelp(){
      var my = ++helpToken, target = sp.sufs[value];
      if (!CHOICE_CAN_ANIMATE || choiceMs(1) === 0){ sufEl.textContent = target; return; }
      sufEl.getAnimations().forEach(function(x){ x.cancel(); });
      var cur = parseFloat(getComputedStyle(sufEl).opacity);
      var out = sufEl.animate([{ opacity: isNaN(cur) ? 1 : cur }, { opacity: 0 }], { duration: choiceMs(90), easing: 'ease-out', fill: 'forwards' });
      out.onfinish = function(){
        if (my !== helpToken) return;
        sufEl.textContent = target;
        out.cancel();
        sufEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: choiceMs(140), easing: 'ease-out' });
      };
    }
    /** @param {number} nv */
    function setValue(nv){
      if (nv === value) return;
      value = nv;
      btns[0].setAttribute('aria-checked', nv === 0 ? 'true' : 'false');
      btns[1].setAttribute('aria-checked', nv === 1 ? 'true' : 'false');
      swapHelp();
    }

    // Brukeren har valgt en side: skriv til tilstandsbæreren og la den
    // vanlige 'change'-lytteren gjøre jobben (lagre, eller - for en ikke-eier
    // - rette boksen tilbake). Står boksen annerledes etterpå, følger
    // knappene med den.
    /** @param {number} target */
    function choose(target){
      setValue(target);
      input.checked = cfg.invert ? !target : !!target;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      var actual = inputValue();
      if (actual !== target) setValue(actual);
      run(p, actual);
      updateChoiceFoldSummary();
    }

    // Hent tilstand fra avkrysningsboksen uten animasjon (kode har satt
    // .checked direkte, f.eks. når et vindu åpnes).
    function sync(){
      stop();
      value = inputValue();
      p = value;
      paint(p);
      btns[0].setAttribute('aria-checked', value === 0 ? 'true' : 'false');
      btns[1].setAttribute('aria-checked', value === 1 ? 'true' : 'false');
      if (CHOICE_CAN_ANIMATE) sufEl.getAnimations().forEach(function(x){ x.cancel(); });
      sufEl.textContent = sp.sufs[value];
    }
    choiceSyncs.push(sync);

    function geom(){ var r = seg.getBoundingClientRect(); return { r: r, W: (r.width - 8) / 2 }; }
    /** @param {number} x @returns {number} */
    function posFromX(x){ var g = geom(); return Math.max(0, Math.min(1, (x - g.r.left - 4 - g.W / 2) / g.W)); }

    seg.addEventListener('pointerdown', function(e){
      if (e.button) return;
      stop();
      drag = { id: e.pointerId, x0: e.clientX, moved: false, lastT: performance.now(), v: 0 };
      seg.classList.add('press');
      try { seg.setPointerCapture(e.pointerId); } catch (err) {}
    });
    seg.addEventListener('pointermove', function(e){
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x0) > 4) drag.moved = true;
      if (!drag.moved) return;
      var raw = posFromX(e.clientX), now = performance.now();
      var dt = Math.max(1, now - drag.lastT);
      drag.v = drag.v * 0.6 + ((raw - p) / (dt / 1000)) * 0.4;
      drag.lastT = now;
      p = raw;
      paint(p);
    });
    /** @param {PointerEvent} e */
    function release(e){
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag; drag = null;
      seg.classList.remove('press');
      try { seg.releasePointerCapture(e.pointerId); } catch (err) {}
      var target;
      if (d.moved){ target = (p + d.v * 0.12) > 0.5 ? 1 : 0; }
      else { var g = geom(); target = e.clientX < g.r.left + g.r.width / 2 ? 0 : 1; }
      choose(target);
    }
    seg.addEventListener('pointerup', release);
    seg.addEventListener('pointercancel', release);
    seg.addEventListener('keydown', function(e){
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      choose(e.key === 'ArrowLeft' ? 0 : 1);
    });
    Array.prototype.forEach.call(btns, function(b, i){
      b.addEventListener('click', function(e){ if (e.detail === 0) choose(i); }); // tastatur - berøring/mus går via pointer-hendelsene over
    });
    sync();
  }

  function initChoices(){
    Array.prototype.forEach.call(document.querySelectorAll('.choice-row[data-choice]'), setupChoice);
  }
  // Kall etter at kode har satt avkrysningsboksene direkte (åpning av
  // Innstillinger / pre-kamp-vinduet).
  function refreshChoices(){ choiceSyncs.forEach(function(f){ f(); }); updateChoiceFoldSummary(); }

  // The one-line status shown while the pre-kamp Kampoppførsel section is
  // folded: how many of its choices differ from the default (everything to the left).
  function updateChoiceFoldSummary(){
    if (!els.choiceFold || !els.choiceFoldSummary) return;
    var changed = 0;
    Array.prototype.forEach.call(els.choiceFold.querySelectorAll('.choice-row'), function(/** @type {HTMLElement} */ row){
      var cfg = CHOICES[row.dataset.choice || ''];
      var input = /** @type {HTMLInputElement|null} */ (row.querySelector('input'));
      if (cfg && input && (cfg.invert ? !input.checked : input.checked)) changed++;
    });
    els.choiceFoldSummary.textContent = changed === 0 ? 'Standard: alle valg til venstre' : changed + ' valg endret fra standard';
  }

  /* ---------------- Tallknapper (Kamptid / Byttetid) ---------------- */

  // Hele tall med to store knapper og tallet mellom, aldri tastatur. Holder du
  // en knapp inne, repeterer den (raskere etter hvert). `cfg.get/set` eier
  // verdien (en draft som lagres med OK/Lagre); refresh() tegner den på nytt
  // etter at koden har satt den utenfra.
  /**
   * @param {HTMLElement} host
   * @param {{label:string, unit:string, min:number, max:number, step?:number, get:() => number, set:(v:number) => void}} cfg
   * @returns {{refresh: () => void, setLocked: (locked: boolean) => void}}
   */
  function setupNumStep(host, cfg){
    host.className = 'numstep';
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', cfg.label);
    host.innerHTML = '<button type="button" data-d="-1" aria-label="Mindre">–</button>' +
      '<span class="numstep-val" aria-live="polite"><b></b><small>' + escapeHtml(cfg.unit) + '</small></span>' +
      '<button type="button" data-d="1" aria-label="Mer">+</button>';
    var valEl = /** @type {HTMLElement} */ (host.querySelector('b'));
    var btns = /** @type {NodeListOf<HTMLButtonElement>} */ (host.querySelectorAll('button'));
    var locked = false;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    var hold;
    /** @param {number} dir */
    function draw(dir){
      valEl.textContent = String(cfg.get());
      btns[0].disabled = locked || cfg.get() <= cfg.min;
      btns[1].disabled = locked || cfg.get() >= cfg.max;
      if (dir && CHOICE_CAN_ANIMATE && choiceMs(1)){
        valEl.animate([{ transform: 'translateY(' + (dir * 8) + 'px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
          { duration: choiceMs(140), easing: 'cubic-bezier(.2,.9,.3,1)' });
      }
    }
    /** @param {number} d @returns {boolean} */
    function step(d){
      if (locked) return false;
      var before = cfg.get(), next = Math.max(cfg.min, Math.min(cfg.max, before + d * (cfg.step || 1)));
      if (next === before) return false;
      cfg.set(next);
      draw(d);
      return true;
    }
    host.addEventListener('pointerdown', function(e){
      var b = /** @type {HTMLElement} */ (e.target).closest('button');
      if (!b || b.disabled) return;
      var d = parseInt(b.dataset.d || '0', 10);
      if (!step(d)) return;
      var n = 0;
      /** @param {number} delay */
      var loop = function(delay){
        hold = setTimeout(function(){
          if (!step(d)) return;
          n++;
          loop(n > 8 ? 40 : 85);
        }, delay);
      };
      loop(380);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function(t){ host.addEventListener(t, function(){ clearTimeout(hold); }); });
    host.addEventListener('click', function(e){
      if (e.detail !== 0) return; // berøring/mus går via pointerdown over - dette er tastatur
      var b = /** @type {HTMLElement} */ (e.target).closest('button');
      if (b && !b.disabled) step(parseInt(b.dataset.d || '0', 10));
    });
    draw(0);
    return {
      refresh: function(){ draw(0); },
      setLocked: function(l){ locked = l; draw(0); }
    };
  }

  // Bygger tallknappene og Kampformat-knappene i begge innstillingsvinduene.
  function initSettingsControls(){
    modalSteps.match = setupNumStep(els.matchDurationStep, {
      label: 'Kamptid', unit: 'min', min: 1, max: 180,
      get: function(){ return modalDraft.matchMin; },
      set: function(v){ modalDraft.matchMin = v; settingsDirty = true; applyMatchDurationSuggestion(); }
    });
    modalSteps.swap = setupNumStep(els.swapDurationStep, {
      label: 'Byttetid', unit: 'min', min: 1, max: 30,
      get: function(){ return modalDraft.swapMin; },
      set: function(v){ modalDraft.swapMin = v; settingsDirty = true; }
    });
    homeSteps.match = setupNumStep(els.settingsMatchDurationStep, {
      label: 'Kamptid', unit: 'min', min: 1, max: 180,
      get: function(){ return settingsDraftMatchDurationMin; },
      set: function(v){ settingsDraftMatchDurationMin = v; }
    });
    homeSteps.swap = setupNumStep(els.settingsSwapDurationStep, {
      label: 'Byttetid', unit: 'min', min: 1, max: 30,
      get: function(){ return settingsDraftSwapDurationMin; },
      set: function(v){ settingsDraftSwapDurationMin = v; }
    });
    manualSteps.match = setupNumStep(els.manualMinStep, {
      label: 'Minutter', unit: 'min', min: 0, max: 180,
      get: function(){ return Math.floor(manualSecs() / 60); },
      set: function(v){ setManualSecs(v * 60 + (manualSecs() % 60)); }
    });
    manualSteps.swap = setupNumStep(els.manualSecStep, {
      label: 'Sekunder', unit: 'sek', min: 0, max: 50, step: 10,
      get: function(){ return manualSecs() % 60; },
      set: function(v){ setManualSecs(Math.floor(manualSecs() / 60) * 60 + v); }
    });
    durationStep = setupNumStep(qs('durationPickerStep'), {
      label: 'Kamptid', unit: 'min', min: 1, max: 180,
      get: function(){ return durationPickerValue; },
      set: function(v){ durationPickerValue = v; }
    });
    [10, 15, 20, 25, 30, 40, 50, 60, 70, 90].forEach(function(min){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'duration-preset';
      b.textContent = String(min);
      b.addEventListener('click', function(){ durationPickerValue = min; durationStep.refresh(); });
      qs('durationPresets').appendChild(b);
    });
    qs('durationPickerSaveBtn').addEventListener('click', function(){
      els.matchDurationPickerModal.classList.remove('open');
      commitDurationPickerValue();
    });
    Array.prototype.forEach.call(els.fieldFormatSeg.children, function(/** @type {HTMLElement} */ btn){
      btn.addEventListener('click', function(){
        modalDraft.fieldSize = parseInt(btn.dataset.size || '3', 10);
        modalDraft.keeper = keeperDefaultFor(modalDraft.fieldSize, loadCoachDefaults().keeper);
        settingsDirty = true;
        updateModalFormatButtons();
        syncNameRows();
      });
    });
    Array.prototype.forEach.call(qs('keeperSeg').children, function(/** @type {HTMLElement} */ btn){
      btn.addEventListener('click', function(){
        modalDraft.keeper = btn.dataset.keeper === 'on';
        settingsDirty = true;
        updateModalFormatButtons();
      });
    });
    Array.prototype.forEach.call(qs('halvesSeg').children, function(/** @type {HTMLElement} */ btn){
      btn.addEventListener('click', function(){
        modalDraft.halves = btn.dataset.halves === '2' ? 2 : 1;
        settingsDirty = true;
        updateModalFormatButtons();
      });
    });
    els.choiceFoldBtn.addEventListener('click', function(){
      var open = els.choiceFold.dataset.open !== 'true';
      els.choiceFold.dataset.open = String(open);
      els.choiceFoldBtn.setAttribute('aria-expanded', String(open));
    });
  }

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
    els.settingsFieldFormat = qs('settingsFieldFormat');
    els.settingsDefaultRankCumulative = qs('settingsDefaultRankCumulative');
    els.settingsDefaultReorgLastMatch = qs('settingsDefaultReorgLastMatch');
    els.settingsDefaultSwapBasisCumulative = qs('settingsDefaultSwapBasisCumulative');
    els.settingsDefaultSwapBenchByPlaytime = qs('settingsDefaultSwapBenchByPlaytime');
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
    els.correctTimeRow = qs('correctTimeRow');
    els.removeDeadTimeBtn = qs('removeDeadTimeBtn');
    els.openCorrectTimeBtn = qs('openCorrectTimeBtn');
    els.rollBackBtn = qs('rollBackBtn');
    els.forgottenModal = qs('forgottenModal');
    els.forgottenTitle = qs('forgottenTitle');
    els.forgottenInfo = qs('forgottenInfo');
    els.forgottenPreview = qs('forgottenPreview');
    els.forgottenResetBtn = qs('forgottenResetBtn');
    els.forgottenContinueBtn = qs('forgottenContinueBtn');
    els.forgottenManualBtn = qs('forgottenManualBtn');
    els.manualClockModal = qs('manualClockModal');
    els.manualClockCloseBtn = qs('manualClockCloseBtn');
    els.manualClockTabs = qs('manualClockTabs');
    els.manualMinLabel = qs('manualMinLabel');
    els.manualSecLabel = qs('manualSecLabel');
    els.manualMinStep = qs('manualMinStep');
    els.manualSecStep = qs('manualSecStep');
    els.manualClockPreview = qs('manualClockPreview');
    els.manualClockCancelBtn = qs('manualClockCancelBtn');
    els.manualClockApplyBtn = qs('manualClockApplyBtn');
    els.clockHint = qs('clockHint');
    els.removeDeadTimeConfirmModal = qs('removeDeadTimeConfirmModal');
    els.removeDeadTimeConfirmText = qs('removeDeadTimeConfirmText');
    els.removeDeadTimeCancelBtn = qs('removeDeadTimeCancelBtn');
    els.removeDeadTimeConfirmBtn = qs('removeDeadTimeConfirmBtn');
    els.leaveMatchBtn = qs('leaveMatchBtn');
    els.closeSessionRow = qs('closeSessionRow');
    els.closeSessionBtn = qs('closeSessionBtn');
    els.closeSessionConfirmModal = qs('closeSessionConfirmModal');
    els.closeSessionConfirmText = qs('closeSessionConfirmText');
    els.closeSessionCancelBtn = qs('closeSessionCancelBtn');
    els.closeSessionConfirmBtn = qs('closeSessionConfirmBtn');
    els.nameRows = qs('nameRows');
    els.addPlayerRowBtn = qs('addPlayerRowBtn');
    els.matchDurationRow = qs('matchDurationRow');
    els.fieldFormatRow = qs('fieldFormatRow');
    els.fieldFormatSeg = qs('fieldFormatSeg');
    els.matchDurationStep = qs('matchDurationStep');
    els.swapDurationStep = qs('swapDurationStep');
    els.settingsMatchDurationStep = qs('settingsMatchDurationStep');
    els.settingsSwapDurationStep = qs('settingsSwapDurationStep');
    els.choiceGroup = qs('choiceGroup');
    els.choiceFold = qs('choiceFold');
    els.choiceFoldBtn = qs('choiceFoldBtn');
    els.choiceFoldSummary = qs('choiceFoldSummary');
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
    els.matchHistorySummary = qs('cupPlayed');
    ['endSheetTitle','endSheetScore','endSheetMeta','endSheetGoals','endSheetKeeper','endChoices','endSaveToggle','endReorgToggle','endNextOpponent',
     'matchSummaryTimeline','matchSummaryTimelineTitle','matchSummaryShareBtn','undoToast','undoToastText','undoToastBtn','spectatorBar','spectatorText',
     'nextSwapBar','nextSwapLabel','nextSwapNames','nextSwapBtn','fairnessLine','planBtn','launcherResumeBtn','launcherResumeSub','shareModal','planModal','cupModal',
     'historyStatsBtn','historyStats'].forEach(function(id){ els[id] = qs(id); });
    els.endMatchCancelBtn = qs('endMatchCancelBtn');
    els.endPeriodBtn = qs('endPeriodBtn');
    els.endPeriodWrap = qs('endPeriodWrap');
    els.endPeriodInfoBtn = qs('endPeriodInfoBtn');
    els.endResetBtn = qs('endResetBtn');
    els.endResetWrap = qs('endResetWrap');
    els.endResetInfoBtn = qs('endResetInfoBtn');
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
    els.matchSummaryHistoryNote = qs('matchSummaryHistoryNote');
    els.matchSummaryCloseBtn = qs('matchSummaryCloseBtn');
    els.multiSelectBtn = qs('multiSelectBtn');
    els.multiSelectBtnLabel = qs('multiSelectBtnLabel');
    els.multiSelectCancelBtn = qs('multiSelectCancelBtn');
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
    els.settingsWakeLockToggle = qs('settingsWakeLockToggle');
    els.exportBtn = qs('exportBtn');
    els.exportModal = qs('exportModal');
    els.exportText = qs('exportText');
    els.exportCloseBtn = qs('exportCloseBtn');
    els.exportCopyBtn = qs('exportCopyBtn');
    els.legendBtn = qs('legendBtn');
    els.settingsLegendBtn = qs('settingsLegendBtn');
    els.legendModal = qs('legendModal');
    els.legendCloseBtn = qs('legendCloseBtn');
    els.infoPopupModal = qs('infoPopupModal');
    els.infoPopupTitle = qs('infoPopupTitle');
    els.infoPopupText = qs('infoPopupText');
    els.infoPopupCloseBtn = qs('infoPopupCloseBtn');
    els.matchDurationPickerModal = qs('matchDurationPickerModal');
    els.durationPickerCloseBtn = qs('durationPickerCloseBtn');
    els.sessionCodeBar = qs('sessionCodeBar');
    els.sessionCodeText = qs('sessionCodeText');
    els.autoPauseNotice = qs('autoPauseNotice');
    els.dropHint = qs('dropHint');
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
    els.swapSuggestionBasisToggle = qs('swapSuggestionBasisToggle');
    els.swapSuggestionBenchModeToggle = qs('swapSuggestionBenchModeToggle');
    els.reorgLastMatchToggle = qs('reorgLastMatchToggle');
    els.joinExistingBtn = qs('joinExistingBtn');
    els.joinConfirmModal = qs('joinConfirmModal');
    els.joinConfirmText = qs('joinConfirmText');
    els.joinConfirmCancelBtn = qs('joinConfirmCancelBtn');
    els.joinConfirmYesBtn = qs('joinConfirmYesBtn');
    els.joinCodeModal = qs('joinCodeModal');
    els.joinCodeInput = qs('joinCodeInput');
    els.joinCodeInputWrap = qs('joinCodeInputWrap');
    els.joinCodeError = qs('joinCodeError');
    els.joinCodeCancelBtn = qs('joinCodeCancelBtn');
    els.joinCodeConfirmBtn = qs('joinCodeConfirmBtn');
    els.launcherVersionBtn = qs('launcherVersionBtn');
    els.launcherVersionBtn.textContent = 'v' + APP_VERSION.split('.').slice(0, 2).join('.');
    els.versionHistoryModal = qs('versionHistoryModal');
    els.versionHistoryList = qs('versionHistoryList');
    els.versionHistoryCloseBtn = qs('versionHistoryCloseBtn');
    els.launcherVersionBtn.addEventListener('click', function(){
      qs('checkUpdateNote').textContent = 'Du har versjon ' + APP_VERSION + '.';
      els.versionHistoryList.innerHTML = VERSION_HISTORY.map(function(entry){
        return '<div class="version-history-entry">' +
          '<p class="version-history-entry-version">v' + escapeHtml(entry.version) + '</p>' +
          '<p class="version-history-entry-text">' + escapeHtml(entry.text) + '</p>' +
        '</div>';
      }).join('');
      els.versionHistoryModal.classList.add('open');
    });
    qs('checkUpdateBtn').addEventListener('click', checkForUpdateNow);
    els.versionHistoryCloseBtn.addEventListener('click', function(){
      els.versionHistoryModal.classList.remove('open');
    });
    els.syncDot = qs('syncDot');

    networkOnline = navigator.onLine;
    window.addEventListener('online', function(){
      networkOnline = true;
      updateSessionCodeUI();
      reconcileWithServer(); // catches up in whichever direction is behind - see subscribeToSession
      flushHistoryQueue();
    });
    window.addEventListener('offline', function(){
      networkOnline = false;
      updateSessionCodeUI();
    });

    initSettingsControls();
    initChoices();

    state = loadState();
    roster = loadRoster();
    initAppUpdates();

    // Assigned here (not at module scope, where els.* don't exist yet) but
    // still module-scope vars - openSettings() (defined outside init())
    // calls transferOwnerConfirm.disarm() every render, and this runs
    // before any code path that could call openSettings() during startup
    // (the empty-roster bootstrap near the end of init()).
    avsluttConfirm = createConfirmArm({
      armedEls: [els.endResetWrap],
      labelEl: els.endResetBtn,
      restingLabel: 'Avslutt økten',
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
    els.addPlayerRowBtn.addEventListener('click', function(){
      addNameRow(null, '', els.nameRows.querySelectorAll('.name-row').length + 1, false, true);
    });
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
      // Glemt kampslutt? Spør først (klokka stilles tilbake før noe arkiveres/avsluttes), og fortsett så til vanlig Avslutt.
      if (canEdit() && state.players.length > 0 && forgottenMatchInfo(nowTs())){
        openForgottenSheet({ auto: true, thenEnd: true });
        return;
      }
      openEndSheet();
    });
    els.endMatchCancelBtn.addEventListener('click', function(){
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
      var save = els.endSaveToggle.checked, reorg = els.endReorgToggle.checked;
      var nextName = els.endNextOpponent.value.trim();
      var next = nextName ? { name: nextName, abbr: deriveAbbrFromName(nextName) } : undefined;
      saveEndPrefs();
      avsluttConfirm.disarm();
      els.endMatchModal.classList.remove('open');
      var ended = function(){
        showToast('Kampen er avsluttet', 'Se rapport', function(){ showMatchSummaryThen(); }, 8000);
      };
      if (reorg){
        animateReorganization(function(){
          endMatchPeriod(true, save, next);
          ended();
        });
      } else {
        endMatchPeriod(false, save, next);
        renderAll();
        ended();
      }
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
          rollBackToMatchEnd();
          archiveInProgressMatch(saveToHistory);
          resetMatch();
          showMatchSummaryThen();
        });
      } else if (kind === 'endPeriod'){
        askSaveToHistory(function(saveToHistory){
          rollBackToMatchEnd();
          endMatchPeriod(false, saveToHistory);
          renderAll();
          showMatchSummaryThen();
        });
      }
    });
    els.endResetBtn.addEventListener('click', function(){
      if (!isMaster()) return;
      if (!avsluttConfirm.press()) return; // just armed - wait for the second press
      els.endMatchModal.classList.remove('open');
      saveEndPrefs();
      archiveInProgressMatch(els.endSaveToggle.checked);
      resetMatch();
      // resetMatch() itself opens settings (the same first-run flow "Ny
      // økt" relies on, to set up a fresh roster right away) - this instead
      // goes back to the home screen, since they're mid-match here and more
      // likely to want a clean slate than to fill in a new roster immediately.
      els.settingsModal.classList.remove('open');
      showMatchSummaryThen(showLauncherMenu);
    });
    els.multiSelectBtn.addEventListener('click', onMultiSelectBtnClick);
    els.multiSelectCancelBtn.addEventListener('click', cancelMultiSelect);
    els.settingsWakeLockToggle.addEventListener('change', function(){ setWakeLockWanted(els.settingsWakeLockToggle.checked); });
    els.exportBtn.addEventListener('click', function(){
      els.exportText.value = buildExportText();
      els.exportModal.classList.add('open');
    });
    els.removeDeadTimeBtn.addEventListener('click', function(){
      if (!isMaster()) return;
      var ms = deadTimeSinceLastPlay(nowTs());
      if (ms < 1000) return; // button is hidden well before this in practice - just a safety guard
      els.removeDeadTimeConfirmText.textContent =
        'Fjerner ' + formatCumulative(ms) + ' fra kampklokka og fra spillerne som er aktive akkurat nå (tiden klokka har gått siden siste bytte, mål e.l.).';
      els.removeDeadTimeConfirmModal.classList.add('open');
    });
    els.removeDeadTimeCancelBtn.addEventListener('click', function(){
      els.removeDeadTimeConfirmModal.classList.remove('open');
    });
    els.removeDeadTimeConfirmBtn.addEventListener('click', function(){
      els.removeDeadTimeConfirmModal.classList.remove('open');
      if (!isMaster()) return;
      // Re-read now, right before applying - the confirm modal may have sat
      // open for a while, and the amount should reflect the actual gap at
      // the moment of the tap, not whatever it measured when the modal opened.
      subtractDeadTime(deadTimeSinceLastPlay(nowTs()));
      els.removeDeadTimeBtn.hidden = true;
    });
    els.rollBackBtn.addEventListener('click', function(){
      if (!isMaster() || matchOvertimeMs() <= 0) return;
      els.settingsModal.classList.remove('open');
      openForgottenSheet({ auto: false, thenEnd: false });
    });
    els.openCorrectTimeBtn.addEventListener('click', function(){
      if (!isMaster()) return;
      els.settingsModal.classList.remove('open');
      openManualClock('sub');
    });
    els.manualClockCloseBtn.addEventListener('click', function(){ els.manualClockModal.classList.remove('open'); });
    els.manualClockCancelBtn.addEventListener('click', function(){ els.manualClockModal.classList.remove('open'); });
    els.manualClockApplyBtn.addEventListener('click', applyManualClock);
    els.manualClockTabs.addEventListener('click', function(e){
      var b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('.segmented-btn'));
      if (!b || !b.dataset.tab) return;
      manual.tab = b.dataset.tab;
      updateManualClockUI();
    });
    els.forgottenResetBtn.addEventListener('click', forgottenReset);
    els.forgottenContinueBtn.addEventListener('click', forgottenContinue);
    els.forgottenManualBtn.addEventListener('click', function(){
      var thenEnd = forgottenCtx.thenEnd;
      closeForgottenSheet();
      openManualClock('sub', thenEnd);
    });
    // Overtidsklokka under hovedklokka er trykkbar når det er noe å stille tilbake.
    els.matchCountdown.addEventListener('click', function(){
      if (forgottenOpen || !canEdit() || matchOvertimeMs() <= 0) return;
      openForgottenSheet({ auto: false, thenEnd: false });
    });
    els.exportCloseBtn.addEventListener('click', function(){ els.exportModal.classList.remove('open'); });
    initMatchExtras();
    els.legendBtn.addEventListener('click', function(){ els.legendModal.classList.add('open'); });
    els.settingsLegendBtn.addEventListener('click', function(){ els.legendModal.classList.add('open'); });
    els.legendCloseBtn.addEventListener('click', function(){ els.legendModal.classList.remove('open'); });
    // Avslutt økten repurposes its info-btn as a cancel "×" while armed -
    // this map lets the one generic click handler below know, by the
    // button's own id, to disarm instead of opening the info popup.
    var infoBtnConfirmArms = {
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
          if (code){
            qs('openShareBtn').hidden = false;
            openShareSheet();
          }
        });
      } else {
        handOffOwnershipIfOwner();
        leaveSession();
      }
      updateShareModeUI();
    });
    els.shareModeSegmented.addEventListener('click', function(e){
      if (!isMaster()) return;
      var btn = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('.segmented-btn'));
      if (!btn) return;
      setShared({ shareEditable: btn.dataset.mode !== 'read' });
      updateShareModeUI();
      updateSessionCodeUI();
    });
    els.reorgLastMatchToggle.addEventListener('change', function(){
      if (!isMaster()){ els.reorgLastMatchToggle.checked = !!state.reorgUsesLastMatch; return; }
      setShared({ reorgUsesLastMatch: els.reorgLastMatchToggle.checked });
    });
    els.rankByCumulativeToggle.addEventListener('change', function(){
      if (!isMaster()){ els.rankByCumulativeToggle.checked = !!state.rankByCumulative; return; }
      setShared({ rankByCumulative: els.rankByCumulativeToggle.checked });
      renderAll();
    });
    els.swapSuggestionBasisToggle.addEventListener('change', function(){
      if (!isMaster()){ els.swapSuggestionBasisToggle.checked = state.swapSuggestionBasis === 'cumulative'; return; }
      setShared({ swapSuggestionBasis: els.swapSuggestionBasisToggle.checked ? 'cumulative' : 'match' });
    });
    els.swapSuggestionBenchModeToggle.addEventListener('change', function(){
      if (!isMaster()){ els.swapSuggestionBenchModeToggle.checked = state.swapSuggestionBenchMode === 'cumulative'; return; }
      setShared({ swapSuggestionBenchMode: els.swapSuggestionBenchModeToggle.checked ? 'cumulative' : 'waited' });
    });
    els.transferOwnerBtn.addEventListener('click', function(){
      if (!isMaster()) return;
      var target = longestTenuredOtherParticipant();
      if (!target){ shakeElement(els.transferOwnerBtn); return; }
      if (!transferOwnerConfirm.press()) return; // just armed - wait for the second press
      setShared({ sessionOwnerDeviceId: target.deviceId });
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
      handOffOwnershipIfOwner();
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
      var code = els.joinCodeInput.value.trim().toUpperCase();
      if (!isValidSessionCode(code)){
        els.joinCodeError.textContent = 'Skriv inn en gyldig kode.';
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
      }, function(){
        els.joinCodeError.textContent = 'Fikk ikke kontakt med databasen. Sjekk nettet og prøv igjen.';
        els.joinCodeError.style.display = '';
        shakeElement(els.joinCodeModal.querySelector('.modal-card'));
        els.joinCodeInput.value = '';
      });
    }
    els.joinConfirmCancelBtn.addEventListener('click', function(){
      els.joinConfirmModal.classList.remove('open');
      pendingJoinFinish = null;
      els.joinCodeInput.value = '';
      els.launcherJoinInput.value = '';
    });
    els.joinConfirmYesBtn.addEventListener('click', function(){
      els.joinConfirmModal.classList.remove('open');
      var finish = pendingJoinFinish;
      pendingJoinFinish = null;
      if (finish) finish();
    });
    els.joinCodeInput.addEventListener('input', function(){
      els.joinCodeError.style.display = 'none';
      clearFieldInvalid(els.joinCodeInputWrap);
      // Auto-advance the moment the 3rd digit lands - a 3-digit code has
      // nothing left to type, so waiting for an explicit OK tap is just an
      // extra step. Only real 3-digit input triggers this (not e.g. a
      // paste that already failed the regex elsewhere).
      if (isValidSessionCode(els.joinCodeInput.value.trim().toUpperCase())) attemptJoinCode();
    });
    els.joinCodeConfirmBtn.addEventListener('click', attemptJoinCode);
    els.sessionCodeBar.addEventListener('click', function(){
      if (sessionCode) openShareSheet();
    });

    // Unlock audio on any tap anywhere, not just Play/Pause - a device that
    // joins a session already running (and only ever drags/taps players to swap)
    // would otherwise never get an unlocked AudioContext and silently never beep
    // on time-up. touchend/click, not pointerdown: iOS doesn't count pointerdown
    // as a gesture that may start audio. And every time, not once: iOS suspends
    // the context again after a screen lock. Cheap, since it does nothing while
    // the context is running.
    document.addEventListener('touchend', ensureAudioUnlocked, true);
    document.addEventListener('click', ensureAudioUnlocked, true);

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
      var code = els.launcherJoinInput.value.trim().toUpperCase();
      if (!isValidSessionCode(code)){
        els.launcherJoinError.textContent = 'Skriv inn en gyldig kode.';
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
      }, function(){
        els.launcherJoinError.textContent = 'Fikk ikke kontakt med databasen. Sjekk nettet og prøv igjen.';
        els.launcherJoinError.hidden = false;
        shakeElement(els.launcherChoiceOverlay);
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
      // Only at the point of no return: the first of two presses just asks
      // "Er du sikker?", and backing out of that must not have left the session.
      var leaveIfGuest = function(){ if (!isMaster() && sessionCode) leaveSession(); };
      if (state.players.length === 0){
        leaveIfGuest();
        enterAppFromLauncher();
        openSettings(true);
        return;
      }
      if (!state.globalRunning && matchClockElapsed(nowTs()) === 0){
        // A team exists but the match clock has never run - nothing about
        // an actual match to lose, so skip the confirm-shake below (same
        // reasoning as the empty-roster case above).
        newSessionConfirm.disarm();
        leaveIfGuest();
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
        leaveIfGuest();
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
      if (isValidSessionCode(els.launcherJoinInput.value.trim().toUpperCase())) submitLauncherJoin();
    });
    els.launcherJoinInput.addEventListener('keydown', function(e){
      if (e.key === 'Enter') submitLauncherJoin();
    });
    els.launcherJoinEnterBtn.addEventListener('click', submitLauncherJoin);

    els.launcherResumeBtn.addEventListener('click', enterAppFromLauncher);

    initCoinFlip();
    initAccountAndSettings();
    initDesignPicker();

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
    updateSessionCodeUI(); // also without a Supabase client: the code bar then says it isn't synced
    if (sessionCode){
      try {
        var savedOps = JSON.parse(localStorage.getItem(PENDING_OPS_KEY) || '[]');
        if (Array.isArray(savedOps) && savedOps.length > 0){ pendingOps = savedOps; remoteDirty = true; }
      } catch(e){}
    }

    function stampLastAlive(){
      if (spectatorCode) return;
      try { localStorage.setItem(LAST_ALIVE_KEY, String(Date.now())); } catch(e){}
    }

    // While the checks below wait for the server, the heartbeat must not overwrite
    // the "last alive" stamp they need in order to see how long the app was away.
    var resumeChecksPending = false;

    function finishStartup(){
      checkIdleAutoPause(); // covers "app was fully closed and reopened after a long gap"
      if (!checkForgottenMatch()) checkLongIdleSuggestion();
      stampLastAlive();
      // Only the running clock needs the 250ms tick - while paused, every
      // value is frozen, and any real change already calls renderAll() ->
      // updateTimersOnly() directly.
      setInterval(function(){ if (state.globalRunning) updateTimersOnly(); }, 250);
      setInterval(forgottenTick, 1000);
      // Local-only: this used to call saveState() (which also pushes to
      // Supabase) unconditionally every 8s. In a shared session that's a
      // last-write-wins race waiting to happen - if this fires on one
      // device just after another device pushed a real edit (a goal, a
      // substitution) but before the realtime update for it has arrived
      // locally, this device's still-stale `state` overwrites that edit
      // on the server, which then broadcasts the stale state back out and
      // makes the edit vanish everywhere. Every real mutation already
      // calls saveState() itself right after changing `state`, so this
      // heartbeat only needs to keep localStorage/LAST_ALIVE_KEY fresh. It also
      // retries a write that didn't get through (remoteDirty), without any new rev.
      setInterval(function(){
        saveStateLocally();
        if (!resumeChecksPending) stampLastAlive();
        if (networkOnline){
          if (sessionCode && !sessionVerified) reconcileWithServer(); // the first comparison hasn't got through yet
          flushRemoteIfDirty();
        }
      }, 8000);
      document.addEventListener('visibilitychange', function(){
        if (document.hidden){
          if (activeDragCancel) activeDragCancel(); // the finger is gone by the time the app is back
          saveStateLocally();
          flushRemoteIfDirty();
        } else {
          updateTimersOnly();
          requestWakeLock();
          flushHistoryQueue();
          // After the server has answered: the idle checks judge "has anything
          // happened?" from state, and this device may have slept through a match.
          resumeChecksPending = true;
          afterSessionSync(function(){
            resumeChecksPending = false;
            checkIdleAutoPause(); // covers "tab/app was backgrounded for a long gap, then resumed"
            if (!checkForgottenMatch()) checkLongIdleSuggestion();
            stampLastAlive();
            updateTimersOnly();
          });
        }
      });
      flushHistoryQueue();
      // The ping is a courtesy: a phone that missed it catches up here. More often when the channel is down.
      setInterval(function(){
        if (document.hidden || !networkOnline || !sessionCode) return;
        if (Date.now() - lastReconcileAt >= (realtimeSubscribed ? 30000 : 10000)) reconcileWithServer();
      }, 10000);
    }

    // Foreldrelenke: bare visning, ingen økt på denne enheten. Medtrenerlenke: vanlig bli-med.
    var launchParams = new URLSearchParams(location.search);
    var viewParam = (launchParams.get('se') || '').toUpperCase();
    var joinParam = (launchParams.get('okt') || '').toUpperCase();
    if (viewParam && sb){
      sessionCode = null;
      finishStartup();
      startSpectator(viewParam);
      return;
    }
    updateLauncherResume();
    if (joinParam && isValidSessionCode(joinParam)){
      try { history.replaceState(null, '', location.pathname); } catch(e){}
      setTimeout(function(){
        if (sessionCode === joinParam){ enterAppFromLauncher(); return; }
        openLauncherChoice();
        showLauncherJoinPanel();
        els.launcherJoinInput.value = joinParam;
        submitLauncherJoin();
        // En lenke åpner nettleseren, som har et annet lager enn appen på hjemskjermen.
        if (!isStandalone()) showToast('Har du appen på hjemskjermen? Skriv koden ' + joinParam + ' der i stedet.', null, null, 9000);
      }, 300);
    }

    // The local match is drawn right away. With poor coverage at the pitch the
    // server may take a minute to answer, and the coach can't wait for that with
    // an empty field: the server's copy replaces it if it turns out to be newer.
    if (state.players.length > 0) renderAll();
    if (sessionCode && sb){
      subscribeToSession(sessionCode);
      afterSessionSync(function(){
        if (state.players.length === 0){ if (canEdit()) openSettings(true); else renderAll(); }
        finishStartup();
      });
    } else if (state.players.length === 0){
      openSettings(true);
      finishStartup();
    } else {
      finishStartup();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
