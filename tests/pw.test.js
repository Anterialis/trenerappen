// Ekte nettlesere: WebKit (samme motor som iPhone) for dra/slipp og ekte SDK,
// Chromium for service worker. Ingen trafikk når produksjons-Supabase: alt fanges opp.
const { webkit, chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = process.env.APP_ROOT || path.resolve(__dirname, '..');
const { team, KEYS } = require('./h');
const only = process.argv[2];
const tests = [];
const test = (n, f) => tests.push([n, f]);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const SUPA = 'https://nueguoxkynwgmynccaro.supabase.co';
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

function serve(opts) {
  opts = opts || {};
  const ctl = { hang: false, fail: false, log: [] };
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    ctl.log.push(req.method + ' ' + p);
    if (ctl.hang) return;
    if (ctl.fail) { res.writeHead(503, { 'content-type': 'text/html' }); res.end('<h1>Netlify nede</h1>'); return; }
    if (ctl.override && ctl.override[p] !== undefined) { res.writeHead(200, { 'content-type': MIME[path.extname(p)] }); res.end(ctl.override[p]); return; }
    let file = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (opts.mockSdk && /supabase/.test(p)) { res.writeHead(200, { 'content-type': MIME['.js'] }); res.end(opts.mockSdk); return; }
    fs.readFile(file, (e, buf) => {
      if (e) { res.writeHead(404); res.end('nope'); return; }
      const hdr = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', etag: '"v1"' };
      if (opts.headers) Object.assign(hdr, opts.headers);
      res.writeHead(200, hdr);
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => { ctl.url = 'http://127.0.0.1:' + srv.address().port + '/'; ctl.close = () => srv.close(); r(ctl); }));
}

// Mock-SDK som bare fanger opp realtime-tilbakekallet, for dra-testene.
const MOCK_SDK = `window.supabase = { createClient: function(){
  var thenable = function(v){ var b = { select:function(){return b}, update:function(){return b}, insert:function(){return b}, eq:function(){return b}, lte:function(){return b}, lt:function(){return b}, maybeSingle:function(){return b}, order:function(){return b},
    then:function(a,c){ return Promise.resolve(v).then(a,c) }, catch:function(c){ return Promise.resolve(v).catch(c) } }; return b; };
  return { from:function(){ return thenable({data:window.__row||null,error:null}); }, rpc:function(){ return thenable({data:null,error:{code:'PGRST202'},status:404}); },
    channel:function(){ var ch={on:function(t,c,cb){ window.__rt=cb; return ch; }, subscribe:function(s){ setTimeout(function(){s('SUBSCRIBED')},0); return ch; }}; return ch; },
    removeChannel:function(){}, auth:{ onAuthStateChange:function(){ return {data:{subscription:{unsubscribe:function(){}}}}; } } };
}};`;

async function bootMatch(browser, srv, st, extraInit) {
  const ctx = await browser.newContext({ viewport: { width: 440, height: 956 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([k, s, c]) => {
    if (!localStorage.getItem(k)) { localStorage.setItem(k, JSON.stringify(s)); if (c) localStorage.setItem('spillerbytte_session_code_v1', c); localStorage.setItem('spillerbytte_device_id_v1', 'devA'); localStorage.setItem('spillerbytte_tips_seen_v1', '{"swap":1,"goal":1,"due":1}'); }
    document.addEventListener('pointerdown', e => { window.__pid = e.pointerId; }, true);
    if (c) window.__row = { code: c, data: s, origin: 'seed' };
  }, [KEYS.state, st, extraInit && extraInit.code]);
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('cdn.jsdelivr.net')) return route.fulfill({ contentType: 'application/javascript', body: MOCK_SDK });
    return route.continue();
  });
  await page.goto(srv.url);
  await page.waitForSelector('#launcherTile');
  await page.click('#launcherResumeBtn');
  await sleep(700);
  return { ctx, page, errors };
}
const center = async (page, sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

test('D1 WebKit: fjernoppdatering midt i dra gir ingen fastlåst figur, og oppdateringen kommer etterpå', async () => {
  const srv = await serve({ mockSdk: MOCK_SDK });
  const b = await webkit.launch();
  const st = team({ sessionOwnerDeviceId: 'devA', participants: [{ deviceId: 'devA', joinedAt: 1 }] });
  const { page, errors } = await bootMatch(b, srv, st, { code: '123' });
  const from = await center(page, '#field [data-id="p1"]');
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 40, { steps: 4 });
  assert.strictEqual(await page.locator('.ghost-token').count(), 1, 'dra startet');
  await page.evaluate((st) => { window.__rt({ new: { origin: 'annen', data: Object.assign({}, st, { rev: 50, opponentName: 'Brann', opponentAbbr: 'BRA' }) } }); }, st);
  await sleep(50);
  assert.strictEqual(await page.locator('.ghost-token').count(), 1, 'figuren følger fingeren');
  await page.mouse.move(from.x + 60, from.y + 60, { steps: 2 });
  await page.mouse.up();
  await sleep(50);
  assert.strictEqual(await page.locator('.ghost-token').count(), 0, 'ingen fastlåst figur');
  assert.strictEqual(await page.locator('#awayTeamLabel').textContent(), 'BRA', 'oppdateringen ble tatt inn');
  assert.deepStrictEqual(errors, []);
  await b.close(); srv.close();
});
test('D2 WebKit: pointercancel over en innbytter utfører ikke bytte', async () => {
  const srv = await serve({ mockSdk: MOCK_SDK });
  const b = await webkit.launch();
  const { page } = await bootMatch(b, srv, team());
  const from = await center(page, '#field [data-id="p1"]'); const to = await center(page, '#bench [data-id="p4"]');
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.evaluate(({ x, y }) => {
    document.querySelector('#field [data-id="p1"]').dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.__pid, bubbles: true, clientX: x, clientY: y }));
  }, to);
  await sleep(30);
  assert.strictEqual(await page.locator('#field [data-id="p1"]').count(), 1, 'p1 skal fortsatt være på banen');
  assert.strictEqual(await page.locator('.ghost-token').count(), 0);
  await b.close(); srv.close();
});
test('D3 WebKit: en ny finger starter ikke et dra nummer to', async () => {
  const srv = await serve({ mockSdk: MOCK_SDK });
  const b = await webkit.launch();
  const { page } = await bootMatch(b, srv, team());
  const from = await center(page, '#field [data-id="p1"]');
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 30, { steps: 3 });
  await page.evaluate(() => {
    const t = document.querySelector('#field [data-id="p2"]');
    t.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 77, isPrimary: false, bubbles: true, clientX: 10, clientY: 10 }));
    t.dispatchEvent(new PointerEvent('pointermove', { pointerId: 77, isPrimary: false, bubbles: true, clientX: 90, clientY: 90 }));
  });
  await sleep(20);
  assert.strictEqual(await page.locator('.ghost-token').count(), 1);
  await page.mouse.up();
  await b.close(); srv.close();
});
test('R1 WebKit: vanlig flyt virker - dra-bytte, trykk-bytte, start, mål, angre', async () => {
  const srv = await serve({ mockSdk: MOCK_SDK });
  const b = await webkit.launch();
  const { page, errors } = await bootMatch(b, srv, team());
  // dra innbytter inn på banen
  let from = await center(page, '#bench [data-id="p4"]'); let to = await center(page, '#field [data-id="p1"]');
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.waitForSelector('#dropHint.visible');
  await page.mouse.up(); await sleep(40);
  assert.strictEqual(await page.locator('#field [data-id="p4"]').count(), 1, 'dra-bytte');
  // trykk-bytte
  await page.click('#field [data-id="p2"]'); await page.click('#bench [data-id="p5"]'); await sleep(40);
  assert.strictEqual(await page.locator('#field [data-id="p5"]').count(), 1, 'trykk-bytte');
  // start
  await page.click('#playPauseBtn');
  assert.strictEqual(await page.locator('#playPauseBtn.running').count(), 1);
  // mål
  await page.click('#homeScoreBtn'); await sleep(400);
  await page.click('#goalPlayerList [data-id="p4"]'); await sleep(50);
  assert.strictEqual(await page.locator('#homeScoreBtn').textContent(), '1');
  // angre målet
  await page.click('#undoBtn'); await sleep(400);
  await page.click('#undoActionBtn'); await sleep(50);
  assert.strictEqual(await page.locator('#homeScoreBtn').textContent(), '0', 'angre mål');
  assert.deepStrictEqual(errors, []);
  await b.close(); srv.close();
});

