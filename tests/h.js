// Harness: laster den ekte appen i jsdom med en mock-Supabase som faktisk
// respekterer filtre (eq/lte/lt/in) og to enheter mot samme "database".
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const ROOT = process.env.APP_ROOT || path.resolve(__dirname, '..');

function getPath(row, col) {
  const m = col.match(/^(\w+)->(\w+)$/);
  if (m) { const o = row[m[1]]; return o && typeof o === 'object' ? o[m[2]] : undefined; }
  return row[col];
}

function makeBackend() {
  const be = { hasRpc: process.env.HAS_RPC !== '0', tables: { sessions: {}, match_history: {}, team_settings: {}, admins: {} }, clients: [], writes: 0, log: [] };
  be.insertSession = (code, data, origin) => { be.tables.sessions[code] = { code, data: JSON.parse(JSON.stringify(data)), origin: origin || 'seed', updated_at: new Date().toISOString() }; };
  be.broadcast = (row) => {
    be.clients.forEach(c => c.channels.forEach(ch => {
      if (c.offline || c.realtimeDown || ch.filterCode !== row.code || !ch.subscribed) return;
      if (ch.pgCb) ch.pgCb({ new: JSON.parse(JSON.stringify(row)) });
      if (ch.brCb && be.hasRpc) ch.brCb({ payload: { rev: row.data && row.data.rev, origin: row.origin } });
    }));
  };
  return be;
}

