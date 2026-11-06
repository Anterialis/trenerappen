// Ende-til-ende mot EKTE produksjon: lager en engangsøkt med oppdiktede navn. Kjøres bare bevisst.
// Koden skrives til e2e-code.txt. Slett raden etterpå:
//   supabase db query --linked "delete from public.sessions where code = 'KODE' and data->>'opponentName' = 'E2E-test'"
const { webkit } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const { team, KEYS } = require('./h');
const ROOT = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8').split('\n').filter(l => /^\s+\S+:/.test(l));
const H = {}; lines.forEach(l => { const i = l.indexOf(':'); H[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((q, r) => { const p = decodeURIComponent(q.url.split('?')[0]); fs.readFile(path.join(ROOT, p === '/' ? 'index.html' : p), (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, Object.assign({ 'content-type': MIME[path.extname(p) || '.html'] || 'text/html' }, H)); r.end(q.method === 'HEAD' ? undefined : b); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await sleep(50); } throw new Error('tidsavbrudd: ' + what); };
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const url = 'http://127.0.0.1:' + srv.address().port + '/';
  const b = await webkit.launch();
  const mk = async (storage, search) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const csp = []; page.on('console', m => { if (/Content Security|Refused/.test(m.text())) csp.push(m.text()); });
    await page.addInitScript((st) => { if (!localStorage.getItem('__seed')) { localStorage.setItem('__seed', '1'); Object.keys(st).forEach(k => localStorage.setItem(k, st[k])); localStorage.setItem('spillerbytte_tips_seen_v1', '{"swap":1,"goal":1,"due":1}'); } }, storage);
    await page.goto(url + (search || ''));
    return { ctx, page, errs, csp };
  };
  const t = team({ players: [['p1','Test Alfa'],['p2','Test Beta'],['p3','Test Gamma'],['p4','Test Delta'],['p5','Test Epsilon']].map(([id,name]) => ({ id, name })), opponentName: 'E2E-test', opponentAbbr: 'E2E', homeTeamName: 'E2E-lag', homeTeamAbbr: 'E2E', rev: 0, lastActivityAt: Date.now(), lastPlayAt: Date.now() });
  const A = await mk({ [KEYS.state]: JSON.stringify(t), [KEYS.dev]: 'e2e-enhet-a' });
  await A.page.click('#launcherResumeBtn'); await sleep(700);
  await A.page.click('#settingsBtn'); await sleep(400);
  await A.page.locator('#shareSessionRow .toggle').click();
  await A.page.waitForSelector('#shareModal.open', { timeout: 15000 });
  await waitFor(async () => (await A.page.locator('#shareCode').textContent()).length > 0, 5000, 'kode');
  const code = await A.page.locator('#shareCode').textContent();
  fs.writeFileSync('e2e-code.txt', code);
  console.log('kode', code, /^[A-HJKMNP-Z][A-HJKMNP-Z2-9]{5}$/.test(code) ? '(riktig format)' : '(FEIL FORMAT)');
  assert.ok(/^[A-HJKMNP-Z][A-HJKMNP-Z2-9]{5}$/.test(code));
  await A.page.waitForSelector('#shareViewQr svg', { timeout: 5000 });
  const viewUrlSet = await A.page.evaluate(() => !document.getElementById('shareViewBlock').hidden);
  assert.ok(viewUrlSet, 'foreldrelenke vises');
  // En ny deling starter som Kun les (2.5.0): bare foreldrelenken vises, til eieren velger Redigering.
  assert.strictEqual(await A.page.evaluate(() => document.getElementById('shareEditBlock').hidden), true, 'ingen medtrenerkode i Kun les');
  await A.page.click('#shareCloseBtn'); await sleep(350);
  assert.strictEqual(await A.page.locator('#shareModeSegmented [data-mode="read"]').evaluate(e => e.classList.contains('active')), true, 'Kun les er valgt fra start');
  await A.page.click('#shareModeSegmented [data-mode="edit"]'); await sleep(300);
  await A.page.click('#openShareBtn');
  await A.page.waitForSelector('#shareEditQr svg', { timeout: 5000 });
  assert.strictEqual(await A.page.locator('#shareEditQr svg').count(), 1, 'QR for medtrener etter Redigering');
  await A.page.click('#shareCloseBtn'); await sleep(350);
  await A.page.click('#settingsCancelBtn'); await sleep(350);
  await A.page.waitForFunction(() => !document.getElementById('syncDot').classList.contains('offline'), null, { timeout: 15000 });
  console.log('ok   A er koblet til Realtime');

  const B = await mk({ [KEYS.dev]: 'e2e-enhet-b', [KEYS.state]: JSON.stringify(Object.assign({}, team({ players: [], onField: [], onBench: [], fieldTimers: {}, benchTimers: {} }))) });
  await B.page.click('#launcherTile'); await sleep(350);
  await B.page.click('#joinSessionChoiceBtn'); await sleep(150);
  await B.page.fill('#launcherJoinInput', code);
  await B.page.waitForFunction(() => document.getElementById('launcherScreen').classList.contains('hidden'), null, { timeout: 15000 });
  await sleep(600);
  assert.strictEqual(await B.page.locator('#homeTeamLabel').textContent(), 'E2E', 'lagnavn følger økten');
  await B.page.waitForFunction(() => !document.getElementById('syncDot').classList.contains('offline'), null, { timeout: 15000 });
  console.log('ok   B ble med og er koblet til');

  // Bytte på A når B via ping
  await sleep(800);
  await A.page.click('#field [data-id="p1"]'); await A.page.click('#bench [data-id="p4"]');
  let ms = await waitFor(async () => await B.page.locator('#field [data-id="p4"]').count() === 1, 12000, 'B ser A sitt bytte');
  console.log('ok   B så A sitt bytte etter ' + ms + ' ms' + (ms < 5000 ? ' (ping virker)' : ' (kom med poll, ikke ping)'));
  const pingOk = ms < 5000;
  await sleep(300);
  await B.page.click('#field [data-id="p2"]'); await B.page.click('#bench [data-id="p5"]');
  ms = await waitFor(async () => await A.page.locator('#field [data-id="p5"]').count() === 1, 12000, 'A ser B sitt bytte');
  console.log('ok   A så B sitt bytte etter ' + ms + ' ms');
  await sleep(500);

  // Samtidig: flettes
  await A.page.evaluate(() => {}); 
  await Promise.all([
    (async () => { await A.page.click('#field [data-id="p3"]'); await A.page.click('#bench [data-id="p1"]'); })(),
    (async () => { await B.page.click('#field [data-id="p4"]'); await B.page.click('#bench [data-id="p2"]'); })()
  ]);
  await waitFor(async () => {
    const fa = await A.page.locator('#field .token').evaluateAll(els => els.map(e => e.dataset.id).sort().join());
    const fb = await B.page.locator('#field .token').evaluateAll(els => els.map(e => e.dataset.id).sort().join());
    return fa === fb && fa === 'p1,p2,p5';
  }, 15000, 'begge samtidige byttene på begge telefoner');
  console.log('ok   samtidige bytter flettet, begge telefoner enige');

  // Foreldre
  const viewCode = await A.page.evaluate(() => { const el = document.getElementById('shareViewQr'); return null; });
  const row = await A.page.evaluate(async (code) => {
    const r = await fetch('https://nueguoxkynwgmynccaro.supabase.co/rest/v1/rpc/get_session', { method: 'POST', headers: { apikey: 'sb_publishable_1Zsq-zFU3nmqYFrSxXzKGQ_k-peb2bV', 'Content-Type': 'application/json' }, body: JSON.stringify({ p_code: code }) });
    return (await r.json())[0];
  }, code);
  assert.ok(row && row.view_code && row.view_code !== code);
  const P = await mk({ [KEYS.state]: JSON.stringify(team({ opponentName: 'MinEgenKamp' })) }, '?se=' + row.view_code);
  await P.page.waitForFunction(() => /E2E/.test(document.getElementById('spectatorText').textContent), null, { timeout: 12000 });
  assert.strictEqual(await P.page.locator('header').isVisible(), false);
  assert.strictEqual(await P.page.locator('#field .token').count(), 3, 'ser laget');
  await A.page.click('#playPauseBtn');
  ms = await waitFor(async () => { const t1 = await P.page.locator('#matchClock').textContent(); await sleep(1300); return (await P.page.locator('#matchClock').textContent()) !== t1; }, 20000, 'forelder ser klokka gå');
  console.log('ok   forelder ser kampen live');
  const stillMine = await P.page.evaluate((k) => /MinEgenKamp/.test(localStorage.getItem(k)), KEYS.state);
  assert.ok(stillMine, 'kampen på foreldrenes telefon er urørt');
  // lesekoden kan ikke skrive
  const wr = await P.page.evaluate(async (vc) => {
    const r = await fetch('https://nueguoxkynwgmynccaro.supabase.co/rest/v1/rpc/update_session', { method: 'POST', headers: { apikey: 'sb_publishable_1Zsq-zFU3nmqYFrSxXzKGQ_k-peb2bV', 'Content-Type': 'application/json' }, body: JSON.stringify({ p_code: vc, p_data: { rev: 9999, players: [] }, p_origin: 'x' }) });
    return (await r.json())[0];
  }, row.view_code);
  assert.strictEqual(wr.updated, false, 'lesekoden kan ikke skrive');
  assert.strictEqual(wr.row_found, false);
  console.log('ok   lesekoden kan ikke skrive');
  // gammel rev avvises på ekte
  const old = await A.page.evaluate(async (code) => {
    const r = await fetch('https://nueguoxkynwgmynccaro.supabase.co/rest/v1/rpc/update_session', { method: 'POST', headers: { apikey: 'sb_publishable_1Zsq-zFU3nmqYFrSxXzKGQ_k-peb2bV', 'Content-Type': 'application/json' }, body: JSON.stringify({ p_code: code, p_data: { rev: 0, players: [] }, p_origin: 'x' }) });
    return (await r.json())[0];
  }, code);
  assert.strictEqual(old.updated, false, 'gammel skriving avvist');
  console.log('ok   gammel skriving avvist (rev ' + old.current_rev + ')');
  console.log('feil A', A.errs, 'B', B.errs, 'P', P.errs);
  console.log('CSP A', A.csp.slice(0, 3), 'B', B.csp.slice(0, 3), 'P', P.csp.slice(0, 3));
  assert.deepStrictEqual(A.errs.concat(B.errs, P.errs), []);
  console.log(pingOk ? 'RESULTAT: alt ok, ping virker' : 'RESULTAT: ok, men ping kom ikke fram (poll tok over)');
  await b.close(); srv.close();
})().catch(async e => { console.error('FEIL', e.message); process.exit(1); });