// ---------- Ekte SDK (vendor-filen) mot avlyttet nett ----------
async function realSdkPage(browserType, srv, st, code, rowFn, search) {
  const b = await browserType.launch();
  const ctx = await b.newContext({ viewport: { width: 440, height: 956 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const net = { rest: [], wsJoins: 0, ws: null, topic: null, joinRef: null, arr: true };
  net.push = async (event, payload) => { net.ws.send(JSON.stringify(net.arr ? [null, null, net.topic, event, payload] : { topic: net.topic, event, payload, ref: null })); };
  await page.addInitScript(([k, s, c]) => {
    if (!localStorage.getItem(k)) { localStorage.setItem(k, JSON.stringify(s)); if (c) localStorage.setItem('spillerbytte_session_code_v1', c); localStorage.setItem('spillerbytte_device_id_v1', 'devA'); localStorage.setItem('spillerbytte_tips_seen_v1', '{"swap":1,"goal":1,"due":1}'); }
  }, [KEYS.state, st, code]);
  await page.routeWebSocket(/supabase\.co/, ws => {
    net.ws = ws;
    ws.onMessage(m => {
      let msg; try { msg = JSON.parse(m); } catch (e) { return; }
      const arr = Array.isArray(msg);
      const ev = arr ? msg[3] : msg.event, topic = arr ? msg[2] : msg.topic, ref = arr ? msg[1] : msg.ref, joinRef = arr ? msg[0] : msg.join_ref;
      const reply = (payload) => ws.send(JSON.stringify(arr ? [joinRef, ref, topic, 'phx_reply', payload] : { ref, topic, event: 'phx_reply', payload }));
      if (ev === 'phx_join') {
        net.wsJoins++; net.topic = topic; net.arr = arr;
        const pc = msg[4] && msg[4].config && msg[4].config.postgres_changes || (msg.payload && msg.payload.config && msg.payload.config.postgres_changes) || [];
        reply({ status: 'ok', response: { postgres_changes: pc.map((c, i) => Object.assign({ id: i + 1 }, c)) } });
      } else if (ev === 'heartbeat') {
        reply({ status: 'ok', response: {} });
      }
    });
  });
  await page.route(SUPA + '/**', async (route) => {
    const r = route.request();
    net.rest.push({ method: r.method(), url: decodeURIComponent(r.url()), prefer: r.headers().prefer || '' });
    const res = rowFn(r);
    await route.fulfill({ status: res.status || 200, contentType: 'application/json', body: JSON.stringify(res.body) });
  });
  await page.goto(srv.url + (search || ''));
  await page.waitForSelector('#launcherTile', { state: 'attached' });
  return { b, page, net, errors };
}
test('V1 ekte SDK med databasefunksjoner: riktige kall, ping henter, avvist skriving fletter, gjentilkobling henter', async () => {
  const srv = await serve();
  const st = team({ sessionOwnerDeviceId: 'devA', participants: [{ deviceId: 'devA', joinedAt: 1 }], rev: 7, globalRunning: false });
  let serverData = JSON.parse(JSON.stringify(st));
  let reject = false;
  const { b, page, net, errors } = await realSdkPage(webkit, srv, st, 'K7M2QX', (r) => {
    const u = r.url();
    if (u.includes('/rpc/get_session')) return { body: [{ code: 'K7M2QX', data: serverData, origin: 'x', view_code: 'VIEWCODE', server_now: new Date().toISOString() }] };
    if (u.includes('/rpc/update_session')) {
      if (reject) return { body: [{ updated: false, row_found: true, current_rev: serverData.rev, server_now: new Date().toISOString() }] };
      const p = JSON.parse(r.postData()); serverData = p.p_data;
      return { body: [{ updated: true, row_found: true, current_rev: p.p_data.rev, server_now: new Date().toISOString() }] };
    }
    return { status: 404, body: { code: 'PGRST202' } };
  });
  await page.click('#launcherResumeBtn'); await sleep(800);
  assert.ok(net.wsJoins >= 1, 'kanalen koblet til');
  const rpcNames = () => net.rest.map(x => (x.url.match(/rpc\/(\w+)/) || [])[1]).filter(Boolean);
  assert.ok(rpcNames().includes('get_session'), 'hentet via funksjon: ' + rpcNames());
  assert.ok(!net.rest.some(x => /rest\/v1\/sessions/.test(x.url)), 'ingen direkte tabelltilgang');
  await page.click('#playPauseBtn'); await sleep(150);
  assert.ok(rpcNames().includes('update_session'));
  assert.strictEqual(serverData.globalRunning, true, 'skrevet');
  // ping uten navn fra serveren => henter raden
  const g0 = rpcNames().filter(n => n === 'get_session').length;
  serverData = Object.assign({}, serverData, { rev: serverData.rev + 1, opponentName: 'Brann', opponentAbbr: 'BRA' });
  await net.push('broadcast', { type: 'broadcast', event: 'changed', payload: { rev: serverData.rev, origin: 'annen' } });
  await sleep(250);
  assert.ok(rpcNames().filter(n => n === 'get_session').length > g0, 'ping utløste henting');
  assert.strictEqual(await page.locator('#awayTeamLabel').textContent(), 'BRA');
  // avvist skriving: flettes
  reject = true;
  serverData = Object.assign({}, serverData, { rev: serverData.rev + 5, swapCount: 42 });
  await page.click('#playPauseBtn'); await sleep(150);
  reject = false;
  await sleep(400);
  assert.strictEqual(serverData.swapCount, 42, 'den andres endring er med');
  assert.strictEqual(serverData.globalRunning, false, 'min pause er med');
  // gjentilkobling
  const j0 = net.wsJoins, g1 = rpcNames().filter(n => n === 'get_session').length;
  await net.ws.close();
  for (let i = 0; i < 80 && net.wsJoins === j0; i++) await sleep(250);
  assert.ok(net.wsJoins > j0, 'SDK koblet til igjen');
  await sleep(300);
  assert.ok(rpcNames().filter(n => n === 'get_session').length > g1, 'hentet etter gjentilkobling');
  assert.deepStrictEqual(errors, []);
  await b.close(); srv.close();
});
test('V2 ekte SDK uten funksjonene (før steg 1): samme flyt mot tabellen', async () => {
  const srv = await serve();
  const st = team({ sessionOwnerDeviceId: 'devA', participants: [{ deviceId: 'devA', joinedAt: 1 }], rev: 7 });
  let serverData = JSON.parse(JSON.stringify(st));
  const { b, page, net, errors } = await realSdkPage(webkit, srv, st, '123', (r) => {
    if (r.url().includes('/rpc/')) return { status: 404, body: { code: 'PGRST202', message: 'not found' } };
    if (r.method() === 'GET') return { body: { code: '123', data: serverData, origin: 'x' } };
    return { body: [{ code: '123' }] };
  });
  await page.click('#launcherResumeBtn'); await sleep(800);
  await page.click('#playPauseBtn'); await sleep(200);
  const patch = net.rest.filter(x => x.method === 'PATCH').pop();
  assert.ok(patch, 'skrev mot tabellen');
  assert.ok(/data->rev=lt\.8/.test(patch.url), 'rev-betingelse: ' + patch.url);
  assert.deepStrictEqual(errors, []);
  await b.close(); srv.close();
});
test('V3 ekte SDK: foreldrelenke bruker bare lesefunksjonen, skriver aldri', async () => {
  const srv = await serve();
  const st = team({ opponentName: 'Brann', opponentAbbr: 'BRA', homeTeamName: 'Nøtterøy', homeTeamAbbr: 'NØT' });
  const { b, page, net, errors } = await realSdkPage(webkit, srv, team({ opponentName: 'MinKamp' }), null, (r) => {
    if (r.url().includes('/rpc/get_session_view')) return { body: [{ data: st, updated_at: new Date().toISOString(), server_now: new Date().toISOString() }] };
    return { status: 500, body: { message: 'skulle ikke vært kalt: ' + r.url() } };
  }, '?se=VIEWCODE');
  await sleep(700);
  assert.strictEqual(await page.locator('#awayTeamLabel').textContent(), 'BRA', 'viser kampen');
  assert.strictEqual(await page.locator('#launcherScreen.hidden').count(), 1, 'rett inn');
  assert.strictEqual(await page.locator('header').isVisible(), false, 'ingen knapper');
  await page.click('#field [data-id="p1"]');
  await page.waitForSelector('#selectionInfo.visible');
  assert.ok(net.rest.every(x => /get_session_view/.test(x.url)), 'bare lesefunksjonen: ' + JSON.stringify(net.rest.map(x => x.url)));
  const stored = await page.evaluate((k) => localStorage.getItem(k), KEYS.state);
  assert.ok(/MinKamp/.test(stored), 'egen kamp urørt');
  assert.deepStrictEqual(errors, []);
  await b.close(); srv.close();
});
for (const design of ['a', 'b', 'c', 'd', 'e']) {
  test('D-' + design + ' WebKit, design ' + design + ': dra-bytte, trykk, Bytt-knapp, mål og Angre virker', async () => {
    const srv = await serve({ mockSdk: MOCK_SDK });
    const br = await webkit.launch();
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(([k, s, d]) => { if (!localStorage.getItem(k)) { localStorage.setItem(k, JSON.stringify(s)); localStorage.setItem('spillerbytte_design_v1', d); localStorage.setItem('spillerbytte_tips_seen_v1', '{"swap":1,"goal":1,"due":1}'); } }, [KEYS.state, team({ matchDurationMs: 900000, defaultDurationMs: 60000 }), design]);
    await page.goto(srv.url);
    await page.click('#launcherResumeBtn'); await sleep(700);
    assert.strictEqual(await page.evaluate(() => document.documentElement.getAttribute('data-design')), design);
    let from = await center(page, '#bench [data-id="p4"]'), to = await center(page, '#field [data-id="p1"]');
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up(); await sleep(60);
    assert.strictEqual(await page.locator('#field [data-id="p4"]').count(), 1, 'dra-bytte');
    assert.ok(await page.locator('#undoToast.show').count(), 'Angre vises');
    await page.click('#undoToastBtn'); await sleep(60);
    assert.strictEqual(await page.locator('#field [data-id="p1"]').count(), 1, 'Angre virker');
    await page.click('#field [data-id="p2"]'); await page.click('#bench [data-id="p5"]'); await sleep(60);
    assert.strictEqual(await page.locator('#field [data-id="p5"]').count(), 1, 'trykk-bytte');
    await page.click('#playPauseBtn');
    await page.click('#homeScoreBtn'); await sleep(420);
    await page.click('#goalPlayerList [data-id="p3"]'); await sleep(60);
    assert.strictEqual(await page.locator('#homeScoreBtn').textContent(), '1', 'mål');
    await page.click('#nextSwapBtn'); await sleep(60);
    assert.ok(/⇄/.test(await page.locator('#undoToastText').textContent()), 'Bytt-knappen');
    await page.click('#planBtn'); await sleep(400);
    await page.click('#planCloseBtn'); await sleep(300);
    await page.click('#endBtn'); await sleep(400);
    await page.click('#endPeriodBtn'); await sleep(200);
    assert.strictEqual(await page.locator('.modal.open').count(), 0, 'ingen flere spørsmål');
    assert.strictEqual(await page.locator('#homeScoreBtn').textContent(), '0', 'ny kamp');
    assert.deepStrictEqual(errors, []);
    await br.close(); srv.close();
  });
}
for (const design of ['a', 'b', 'c', 'd', 'e']) {
  test('T-' + design + ' statuslinjen: alt interaktivt ligger minst 10 px nedenfor den, design ' + design, async () => {
    const srv = await serve({ mockSdk: MOCK_SDK });
    const br = await webkit.launch();
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.addInitScript(([k, s, d]) => { if (!localStorage.getItem(k)) { localStorage.setItem(k, JSON.stringify(s)); localStorage.setItem('spillerbytte_design_v1', d); localStorage.setItem('spillerbytte_tips_seen_v1', '{"swap":1,"goal":1,"due":1}'); } }, [KEYS.state, team(), design]);
    await page.goto(srv.url);
    await page.waitForSelector('#launcherTile');
    const statusBar = 20; // max(env(safe-area-inset-top), 20px) uten notch
    const topOf = (sel) => page.locator(sel).evaluate(el => el.getBoundingClientRect().top);
    assert.ok(await topOf('#accountBtn') >= statusBar + 10, 'Mitt lag');
    await page.click('#launcherResumeBtn'); await sleep(700);
    for (const sel of ['#undoBtn', '#settingsBtn', '#matchClock', '#homeScoreBtn']) {
      const t = await topOf(sel);
      assert.ok(t >= statusBar + 10, sel + ' ligger på ' + t);
    }
    await page.click('#field [data-id="p1"]');
    await page.waitForSelector('#selectionInfo.visible'); await sleep(250);
    const info = await topOf('#selectionInfo');
    assert.ok(info >= statusBar + 10, 'spillerinfo ligger på ' + info);
    const clockBottom = await page.locator('#matchCountdown').evaluate(el => el.getBoundingClientRect().bottom);
    const firstToken = await page.locator('#field .token').first().evaluate(el => el.getBoundingClientRect().top);
    assert.ok(firstToken >= clockBottom - 2, 'første spiller under klokka: ' + firstToken + ' / ' + clockBottom);
    await br.close(); srv.close();
  });
}
// Rotert telefon: touch-sjekken i updateFrameFit må si ja, ellers blir det forhåndsvisning på Mac.
async function openMatch(srv, br, design, viewport, touch) {
  const ctx = await br.newContext({ viewport, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(([k, s, d, t]) => {
    if (t) { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /hover: none/.test(q) ? { matches: true, addEventListener() {}, removeEventListener() {} } : mm(q); }
    if (!localStorage.getItem(k)) { localStorage.setItem(k, JSON.stringify(s)); localStorage.setItem('spillerbytte_design_v1', d); localStorage.setItem('spillerbytte_tips_seen_v1', '{"swap":1,"goal":1,"due":1}'); }
  }, [KEYS.state, team(), design, touch]);
  await page.goto(srv.url);
  await page.waitForSelector('#launcherTile');
  await page.click('#launcherResumeBtn'); await sleep(700);
  return page;
}
for (const design of ['a', 'b', 'c', 'd', 'e']) {
  test('T-' + design + '2 rotert telefon: ingen luft mot langsiden, design ' + design, async () => {
    const srv = await serve({ mockSdk: MOCK_SDK });
    const br = await webkit.launch();
    const page = await openMatch(srv, br, design, { width: 844, height: 390 }, true);
    assert.strictEqual(await page.locator('#viewport-frame.desktop-preview').count(), 0, 'ekte telefon, ikke forhåndsvisning');
    const topOf = (sel) => page.locator(sel).evaluate(el => el.getBoundingClientRect().top);
    const sel = (design === 'a' || design === 'b') ? '#undoBtn' : '#matchClock'; // C-E: klokka er høyest i båndet, resten er midtstilt mot den
    const t = await topOf(sel);
    assert.ok(t <= 8, sel + ' ligger på ' + t);
    const clockBottom = await page.locator('#matchCountdown').evaluate(el => el.getBoundingClientRect().bottom);
    const firstToken = await page.locator('#field .token').first().evaluate(el => el.getBoundingClientRect().top);
    assert.ok(firstToken >= clockBottom - 2, 'første spiller under klokka: ' + firstToken + ' / ' + clockBottom);
    await br.close(); srv.close();
  });
}
test('T3 stående avstand, og forhåndsvisning på Mac i et lavt vindu beholder den', async () => {
  const srv = await serve({ mockSdk: MOCK_SDK });
  const br = await webkit.launch();
  const upright = await openMatch(srv, br, 'a', { width: 390, height: 844 }, true);
  assert.strictEqual(await upright.locator('#undoBtn').evaluate(el => el.getBoundingClientRect().top), 52, 'stående: 20 + 32');
  const preview = await openMatch(srv, br, 'a', { width: 1100, height: 450 }, false);
  assert.strictEqual(await preview.locator('#viewport-frame.desktop-preview').count(), 1, 'forhåndsvisning');
  const offset = await preview.evaluate(() => document.getElementById('undoBtn').getBoundingClientRect().top - document.getElementById('app').getBoundingClientRect().top);
  assert.ok(offset > 40, 'forhåndsvisningen har stående avstand: ' + offset);
  await br.close(); srv.close();
});
test('S1 _headers: CSP blokkerer ikke noe appen selv gjør, og stopper innsprøytet kode', async () => {
  const lines = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8').split('\n').filter(l => /^\s+\S+:/.test(l));
  const headers = {}; lines.forEach(l => { const i = l.indexOf(':'); headers[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
  assert.ok(headers['Content-Security-Policy']);
  const srv = await serve({ headers });
  const br = await webkit.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const violations = []; const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(SUPA + '/**', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"code":"PGRST202"}' }));
  await page.routeWebSocket(/supabase\.co/, ws => {});
  await page.addInitScript(([k, s]) => {
    document.addEventListener('securitypolicyviolation', e => { (window.__csp = window.__csp || []).push(e.violatedDirective + ' ' + e.blockedURI); });
    if (!localStorage.getItem(k)) { localStorage.setItem(k, JSON.stringify(s)); localStorage.setItem('spillerbytte_session_code_v1', 'K7M2QX'); localStorage.setItem('spillerbytte_design_v1', 'c'); localStorage.setItem('spillerbytte_tips_seen_v1', '{"swap":1,"goal":1,"due":1}'); }
  }, [KEYS.state, team({ sessionOwnerDeviceId: 'devA' })]);
  await page.goto(srv.url);
  await page.click('#launcherResumeBtn'); await sleep(600);
  await page.click('#planBtn'); await sleep(300); await page.click('#planCloseBtn'); await sleep(200);
  await page.evaluate(() => { const i = new Image(); document.body.insertAdjacentHTML('beforeend', '<img src="x" onerror="window.__pwned=1" style="display:none">'); });
  await sleep(150);
  const csp = await page.evaluate(() => window.__csp || []);
  const pwned = await page.evaluate(() => window.__pwned);
  assert.strictEqual(pwned, undefined, 'innsprøytet kode skal ikke kjøre');
  const own = csp.filter(v => !/script-src|inline/.test(v));
  assert.deepStrictEqual(own, [], 'ingen blokkeringer av appens egne ting');
  assert.deepStrictEqual(errors, []);
  await br.close(); srv.close();
});

// ---------- Service worker (Chromium, ekte SW mot lokal server) ----------
// Service workeren er av på localhost/lokalt nett (så endrede filer vises straks), ?sw=on slår den på.
const SW_ON = '?sw=on';
async function swPage(storage) {
  const srv = await serve({});
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 440, height: 956 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route(/supabase\.co/, r => r.abort());
  await page.routeWebSocket(/supabase\.co/, ws => ws.close());
  if (storage) await page.addInitScript((st) => { if (!localStorage.getItem('__seed')) { localStorage.setItem('__seed', '1'); Object.keys(st).forEach(k => localStorage.setItem(k, st[k])); } }, storage);
  await page.goto(srv.url + SW_ON);
  await page.evaluate(() => navigator.serviceWorker.ready);
  for (let i = 0; i < 40 && !(await page.evaluate(() => !!navigator.serviceWorker.controller)); i++) await sleep(100);
  return { srv, b, ctx, page, errors };
}
// Som å legge ut en ny versjon på Netlify.
function publish(srv, version) {
  const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').replace(/APP_VERSION = '[^']+'/, "APP_VERSION = '" + version + "'").replace(/CACHE_NAME = '[^']+'/, "CACHE_NAME = 'trenerapp-app-v" + version + "'");
  const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').replace(/APP_VERSION = '[^']+'/, "APP_VERSION = '" + version + "'");
  srv.override = { '/sw.js': swSrc, '/app.js': appSrc };
}
const appVersionShown = (page) => page.locator('#launcherVersionBtn').textContent();
const askForUpdate = (page) => page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
test('W1 service worker: helt uten nett starter appen, med Supabase-klient', async () => {
  const { srv, b, ctx, page } = await swPage();
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('#launcherTile');
  assert.strictEqual(await page.evaluate(() => typeof window.supabase), 'object', 'SDK fra cachen');
  await page.click('#launcherTile');
  await page.waitForSelector('#launcherChoiceOverlay.open');
  await b.close(); srv.close();
});
test('W2 service worker: nett som aldri svarer holder ikke appen igjen', async () => {
  const { srv, b, page } = await swPage();
  srv.hang = true;
  const t0 = Date.now();
  await page.reload({ waitUntil: 'load', timeout: 20000 });
  const ms = Date.now() - t0;
  await page.waitForSelector('#launcherTile');
  assert.ok(ms < 2000, 'åpnet på ' + ms + ' ms');
  console.log('         (åpnet på ' + ms + ' ms med hengende nett)');
  await b.close(); srv.close();
});
test('W3 service worker: feilside fra serveren når aldri appen', async () => {
  const { srv, b, ctx, page } = await swPage();
  srv.fail = true;
  await page.reload();
  await page.waitForSelector('#launcherTile');
  srv.fail = false;
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('#launcherTile');
  await b.close(); srv.close();
});
test('O1 oppdatering: finner ny versjon, spør, og bytter ikke før brukeren svarer', async () => {
  const { srv, b, page, errors } = await swPage();
  const before = await appVersionShown(page);
  assert.strictEqual(await page.locator('#updateBanner').isVisible(), false, 'ingen banner uten ny versjon');
  publish(srv, '9.9.9');
  await page.reload();                 // oppstart med en ny versjon ute
  await page.waitForSelector('#updateBanner:not([hidden])', { timeout: 15000 });
  await page.waitForFunction(() => /9\.9\.9/.test(document.getElementById('updateBannerTitle').textContent), null, { timeout: 5000 });
  assert.strictEqual(await page.locator('#updateNowBtn').textContent(), 'Oppdater nå');
  assert.strictEqual(await appVersionShown(page), before, 'kjører fortsatt gammel versjon');
  await page.reload();                 // ny oppstart uten å ha svart: fortsatt ikke byttet, og spør igjen
  await page.waitForSelector('#updateBanner:not([hidden])', { timeout: 15000 });
  assert.strictEqual(await appVersionShown(page), before, 'fortsatt gammel etter omlasting');
  assert.deepStrictEqual(errors, []);
  await b.close(); srv.close();
});
test('O2 oppdatering: «Oppdater nå» tar i bruk ny versjon, og kampen er urørt', async () => {
  const st = team({ opponentName: 'Brann', opponentAbbr: 'BRA', globalRunning: true });
  const { srv, b, page, errors } = await swPage({ [KEYS.state]: JSON.stringify(st) });
  publish(srv, '9.9.9');
  await page.reload();
  await page.waitForSelector('#updateBanner:not([hidden])', { timeout: 15000 });
  assert.ok(/Kampen og klokkene/.test(await page.locator('#updateBannerSub').textContent()), 'beroliger når en kamp pågår');
  await Promise.all([page.waitForEvent('load', { timeout: 15000 }), page.click('#updateNowBtn')]);
  await page.waitForSelector('#launcherTile');
  assert.strictEqual(await appVersionShown(page), 'v9.9', 'ny versjon');
  assert.strictEqual(await page.locator('#updateBanner').isVisible(), false, 'ikke spurt igjen');
  const kept = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEYS.state);
  assert.strictEqual(kept.opponentName, 'Brann', 'kampen er der');
  assert.strictEqual(kept.globalRunning, true, 'klokka går');
  assert.deepStrictEqual(errors, []);
  await b.close(); srv.close();
});
test('O3 oppdatering: × skjuler til neste oppstart, og versjonen i vinduet ser etter på nytt', async () => {
  const { srv, b, page } = await swPage();
  const before = await appVersionShown(page);
  await page.click('#launcherVersionBtn'); await sleep(300);
  await page.click('#checkUpdateBtn'); await sleep(400);
  assert.ok(/nyeste versjon/.test(await page.locator('#checkUpdateNote').textContent()), await page.locator('#checkUpdateNote').textContent());
  publish(srv, '9.9.9');
  await page.click('#checkUpdateBtn');
  await page.waitForSelector('#updateBanner:not([hidden])', { timeout: 15000 });
  await page.click('#updateLaterBtn');
  assert.strictEqual(await page.locator('#updateBanner').isVisible(), false, 'skjult');
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(500);
  assert.strictEqual(await page.locator('#updateBanner').isVisible(), false, 'maser ikke når appen hentes frem');
  assert.strictEqual(await appVersionShown(page), before);
  await page.reload();
  await page.waitForSelector('#updateBanner:not([hidden])', { timeout: 15000 });
  await b.close(); srv.close();
});
test('O4 oppdatering: finner ny versjon når appen hentes frem, uten omstart', async () => {
  const { srv, b, page } = await swPage();
  publish(srv, '9.9.9');
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForSelector('#updateBanner:not([hidden])', { timeout: 15000 });
  await b.close(); srv.close();
});
test('O5 oppgradering fra 2.3.x: går rett over uten å spørre, og uten omstart', async () => {
  // Det vesentlige fra service workeren i 2.3.x: gammelt cachenavn, nett først, tok over med en gang.
  const oldSw = `var CACHE_NAME = 'trenerapp-shell-v2.3.4';
    self.addEventListener('install', function(e){ self.skipWaiting(); e.waitUntil(caches.open(CACHE_NAME).then(function(c){ return c.addAll(['/index.html']); })); });
    self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
    self.addEventListener('fetch', function(e){ if (e.request.method === 'GET') e.respondWith(fetch(e.request)); });`;
  const srv = await serve({});
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 440, height: 956 } });
  const page = await ctx.newPage();
  await page.route(/supabase\.co/, r => r.abort());
  await page.routeWebSocket(/supabase\.co/, ws => ws.close());
  srv.override = { '/sw.js': oldSw };
  await page.goto(srv.url + SW_ON);
  await page.evaluate(() => navigator.serviceWorker.ready);
  for (let i = 0; i < 40 && !(await page.evaluate(() => !!navigator.serviceWorker.controller)); i++) await sleep(100);
  assert.ok((await page.evaluate(() => caches.keys())).some(n => n.startsWith('trenerapp-shell-')), 'gammel cache finnes');
  srv.override = null;
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await page.waitForFunction(() => caches.keys().then(k => k.every(n => !n.startsWith('trenerapp-shell-')) && k.some(n => n.startsWith('trenerapp-app-'))), null, { timeout: 15000 });
  assert.strictEqual(await page.locator('#updateBanner').isVisible(), false, 'ingen spørsmål');
  await b.close(); srv.close();
});
test('O6 lokalt: uten ?sw=on er service workeren av, og en gammel fjernes', async () => {
  const { srv, b, page } = await swPage();
  assert.strictEqual(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(r => r.length)), 1);
  await page.goto(srv.url);
  await page.waitForFunction(() => navigator.serviceWorker.getRegistrations().then(r => r.length === 0), null, { timeout: 8000 });
  await page.waitForFunction(() => caches.keys().then(k => k.length === 0), null, { timeout: 8000 });
  await page.click('#launcherVersionBtn'); await sleep(300);
  await page.click('#checkUpdateBtn');
  assert.ok(/lokalt/.test(await page.locator('#checkUpdateNote').textContent()));
  await b.close(); srv.close();
});

(async () => {
  let pass = 0, fail = 0;
  for (const [n, f] of tests) {
    if (only && !n.startsWith(only)) continue;
    try { await Promise.race([f(), sleep(45000).then(() => { throw new Error('timeout 45s'); })]); pass++; console.log('  ok   ' + n); }
    catch (e) { fail++; console.log('  FEIL ' + n + '\n         ' + String(e.message).split('\n').slice(0, 2).join(' | ')); }
  }
  console.log(`\n${pass} ok, ${fail} feil av ${pass + fail}`);
  process.exit(0);
})();