function makeClient(be, opts) {
  opts = opts || {};
  const client = { channels: [], offline: false, realtimeDown: false, hang: false, auth: null, authCb: null };
  be.clients.push(client);
  const ok = (data) => ({ data, error: null, count: null, status: 200 });
  const netErr = () => ({ data: null, error: { message: 'Failed to fetch', code: '' }, status: 0 });
  function builder(table) {
    const b = { op: 'select', filters: [], wantRows: false, single: false, payload: null, onConflict: null };
    const t = () => be.tables[table];
    const match = (row) => b.filters.every(f => {
      const v = getPath(row, f.col);
      if (f.op === 'eq') return String(v) === String(f.val);
      if (f.op === 'in') return f.val.map(String).includes(String(v));
      if (typeof v !== 'number') return false; // NULL i SQL
      if (f.op === 'lte') return v <= f.val;
      if (f.op === 'lt') return v < f.val;
      if (f.op === 'gte') return v >= f.val;
      return false;
    });
    const run = () => {
      if (client.offline) return netErr();
      if (opts.tableError && opts.tableError[table]) return { data: null, error: { message: opts.tableError[table], code: 'PGRST' } };
      const rows = Object.values(t());
      if (b.op === 'select') {
        let out = rows.filter(match);
        if (b.orderCol) out = out.slice();
        out = JSON.parse(JSON.stringify(out));
        if (b.single) return ok(out[0] || null);
        return ok(out);
      }
      if (b.op === 'insert') {
        const row = JSON.parse(JSON.stringify(b.payload));
        const key = table === 'sessions' ? row.code : (row.id || ('h' + Math.random()));
        if (t()[key]) return { data: null, error: { message: 'duplicate key', code: '23505' } };
        if (table === 'match_history' && !row.id) row.id = key;
        t()[key] = row;
        be.writes++; be.log.push(['insert', table, key]);
        return ok(b.wantRows ? [row] : null);
      }
      if (b.op === 'update') {
        const hit = rows.filter(match);
        hit.forEach(r => { Object.assign(r, JSON.parse(JSON.stringify(b.payload))); be.writes++; be.log.push(['update', table, r.code, r.data && r.data.rev]); });
        if (table === 'sessions') hit.forEach(r => be.broadcast(r));
        return ok(b.wantRows ? JSON.parse(JSON.stringify(hit)) : null);
      }
      if (b.op === 'upsert') {
        const row = JSON.parse(JSON.stringify(b.payload));
        t()[row.user_id] = Object.assign(t()[row.user_id] || {}, row);
        be.writes++; be.log.push(['upsert', table, row.user_id, row.home_team_name]);
        return ok(null);
      }
      if (b.op === 'delete') {
        rows.filter(match).forEach(r => { delete t()[r.id || r.code]; });
        return ok(null);
      }
      return ok(null);
    };
    Object.assign(b, {
      select(cols) { if (b.op === 'select') { b.cols = cols; } else { b.wantRows = true; } return b; },
      insert(p) { b.op = 'insert'; b.payload = JSON.parse(JSON.stringify(p)); return b; },
      update(p) { b.op = 'update'; b.payload = JSON.parse(JSON.stringify(p)); return b; },
      upsert(p) { b.op = 'upsert'; b.payload = p; return b; },
      delete() { b.op = 'delete'; return b; },
      eq(col, val) { b.filters.push({ op: 'eq', col, val }); return b; },
      lte(col, val) { b.filters.push({ op: 'lte', col, val }); return b; },
      lt(col, val) { b.filters.push({ op: 'lt', col, val }); return b; },
      gte(col, val) { b.filters.push({ op: 'gte', col, val }); return b; },
      in(col, val) { b.filters.push({ op: 'in', col, val }); return b; },
      order(col) { b.orderCol = col; return b; },
      maybeSingle() { b.single = true; return b; },
      then(res, rej) {
        if (client.hang) return new Promise(() => {}).then(res, rej);
        if (client.slowNextGet && b.op === 'select' && table === 'sessions') {
          const ms = client.slowNextGet; client.slowNextGet = 0;
          const captured = run(); // svaret er det raden var da forespørselen ble sendt
          return new Promise(r => setTimeout(() => r(captured), ms)).then(res, rej);
        }
        return new Promise(r => setTimeout(() => r(run()), opts.latency || 0)).then(res, rej);
      },
      catch(rej) { return b.then(x => x, rej); }
    });
    return b;
  }
  const srvNow = () => new Date(client.trueNow ? client.trueNow() : Date.now()).toISOString();
  const srev = (d) => (d && typeof d.rev === 'number') ? d.rev : -1;
  function rpcRun(name, p) {
    if (client.offline) return netErr();
    if (!be.hasRpc) return { data: null, error: { code: 'PGRST202', message: 'not found' }, status: 404 };
    const T = be.tables.sessions;
    const copy = (x) => JSON.parse(JSON.stringify(x));
    if (name === 'get_session') {
      const r = T[p.p_code];
      if (r && !r.view_code) r.view_code = 'VIEW' + p.p_code;
      return ok(r ? [Object.assign(copy(r), { server_now: srvNow() })] : []);
    }
    if (name === 'update_session') {
      const r = T[p.p_code];
      if (!r) return ok([{ updated: false, row_found: false, current_rev: null, server_now: srvNow() }]);
      if (srev(r.data) < srev(p.p_data)) {
        r.data = copy(p.p_data); r.origin = p.p_origin; r.updated_at = srvNow(); be.writes++; be.log.push(['rpc-update', r.code, r.data.rev]);
        be.broadcast(r);
        return ok([{ updated: true, row_found: true, current_rev: srev(p.p_data), server_now: srvNow() }]);
      }
      return ok([{ updated: false, row_found: true, current_rev: srev(r.data), server_now: srvNow() }]);
    }
    if (name === 'create_session') {
      const code = 'K' + Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[01OIL]/g, 'X');
      T[code] = { code, data: copy(p.p_data), origin: p.p_origin, view_code: 'VIEW' + code, updated_at: srvNow() };
      be.writes++;
      return ok([{ code, view_code: 'VIEW' + code, server_now: srvNow() }]);
    }
    if (name === 'get_session_view') {
      const r = Object.values(T).find(x => x.view_code === p.p_view_code);
      if (!r) return ok([]);
      const d = copy(r.data); delete d.participants; delete d.sessionOwnerDeviceId;
      return ok([{ data: d, updated_at: r.updated_at, server_now: srvNow() }]);
    }
    if (name === 'delete_my_account') { be.deleted = true; return ok(null); }
    return ok(null);
  }
  function thenable(fn, isGet) {
    const t = {
      then(res, rej) {
        if (client.hang) return new Promise(() => {}).then(res, rej);
        if (client.slowNextGet && isGet) {
          const ms = client.slowNextGet; client.slowNextGet = 0;
          const captured = fn();
          return new Promise(r => setTimeout(() => r(captured), ms)).then(res, rej);
        }
        return new Promise(r => setTimeout(() => r(fn()), opts.latency || 0)).then(res, rej);
      },
      catch(rej) { return t.then(x => x, rej); }
    };
    return t;
  }
  const sb = {
    from: builder,
    rpc(name, p) { return thenable(() => rpcRun(name, JSON.parse(JSON.stringify(p || {}))), name === 'get_session'); },
    channel(name) {
      const ch = { name, filterCode: name.replace('session-', ''), cb: null, status: null, subscribed: false };
      ch.on = (t, cfg, cb) => { if (t === 'broadcast') ch.brCb = cb; else ch.pgCb = cb; return ch; };
      ch.subscribe = (st) => { ch.status = st; setTimeout(() => { if (client.offline) { return; } ch.subscribed = true; if (st) st('SUBSCRIBED'); }, 0); return ch; };
      client.channels.push(ch);
      return ch;
    },
    removeChannel(ch) { ch.subscribed = false; client.channels = client.channels.filter(c => c !== ch); },
    auth: {
      onAuthStateChange(cb) { client.authCb = cb; if (opts.initialSession) setTimeout(() => cb('INITIAL_SESSION', opts.initialSession), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword(c) {
        const r = opts.signIn ? opts.signIn(c) : { data: { session: { user: { id: 'u1' } } }, error: null };
        if (r instanceof Error) return Promise.reject(r);
        if (!r.error && client.authCb) client.authCb('SIGNED_IN', r.data.session);
        return Promise.resolve(r);
      },
      signUp(c) {
        const r = opts.signUp ? opts.signUp(c) : { data: { user: { id: 'u2' }, session: { user: { id: 'u2' } } }, error: null };
        if (!r.error && r.data.session && client.authCb) client.authCb('SIGNED_IN', r.data.session);
        return Promise.resolve(r);
      },
      signOut() { if (client.authCb) client.authCb('SIGNED_OUT', null); return Promise.resolve({}); },
      resetPasswordForEmail(email, o) { client.resetFor = email; client.resetOpts = o; return Promise.resolve({ data: {}, error: null }); },
      updateUser(u) { client.newPassword = u.password; return Promise.resolve({ data: {}, error: null }); }
    }
  };
  client.sb = sb;
  // Simulerer at realtime-kanalen kobler til igjen (slik realtime-js gjør etter nettbrudd/skjermlås)
  client.rejoin = () => client.channels.forEach(ch => { if (typeof ch.status === 'function') { ch.subscribed = true; ch.status('SUBSCRIBED'); } });
  return client;
}

const HOOK = `
window.__t = {
  get state(){ return state; }, set state(v){ state = v; },
  get sessionCode(){ return sessionCode; }, get deviceOrigin(){ return deviceOrigin; }, get deviceId(){ return deviceId; },
  get undoLen(){ return undoStack.length; }, get pendingOpsLen(){ return pendingOps.length; }, get offset(){ return clockOffsetMs; }, nowTs, recordOp, get selected(){ return selected; }, set selected(v){ selected = v; },
  get roster(){ return roster; },
  undoLastAction, redoLastAction, togglePlayPause, performSwap, swapFieldAndBench, saveState, flushState, matchClockElapsed,
  fieldElapsed, benchElapsed, renderAll, normalizeState, isMaster, canEdit, openSettings, pushRemoteState, fetchAndRenderHistoryList,
  renderHistoryList, openHistoryScreen, openGoalPlayerModal, renderMatchHistorySummary, renderEndMatchSummary, escapeHtml, resetMatch,
  createNewSession, joinSession, loadState, forgottenReset, commitDurationPickerValue, openDurationPicker, saveOpponent, showMatchSummaryThen,
  archiveInProgressMatch, leaveSession, currentPeriodFieldMs, cumulativeFieldMs, handleTap, ensureAudioUnlocked, loadCoachDefaults,
  computeRotationPlan, computeNextSwap, renderMatchPanels, openEndSheet, computeSeasonStats, buildReportText, startSpectator, fieldFormationRows, keeperIdNow, suggestNextKeeper, applyDesign, currentDesign, isValidSessionCode, renderPlanModal, renderCupModal, cupNextMatch, checkMatchAlarms, isSpectator(){ return !!spectatorCode; }, saveSettings, openShareSheet, buildTimelineHtml, get lastMatchSummary(){ return lastMatchSummary; }, get viewCode(){ return sessionViewCode; }, saveMatchToHistory, buildHistoryArchiveEntry, computeMatchScoreAndPlayerMs,
  setHistoryCache(l){ historyListCache = l; historyListLoading = false; },
  get els(){ return els; }
};
var __inited = false;
document.addEventListener('DOMContentLoaded', function(){ if (!__inited){ __inited = true; init(); } });`;

function appVersion(){ return fs.readFileSync(path.join(ROOT,'app.js'),'utf8').match(/APP_VERSION\s*=\s*'([^']+)'/)[1]; }
function loadApp(be, o) {
  o = o || {};
  const client = makeClient(be, o.client);
  if (o.prepare) o.prepare(client);
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented/.test(String(e))) errors.push(String((e && e.detail && e.detail.stack) || e)); });
  vc.on('error', () => {});
  const clock = { t: o.now || 1800000000000 };
  client.trueNow = () => clock.t;
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script\b[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'https://trenerappen.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      Object.entries(o.storage || {}).forEach(([k, v]) => w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.ResizeObserver = class { observe() {} disconnect() {} };
      w.supabase = o.noSupabase ? undefined : { createClient: () => client.sb };
      w.__audio = { created: 0, resumed: 0, tones: 0 };
      w.AudioContext = class {
        constructor() { w.__audio.created++; this.state = o.audioState || 'suspended'; this.currentTime = 0; this.destination = {}; }
        resume() { w.__audio.resumed++; this.state = 'running'; return Promise.resolve(); }
        createOscillator() { w.__audio.tones++; return { frequency: {}, connect() {}, start() {}, stop() {} }; }
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      };
      w.__fetches = [];
      w.fetch = o.fetch || ((url, init) => { w.__fetches.push([url, init && init.method || 'GET']); return Promise.resolve({ ok: true, headers: { get: () => null }, text: () => Promise.resolve("var APP_VERSION = '" + (o.liveVersion || appVersion()) + "';") }); });
      w.Date.now = () => clock.t + (o.skewMs || 0);
      const RD = w.Date; // new Date() uten argument bruker også klokka
      w.Date = new Proxy(RD, { construct(T, a) { return a.length ? new T(...a) : new T(clock.t + (o.skewMs || 0)); } });
      Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => !client.offline });
      if (!w.Element.prototype.setPointerCapture) { w.Element.prototype.setPointerCapture = function () {}; w.Element.prototype.releasePointerCapture = function () {}; }
      w.__hidden = false;
      Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => w.__hidden });
    }
  });
  const w = dom.window;
  let src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  if (!src.includes("document.addEventListener('DOMContentLoaded', init);")) throw new Error('hook point mangler');
  src = src.replace("document.addEventListener('DOMContentLoaded', init);", HOOK);
  w.eval(src);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const dev = {
    w, t: w.__t, client, clock, errors,
    adv(ms) { clock.t += ms; },
    els: () => w.__t.els,
    close() { be.clients = be.clients.filter(c => c !== client); client.channels = []; try { w.close(); } catch (e) {} },
    setHidden(h) { w.__hidden = h; w.document.dispatchEvent(new w.Event('visibilitychange')); },
    click(id) { w.document.getElementById(id).click(); },
    q(s) { return w.document.querySelector(s); },
    qa(s) { return Array.from(w.document.querySelectorAll(s)); },
    open(id) { return w.document.getElementById(id).classList.contains('open'); }
  };
  return dev;
}

function team(extra) {
  const t0 = 1800000000000;
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
  return Object.assign({
    players: ids.map((id, i) => ({ id, name: ['Ola Nordmann', 'Kari Li', 'Per Berg', 'Liv Dal', 'Nils Fjord'][i] })),
    onField: ['p1', 'p2', 'p3'], onBench: ['p4', 'p5'],
    fieldTimers: { p1: { baseElapsedMs: 0, sinceTs: t0 }, p2: { baseElapsedMs: 0, sinceTs: t0 }, p3: { baseElapsedMs: 0, sinceTs: t0 } },
    benchTimers: { p4: { baseElapsedMs: 0, sinceTs: t0 }, p5: { baseElapsedMs: 0, sinceTs: t0 } },
    cumulative: {}, periodStartCumulative: {}, matchClock: { baseElapsedMs: 0, sinceTs: t0 },
    fieldSize: 3, fieldSlotAssignment: null, globalRunning: false, defaultDurationMs: 180000, matchDurationMs: 900000,
    rankByCumulative: false, reorgUsesLastMatch: true, swapSuggestionBasis: 'match', swapSuggestionBenchMode: 'waited',
    shareEditable: true, sessionOwnerDeviceId: null, participants: [], goalLog: [], swapCount: 0,
    lastActivityAt: t0, lastPlayAt: t0, continueCount: 0, opponentName: '', opponentAbbr: '', matchHistory: [], rev: 5
  }, extra || {});
}
const KEYS = { state: 'spillerbytte_v4', code: 'spillerbytte_session_code_v1', dev: 'spillerbytte_device_id_v1', defaults: 'spillerbytte_coach_defaults_v1', lock: 'spillerbytte_history_login_lock_v1' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = { makeBackend, loadApp, team, KEYS, sleep, ROOT, makeClient };
