const { makeBackend, loadApp, team, KEYS, sleep } = require('./h');
const assert = require('assert');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const only = process.argv[2];
const MIN = 60000;

function sharedPair(extra, ownerExtra) {
  const be = makeBackend();
  const base = team(Object.assign({ sessionOwnerDeviceId: 'devA', participants: [{ deviceId: 'devA', joinedAt: 1 }, { deviceId: 'devB', joinedAt: 2 }] }, extra));
  be.insertSession('123', base);
  const st = (id) => ({ [KEYS.state]: base, [KEYS.code]: '123', [KEYS.dev]: id });
  const A = loadApp(be, { storage: st('devA') });
  const B = loadApp(be, { storage: st('devB') });
  return { be, A, B, base };
}
const row = (be) => be.tables.sessions['123'];
const clickAs = (d, id) => d.w.document.getElementById(id).click();

// ---------- TID / ANGRE ----------
test('T1a angre etter pause: klokka står og hopper ikke', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5);
  A.t.togglePlayPause();
  A.adv(2 * MIN);
  A.t.performSwap('p1', 'p4'); A.t.saveState(); A.t.renderAll();
  A.adv(1 * MIN);
  A.t.togglePlayPause();            // pause, f.eks. i pausen
  const clockAtPause = A.t.matchClockElapsed(A.clock.t);
  A.adv(10 * MIN);
  A.t.undoLastAction();
  assert.strictEqual(A.t.state.globalRunning, false, 'skal fortsatt stå på pause');
  assert.strictEqual(A.t.matchClockElapsed(A.clock.t), clockAtPause, 'klokka skal ikke hoppe');
  assert.deepStrictEqual(Array.from(A.t.state.onField).sort(), ['p1', 'p2', 'p3']);
  A.close();
});
test('T1b angre etter start: klokka går og tiden beholdes', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5);
  A.t.performSwap('p1', 'p4'); A.t.saveState(); A.t.renderAll();   // bytte mens pauset
  A.t.togglePlayPause();
  A.adv(5 * MIN);
  A.t.undoLastAction();
  assert.strictEqual(A.t.state.globalRunning, true, 'klokka skal gå');
  assert.strictEqual(A.t.matchClockElapsed(A.clock.t), 5 * MIN, 'spilletiden skal være der');
  A.close();
});
test('T2 fjern dødtid: pause i 10 min fjerner ikke spilt tid', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5);
  A.t.togglePlayPause(); A.adv(8 * MIN);
  A.t.togglePlayPause(); A.adv(10 * MIN);
  A.t.openSettings(false);
  assert.strictEqual(A.els().removeDeadTimeBtn.hidden, true, 'knappen skal skjules når klokka står');
  const before = A.t.matchClockElapsed(A.clock.t);
  A.click('removeDeadTimeBtn'); A.click('removeDeadTimeConfirmBtn');
  assert.strictEqual(A.t.matchClockElapsed(A.clock.t), before, 'ingen spilletid skal forsvinne');
  A.close();
});
test('T2b fjern dødtid mens klokka går: bare tiden siden siste handling', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5);
  A.t.togglePlayPause(); A.adv(8 * MIN);
  A.t.performSwap('p1', 'p4'); A.t.saveState(); A.t.renderAll();
  A.adv(4 * MIN);
  A.t.openSettings(false);
  assert.strictEqual(A.els().removeDeadTimeBtn.hidden, false);
  A.click('removeDeadTimeBtn'); A.click('removeDeadTimeConfirmBtn');
  assert.strictEqual(A.t.matchClockElapsed(A.clock.t), 8 * MIN);
  A.close();
});
test('T3 sinceTs i fremtiden (klokkeavvik) gir ikke negativ tid', async () => {
  const be = makeBackend();
  const s = team({ globalRunning: true }); s.fieldTimers.p1.sinceTs = 1800000000000 + 5000; s.matchClock.sinceTs = 1800000000000 + 5000;
  const A = loadApp(be, { storage: { [KEYS.state]: s } });
  await sleep(5);
  assert.ok(A.t.fieldElapsed('p1', A.clock.t) >= 0);
  assert.ok(A.t.matchClockElapsed(A.clock.t) >= 0);
  A.close();
});
test('U1 angre ruller ikke tilbake eierskap, kamptid eller motstander', async () => {
  const { A, B } = sharedPair();
  await sleep(10);
  A.t.performSwap('p1', 'p4'); A.t.saveState();
  await sleep(5);
  A.t.state.matchDurationMs = 20 * MIN;
  A.t.state.opponentName = 'Brann';
  A.t.state.sessionOwnerDeviceId = 'devB';
  A.t.saveState();
  await sleep(5);
  // B adopterer og A beholder sin angrestabel (A sin egen endring)
  A.t.undoLastAction();
  assert.strictEqual(A.t.state.sessionOwnerDeviceId, 'devB', 'eierskap skal ikke rulles tilbake');
  assert.strictEqual(A.t.state.matchDurationMs, 20 * MIN, 'kamptid skal ikke rulles tilbake');
  assert.strictEqual(A.t.state.opponentName, 'Brann', 'motstander skal ikke rulles tilbake');
  assert.deepStrictEqual(Array.from(A.t.state.onField).sort(), ['p1', 'p2', 'p3'], 'selve byttet skal angres');
  A.close(); B.close();
});
test('U2 angre gjenoppretter continueCount', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team({ continueCount: 2 }) } });
  await sleep(5);
  A.t.performSwap('p1', 'p4'); A.t.saveState();
  A.t.state.continueCount = 0;
  A.t.undoLastAction();
  assert.strictEqual(A.t.state.continueCount, 2);
  A.close();
});

// ---------- SYNK ----------
test('S1 gammel enhet overskriver ikke serveren ved gjentilkobling, og henter ny state', async () => {
  const { be, A, B } = sharedPair();
  await sleep(15);
  B.client.offline = true;
  for (let i = 0; i < 5; i++) { const f = A.t.state.onField[0], b = A.t.state.onBench[0]; A.t.performSwap(f, b); A.t.saveState(); await sleep(2); }
  const good = A.t.state.swapCount;
  assert.strictEqual(good, 5);
  assert.strictEqual(row(be).data.swapCount, 5);
  B.client.offline = false;
  B.client.rejoin();
  await sleep(30);
  assert.strictEqual(row(be).data.swapCount, 5, 'serveren skal beholde A sine 5 bytter');
  assert.strictEqual(B.t.state.swapCount, 5, 'B skal ha hentet A sine bytter');
  A.close(); B.close();
});
test('S1b utdatert skriving som kommer sent blir avvist av serveren', async () => {
  const { be, A, B } = sharedPair();
  await sleep(15);
  B.client.offline = true;
  for (let i = 0; i < 3; i++) { const f = A.t.state.onField[0], b = A.t.state.onBench[0]; A.t.performSwap(f, b); A.t.saveState(); await sleep(2); }
  B.client.offline = false; B.client.realtimeDown = true;
  B.t.state.opponentName = 'Gammel'; B.t.pushRemoteState();    // B tror den er oppdatert
  await sleep(30);
  assert.strictEqual(row(be).data.swapCount, 3, 'serveren skal ikke rulles tilbake');
  A.close(); B.close();
});
test('S1c skjermlås uten endringer skriver ikke til serveren', async () => {
  const { be, A, B } = sharedPair();
  await sleep(20);
  const w = be.writes, rev = row(be).data.rev;
  B.setHidden(true);
  await sleep(10);
  assert.strictEqual(be.writes, w, 'ingen skriving');
  assert.strictEqual(row(be).data.rev, rev, 'rev uendret');
  A.close(); B.close();
});
test('S1d skjermlås hos B tømmer ikke A sin angrehistorikk', async () => {
  const { A, B } = sharedPair();
  await sleep(20);
  A.t.performSwap('p1', 'p4'); A.t.saveState();
  await sleep(10);
  assert.strictEqual(A.t.undoLen, 1);
  B.setHidden(true);
  await sleep(10);
  assert.strictEqual(A.t.undoLen, 1, 'angre skal overleve at B låser skjermen');
  A.close(); B.close();
});
test('S1e lokale endringer gjort uten nett sendes når nettet er tilbake', async () => {
  const { be, A, B } = sharedPair();
  await sleep(15);
  A.client.offline = true;
  A.t.performSwap('p1', 'p4'); A.t.saveState();
  await sleep(10);
  A.client.offline = false;
  A.w.dispatchEvent(new A.w.Event('online'));
  await sleep(30);
  assert.strictEqual(row(be).data.swapCount, 1, 'serveren skal ha byttet');
  assert.strictEqual(B.t.state.swapCount, 1, 'B skal ha byttet');
  A.close(); B.close();
});
test('S2 leser får ny state etter skjermlås (ingen push, men henter)', async () => {
  const { be, A, B } = sharedPair({ shareEditable: false });
  await sleep(20);
  assert.strictEqual(B.t.canEdit(), false);
  B.client.realtimeDown = true;
  A.t.performSwap('p1', 'p4'); A.t.saveState();
  await sleep(10);
  assert.strictEqual(B.t.state.swapCount, 0, 'B har gått glipp av oppdateringen');
  B.client.realtimeDown = false;
  const w = be.writes;
  B.setHidden(true); B.setHidden(false);
  await sleep(30);
  assert.strictEqual(B.t.state.swapCount, 1, 'B skal ha hentet');
  assert.strictEqual(be.writes, w, 'leseren skal ikke skrive');
  A.close(); B.close();
});
test('S3 gjenbrukt kode: gammel enhet overskriver ikke en annen sin økt', async () => {
  const be = makeBackend();
  const other = team({ players: [{ id: 'x1', name: 'Fremmed' }], onField: ['x1'], onBench: [], fieldTimers: {}, benchTimers: {}, rev: 3, sessionUid: 'ny-okt', sessionOwnerDeviceId: 'fremmed' });
  be.insertSession('123', other, 'fremmed');
  const mine = team({ rev: 500, sessionUid: 'gammel-okt', sessionOwnerDeviceId: 'devA' });
  const A = loadApp(be, { storage: { [KEYS.state]: mine, [KEYS.code]: '123', [KEYS.dev]: 'devA' } });
  await sleep(30);
  assert.strictEqual(row(be).data.players[0].name, 'Fremmed', 'fremmed økt skal være urørt');
  assert.strictEqual(A.t.sessionCode, null, 'enheten skal ha koblet fra');
  assert.strictEqual(A.t.state.players.length, 5, 'egen kamp beholdes lokalt');
  A.close();
});
test('S4 hentet nyere state før auto-pause-sjekk ved oppvåkning', async () => {
  const { be, A, B } = sharedPair({ globalRunning: true });
  await sleep(20);
  B.client.realtimeDown = true;
  // A er aktiv i 2 timer; B sover (og går glipp av alt)
  A.adv(120 * MIN); B.adv(120 * MIN);
  A.t.performSwap('p1', 'p4'); A.t.saveState();
  await sleep(10);
  B.client.realtimeDown = false;
  B.setHidden(true); B.setHidden(false);
  await sleep(30);
  assert.strictEqual(row(be).data.globalRunning, true, 'serveren skal ikke fryses av B');
  assert.strictEqual(B.t.state.globalRunning, true, 'B skal ha fulgt A');
  A.close(); B.close();
});

test('S5 rad uten rev (finnes i produksjon): skriving kommer likevel fram, uten løkke', async () => {
  const be = makeBackend();
  const base = team({ sessionOwnerDeviceId: 'devA', participants: [{ deviceId: 'devA', joinedAt: 1 }] });
  be.insertSession('123', Object.assign({}, base, { rev: undefined }));
  delete be.tables.sessions['123'].data.rev;
  const A = loadApp(be, { storage: { [KEYS.state]: base, [KEYS.code]: '123', [KEYS.dev]: 'devA' } });
  await sleep(20);
  A.t.performSwap('p1', 'p4'); A.t.saveState();
  await sleep(40);
  assert.strictEqual(row(be).data.swapCount, 1, 'byttet skal være lagret');
  assert.ok(typeof row(be).data.rev === 'number', 'raden har rev nå');
  const w = be.writes; await sleep(60);
  assert.strictEqual(be.writes, w, 'ingen skriveløkke');
  A.close();
});
test('S6 hengende første henting blokkerer ikke synk for godt', async () => {
  const be = makeBackend();
  const base = team({ sessionOwnerDeviceId: 'devA', participants: [{ deviceId: 'devA', joinedAt: 1 }] });
  be.insertSession('123', base);
  const A = loadApp(be, { prepare: c => { c.hang = true; }, storage: { [KEYS.state]: base, [KEYS.code]: '123', [KEYS.dev]: 'devA' } });
  await sleep(20);
  A.t.performSwap('p1', 'p4'); A.t.saveState();           // kan ikke sendes ennå
  await sleep(8100);                                      // tidsgrensen på hentingen
  A.client.hang = false;
  A.client.rejoin();
  await sleep(40);
  assert.strictEqual(row(be).data.swapCount, 1, 'det lokale byttet skal ha nådd serveren');
  A.close();
});
test('S7 sent svar fra en oppgitt henting ruller ikke leseren tilbake', async () => {
  const be = makeBackend();
  const base = team({ sessionOwnerDeviceId: 'devA', shareEditable: false, participants: [{ deviceId: 'devA', joinedAt: 1 }, { deviceId: 'devB', joinedAt: 2 }], rev: 5 });
  be.insertSession('123', base);
  const B = loadApp(be, { prepare: c => { c.slowNextGet = 8600; }, storage: { [KEYS.state]: base, [KEYS.code]: '123', [KEYS.dev]: 'devB' } });
  await sleep(20);
  row(be).data = Object.assign({}, row(be).data, { rev: 9, swapCount: 7 });  // kampen går videre
  await sleep(8100);
  B.client.rejoin();                                       // ny henting finner rev 9
  await sleep(40);
  assert.strictEqual(B.t.state.rev, 9);
  await sleep(600);                                        // det gamle svaret (rev 5) kommer nå
  assert.strictEqual(B.t.state.rev, 9, 'skal ikke rulles tilbake');
  assert.strictEqual(B.t.state.swapCount, 7);
  B.close();
});

test('F1 to trenere bytter samtidig: begge byttene overlever', async () => {
  const { be, A, B } = sharedPair({ onField: ['p1', 'p2', 'p3'], onBench: ['p4', 'p5'] });
  await sleep(20);
  // Begge handler før noen av dem har hørt om den andre
  A.client.realtimeDown = true; B.client.realtimeDown = true;
  A.t.performSwap('p1', 'p4'); A.t.saveState();
  B.t.performSwap('p2', 'p5'); B.t.saveState();
  await sleep(40);
  A.client.realtimeDown = false; B.client.realtimeDown = false;
  A.client.rejoin(); B.client.rejoin();
  await sleep(50);
  const f = Array.from(row(be).data.onField).sort();
  assert.deepStrictEqual(f, ['p3', 'p4', 'p5'], 'begge byttene: ' + JSON.stringify(f));
  assert.deepStrictEqual(Array.from(A.t.state.onField).sort(), f, 'A er enig');
  assert.deepStrictEqual(Array.from(B.t.state.onField).sort(), f, 'B er enig');
  assert.strictEqual(row(be).data.swapCount, 2);
  assert.strictEqual(A.t.pendingOpsLen + B.t.pendingOpsLen, 0, 'ingenting venter');
  A.close(); B.close();
});
test('F2 mål registrert uten nett blandes inn når en annen har byttet imens', async () => {
  const { be, A, B } = sharedPair();
  await sleep(20);
  A.client.offline = true;
  const gid = 'home';
  A.t.state.goalLog = A.t.state.goalLog;
  A.t.recordOp({ t: 'goal', goal: { id: 'g-1', team: 'home', playerId: 'p1', at: A.t.nowTs(), matchMs: 0 } }); A.t.saveState();
  for (let i = 0; i < 3; i++) { const f = B.t.state.onField[0], b = B.t.state.onBench[0]; B.t.performSwap(f, b); B.t.saveState(); await sleep(3); }
  await sleep(10);
  A.client.offline = false;
  A.w.dispatchEvent(new A.w.Event('online'));
  await sleep(50);
  assert.strictEqual(row(be).data.swapCount, 3, 'B sine bytter er med');
  assert.strictEqual(row(be).data.goalLog.length, 1, 'A sitt mål er med');
  assert.strictEqual(B.t.state.goalLog.length, 1, 'B har fått målet');
  A.close(); B.close();
});
test('F3 samme handling spilles ikke av to ganger', async () => {
  const { be, A, B } = sharedPair();
  await sleep(20);
  A.t.performSwap('p1', 'p4'); A.t.saveState();
  await sleep(15);
  const saved = row(be).data.swapCount;
  // Svaret forsvant: appen tror fortsatt at handlingen venter
  A.t.recordOp({ t: 'trim', ms: 1000 }); A.t.saveState();
  await sleep(15);
  assert.strictEqual(saved, 1);
  assert.strictEqual(A.t.pendingOpsLen, 0);
  A.close(); B.close();
});
test('F4 angre som kolliderer: serveren vinner og treneren får beskjed', async () => {
  const { be, A, B } = sharedPair();
  await sleep(20);
  A.t.performSwap('p1', 'p4'); A.t.saveState();
  await sleep(15);
  A.client.realtimeDown = true; B.client.realtimeDown = true;
  B.t.performSwap('p2', 'p5'); B.t.saveState();
  await sleep(10);
  A.t.undoLastAction();
  await sleep(40);
  assert.strictEqual(row(be).data.swapCount, 2, 'B sitt bytte er ikke borte');
  assert.ok(A.els().autoPauseNotice.classList.contains('show'), 'beskjed vist');
  A.close(); B.close();
});
test('C1 to telefoner med 30 s avvik viser samme spillertid', async () => {
  const be = makeBackend();
  if (!be.hasRpc) return; // serverklokka kommer fra funksjonene
  const base = team({ sessionOwnerDeviceId: 'devA', participants: [{ deviceId: 'devA', joinedAt: 1 }, { deviceId: 'devB', joinedAt: 2 }] });
  be.insertSession('123', base);
  const A = loadApp(be, { skewMs: 30000, storage: { [KEYS.state]: base, [KEYS.code]: '123', [KEYS.dev]: 'devA' } });
  const B = loadApp(be, { skewMs: -30000, storage: { [KEYS.state]: base, [KEYS.code]: '123', [KEYS.dev]: 'devB' } });
  await sleep(30);
  A.t.togglePlayPause();
  await sleep(20);
  A.adv(60000); B.adv(60000);
  const ta = A.t.matchClockElapsed(A.t.nowTs()), tb = B.t.matchClockElapsed(B.t.nowTs());
  assert.ok(Math.abs(ta - 60000) < 2000, 'A viser ' + ta);
  assert.ok(Math.abs(tb - 60000) < 2000, 'B viser ' + tb);
  A.close(); B.close();
});
test('R1 ny delt økt får kode fra serveren når funksjonene finnes, gammel vei ellers', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team(), [KEYS.dev]: 'devA' } });
  await sleep(5);
  let code; A.t.createNewSession(c => { code = c; });
  await sleep(25);
  assert.ok(code);
  if (be.hasRpc) assert.ok(/^[A-Z]/.test(code) && code.length === 6, code); else assert.ok(/^[0-9]{3}$/.test(code), code);
  A.t.performSwap('p1', 'p4'); A.t.saveState();
  await sleep(15);
  assert.strictEqual(be.tables.sessions[code].data.swapCount, 1, 'skriving virker');
  A.close();
});

// ---------- BEDRE LØSNINGER ----------
test('B1 Kampslutt på ett ark: to valg og én knapp, ingen flere spørsmål', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team({ opponentName: 'Brann', opponentAbbr: 'BRA', goalLog: [{ id: 'g', team: 'home', playerId: 'p1', at: 1, matchMs: 1000 }] }) } });
  await sleep(5);
  A.t.togglePlayPause(); A.adv(5 * MIN);
  A.click('endBtn');
  assert.ok(A.open('endMatchModal'));
  assert.ok(/2?1 – 0 BRA/.test(A.els().endSheetScore.textContent), A.els().endSheetScore.textContent);
  A.els().endSaveToggle.checked = true; A.els().endReorgToggle.checked = false;
  A.els().endNextOpponent.value = 'Sandefjord BK';
  A.click('endPeriodBtn');
  await sleep(10);
  assert.strictEqual(A.open('endMatchModal'), false);
  assert.strictEqual(A.q('.modal.open'), null, 'ingen flere vinduer');
  assert.strictEqual(A.t.state.goalLog.length, 0);
  assert.strictEqual(A.t.state.opponentName, 'Sandefjord BK');
  assert.strictEqual(A.t.state.opponentAbbr, 'SB');
  assert.strictEqual(Object.keys(be.tables.match_history).length, 1, 'lagret');
  assert.ok(A.els().undoToast.classList.contains('show'));
  A.click('undoToastBtn');
  assert.ok(A.open('matchSummaryModal'), 'rapporten åpnes');
  A.close();
});
test('B2 Angre-stripe etter bytte, og mål krever ikke bekreftelse etter 8 s', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5); A.t.renderAll();
  A.t.handleTap('p1', 'field'); A.t.handleTap('p4', 'bench');
  assert.ok(A.els().undoToast.classList.contains('show'));
  assert.ok(/Ola ⇄ Liv/.test(A.els().undoToastText.textContent), A.els().undoToastText.textContent);
  A.click('undoToastBtn');
  assert.deepStrictEqual(Array.from(A.t.state.onField).sort(), ['p1', 'p2', 'p3']);
  assert.strictEqual(A.els().undoToast.classList.contains('show'), false);
  A.close();
});
test('B3 lang angre: 20 steg', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5);
  for (let i = 0; i < 12; i++) { const f = A.t.state.onField[0], b = A.t.state.onBench[0]; A.t.performSwap(f, b); A.t.saveState(); }
  assert.strictEqual(A.t.undoLen, 12);
  for (let i = 0; i < 12; i++) A.t.undoLastAction();
  assert.strictEqual(A.t.state.swapCount, 0);
  A.close();
});
test('B4 Neste bytte vises alltid og utføres med ett trykk', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5); A.t.renderAll();
  A.t.togglePlayPause(); A.adv(1 * MIN); A.t.renderMatchPanels(A.clock.t);
  assert.strictEqual(A.els().nextSwapBar.hidden, false);
  assert.ok(/om 2:00/.test(A.els().nextSwapLabel.textContent), A.els().nextSwapLabel.textContent);
  A.adv(3 * MIN); A.t.renderMatchPanels(A.clock.t);
  assert.ok(/ut ⇄ .* inn/.test(A.els().nextSwapNames.textContent));
  assert.strictEqual(A.els().nextSwapLabel.textContent, 'Neste bytte');
  A.click('nextSwapBtn');
  assert.strictEqual(A.t.state.swapCount, 1);
  A.close();
});
test('B5 lag på banen fra start', async () => {
  const be = makeBackend();
  const A = loadApp(be, {});
  await sleep(5);
  A.t.openSettings(true);
  const inputs = A.qa('#nameRows input');
  ['Ola', 'Kari', 'Per', 'Liv', 'Nils'].forEach((n, i) => { inputs[i].value = n; });
  A.t.saveSettings();
  assert.strictEqual(A.t.state.onField.length, 3);
  assert.strictEqual(A.t.state.onBench.length, 2);
  A.close();
});
test('B6 leser kan trykke på spiller og se info, men ikke flytte', async () => {
  const { A, B } = sharedPair({ shareEditable: false });
  await sleep(20); B.t.renderAll();
  const tok = B.q('#field [data-id="p1"]');
  const ev = new B.w.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  tok.dispatchEvent(ev);
  assert.ok(B.t.selected && B.t.selected.id === 'p1');
  assert.strictEqual(B.t.state.swapCount, 0);
  A.close(); B.close();
});
test('B7 lagnavn følger økten, og Nøtterøy er ikke standard for nye', async () => {
  const be = makeBackend();
  const N = loadApp(be, {});
  await sleep(5);
  assert.strictEqual(N.t.loadCoachDefaults().homeTeamName, 'Hjemmelag');
  N.close();
  const G = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5);
  assert.strictEqual(G.t.loadCoachDefaults().homeTeamName, 'Nøtterøy', 'gammel enhet beholder laget');
  G.close();
  const base = team({ homeTeamName: 'Brann', homeTeamAbbr: 'BRA', sessionOwnerDeviceId: 'x' });
  be.insertSession('123', base);
  const C = loadApp(be, { storage: { [KEYS.state]: base, [KEYS.code]: '123', [KEYS.dev]: 'y' } });
  await sleep(15); C.t.renderAll();
  assert.strictEqual(C.els().homeTeamLabel.textContent, 'BRA');
  C.close();
});
test('B8 navn kan rettes på spiller på banen, men hen kan ikke fjernes', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5);
  A.t.openSettings(false);
  const row = A.q('#nameRows .name-row[data-id="p1"]');
  const input = row.querySelector('input');
  assert.strictEqual(input.disabled, false);
  assert.strictEqual(row.querySelector('.name-row-clear-btn'), null);
  input.value = 'Ola Rettet';
  A.t.saveSettings();
  assert.strictEqual(A.t.state.players.find(p => p.id === 'p1').name, 'Ola Rettet');
  assert.ok(A.t.state.onField.includes('p1'));
  A.close();
});
test('B9 kodeformat: gammel tresifret og ny, ikke forvekslbare tegn', async () => {
  const be = makeBackend();
  const A = loadApp(be, {});
  await sleep(5);
  ['123', 'K7M2QX'].forEach(c => assert.ok(A.t.isValidSessionCode(c), c));
  ['12', '12A', 'K7M2Q', '7KM2QX', 'K7M2Q0', 'K7M2QO1', 'k7m2qx'].forEach(c => assert.ok(!A.t.isValidSessionCode(c), c));
  A.close();
});

test('B10 nytt lag: knappene som krever et lag er skjult, og det som er skrevet inn forsvinner ikke', async () => {
  const be = makeBackend();
  const A = loadApp(be, {});
  await sleep(5);
  A.t.openSettings(true);
  ['openPlanBtn', 'openCupBtn', 'exportBtn'].forEach(id => assert.strictEqual(A.q('#' + id).hidden, true, id + ' skjult'));
  assert.strictEqual(A.q('#legendBtn').hidden, false);
  assert.strictEqual(A.q('#joinExistingBtn').hidden, false);
  A.close();
});
test('B11 lag i gang: Bytteplan og Cup legger seg oppå, innstillingene og endringene består', async () => {
  const be = makeBackend();
  for (const [btn, close] of [['openPlanBtn', 'planCloseBtn'], ['openCupBtn', 'cupCloseBtn']]) {
    const A = loadApp(be, { storage: { [KEYS.state]: team() } });
    await sleep(5);
    A.t.openSettings(false);
    assert.strictEqual(A.q('#' + btn).hidden, false, btn + ' synlig');
    const input = A.q('#nameRows .name-row[data-id="p4"] input');
    input.value = 'Endret Navn';
    A.click(btn);
    assert.ok(A.open('settingsModal'), 'innstillingene er åpne under');
    A.click(close);
    assert.ok(A.open('settingsModal'), 'tilbake i innstillingene');
    assert.strictEqual(A.q('#nameRows .name-row[data-id="p4"] input').value, 'Endret Navn');
    A.close();
  }
});

test('B12 Neste bytte: ved likt trekkes én tilfeldig som blir stående, også når byttetiden nås', async () => {
  const seen = new Set();
  for (let round = 0; round < 12; round++) {
    const be = makeBackend();
    const A = loadApp(be, { storage: { [KEYS.state]: team() } });
    await sleep(2); A.t.renderAll();
    A.t.togglePlayPause();
    const first = A.t.computeNextSwap(A.clock.t);
    seen.add(first.fieldId + '|' + first.benchId);
    for (let i = 0; i < 300; i++) { // ti minutter, før og etter byttetiden på 3 min
      A.adv(2000);
      const n = A.t.computeNextSwap(A.clock.t);
      assert.strictEqual(n.fieldId + n.benchId, first.fieldId + first.benchId, 'samme spillere');
    }
    A.close();
  }
  assert.ok(seen.size > 1, 'trekningen er tilfeldig: ' + seen.size);
});
test('B13 Neste bytte: bytter spiller når noen faktisk ikke lenger står likt, og knappen bytter den som vises', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(2); A.t.renderAll();
  A.t.togglePlayPause(); A.adv(4 * MIN);
  const n = A.t.computeNextSwap(A.clock.t);
  A.t.renderMatchPanels(A.clock.t);
  A.click('nextSwapBtn');
  assert.ok(A.t.state.onBench.includes(n.fieldId) && A.t.state.onField.includes(n.benchId), 'det som ble vist');
  A.adv(1000);
  const m = A.t.computeNextSwap(A.clock.t);
  assert.notStrictEqual(m.fieldId, n.benchId, 'den som nettopp kom inn er ikke neste ut');
  assert.notStrictEqual(m.benchId, n.fieldId, 'den som nettopp gikk ut er ikke neste inn');
  A.close();
});

// ---------- NYE FUNKSJONER ----------
test('N-plan alle får omtrent like mye, keeper utenfor rotasjonen', async () => {
  const be = makeBackend();
  const ids = ['a','b','c','d','e','f','g','h','i','j'];
  const s = team({ players: ids.map(i => ({ id: i, name: i.toUpperCase() })), onField: ids.slice(0, 7), onBench: ids.slice(7), fieldSize: 7, hasKeeper: true, matchDurationMs: 25 * MIN, defaultDurationMs: 5 * MIN,
    fieldTimers: Object.fromEntries(ids.slice(0, 7).map(i => [i, { baseElapsedMs: 0, sinceTs: 0 }])), benchTimers: Object.fromEntries(ids.slice(7).map(i => [i, { baseElapsedMs: 0, sinceTs: 0 }])) });
  const A = loadApp(be, { storage: { [KEYS.state]: s } });
  await sleep(5); A.t.renderAll();
  const plan = A.t.computeRotationPlan(A.clock.t);
  assert.ok(plan.changes.length >= 3, 'har bytter: ' + plan.changes.length);
  assert.strictEqual(plan.keeper, 'a');
  assert.ok(plan.changes.every(c => c.pairs.every(p => p.out !== 'a')), 'keeper byttes ikke');
  assert.ok(plan.spread <= 6 * MIN, 'jevn fordeling, forskjell ' + plan.spread / MIN);
  assert.ok(plan.projected.a === 25 * MIN, 'keeper spiller hele');
  // Justerer seg: etter et bytte endres planen
  A.t.setHistoryCache && 0;
  A.t.togglePlayPause(); A.adv(5 * MIN); A.t.performSwap('b', 'h'); A.t.saveState();
  const plan2 = A.t.computeRotationPlan(A.clock.t);
  assert.ok(plan2.changes.every(c => c.atMs > 5 * MIN));
  A.close();
});
test('N-omgang klokka stopper nøyaktig på halvtid, full tid varsles, glemt kampslutt lar seg ikke lure', async () => {
  const be = makeBackend();
  const A = loadApp(be, { audioState: 'running', storage: { [KEYS.state]: team({ halves: 2, matchDurationMs: 20 * MIN }) } });
  await sleep(5); A.t.renderAll();
  A.w.document.body.dispatchEvent(new A.w.Event('click', { bubbles: true }));
  A.t.togglePlayPause();
  A.adv(10 * MIN + 2000);
  const tones0 = A.w.__audio.tones;
  A.t.checkMatchAlarms(A.clock.t);
  assert.strictEqual(A.t.state.globalRunning, false, 'stoppet');
  assert.strictEqual(A.t.matchClockElapsed(A.clock.t), 10 * MIN, 'nøyaktig halvtid');
  assert.strictEqual(A.t.state.halfStage, 2);
  assert.ok(A.w.__audio.tones > tones0, 'fløyte');
  assert.strictEqual(A.open('forgottenModal'), false);
  A.t.togglePlayPause(); A.adv(10 * MIN);
  const t1 = A.w.__audio.tones;
  A.t.checkMatchAlarms(A.clock.t);
  assert.ok(A.w.__audio.tones > t1, 'fløyte ved full tid');
  const t2 = A.w.__audio.tones;
  A.t.checkMatchAlarms(A.clock.t);
  assert.strictEqual(A.w.__audio.tones, t2, 'bare én gang');
  A.close();
});
test('N-keeper 3v3 uten, 5v5 og 7v7 med; gamle økter beholder formasjonen', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5);
  assert.strictEqual(A.t.state.hasKeeper, undefined, 'gammel økt uten flagg');
  assert.strictEqual(A.t.fieldFormationRows(5).hasKeeper, false, 'gammel 5v5 uendret');
  assert.strictEqual(A.t.fieldFormationRows(7).hasKeeper, true);
  A.t.resetMatch();
  A.t.openSettings(true);
  const fmt = (n) => A.q('#fieldFormatSeg [data-size="' + n + '"]').click();
  const on = () => A.q('#keeperSeg .active').dataset.keeper;
  fmt(3); assert.strictEqual(on(), 'off', '3v3 uten');
  fmt(5); assert.strictEqual(on(), 'on', '5v5 med');
  fmt(7); assert.strictEqual(on(), 'on', '7v7 med');
  A.t.state.hasKeeper = true;
  assert.deepStrictEqual(Array.from(A.t.fieldFormationRows(5).rows), [1, 2, 2]);
  A.t.state.hasKeeper = false;
  assert.strictEqual(A.t.fieldFormationRows(7).hasKeeper, false);
  assert.strictEqual(A.t.fieldFormationRows(3).hasKeeper, false);
  A.close();
});
test('N-keeperrotasjon foreslår den som har stått minst, også over kamper', async () => {
  const be = makeBackend();
  const ids = ['a','b','c','d','e','f'];
  const s = team({ players: ids.map(i => ({ id: i, name: i.toUpperCase() })), onField: ids.slice(0, 5), onBench: ['f'], fieldSize: 5, hasKeeper: true,
    fieldTimers: Object.fromEntries(ids.slice(0, 5).map(i => [i, { baseElapsedMs: 0, sinceTs: 0 }])), benchTimers: { f: { baseElapsedMs: 0, sinceTs: 0 } } });
  const A = loadApp(be, { storage: { [KEYS.state]: s, spillerbytte_keeper_history_v1: JSON.stringify({ B: 600000, C: 300000, D: 300000, E: 300000, F: 300000 }) } });
  await sleep(5); A.t.renderAll();
  assert.strictEqual(A.t.keeperIdNow(), 'a');
  assert.strictEqual(A.t.suggestNextKeeper(A.clock.t).id, 'c', 'minst tid, alfabetisk ved likt');
  A.close();
});
test('N-stall stallen krysses av og fyller feltene', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { spillerbytte_roster_v1: JSON.stringify(['Emil', 'Noah', 'Jakob']) } });
  await sleep(5);
  A.t.openSettings(true);
  assert.strictEqual(A.els().settingsModal.querySelector('#attendanceWrap').hidden, false);
  const chips = A.qa('#attendanceChips .att-chip');
  assert.strictEqual(chips.length, 3);
  chips[0].click();
  assert.strictEqual(A.q('#nameRows input').value, 'Emil');
  assert.ok(A.q('#attendanceChips .att-chip').classList.contains('on'));
  A.q('#attendanceChips .att-chip').click();
  assert.strictEqual(A.q('#nameRows input').value, '');
  A.close();
});
test('N-rettferdighet linje med største forskjell', async () => {
  const be = makeBackend();
  const s = team({ cumulative: { p4: { fieldMs: 0, benchMs: 0 } } });
  const A = loadApp(be, { storage: { [KEYS.state]: s } });
  await sleep(5); A.t.renderAll();
  A.t.togglePlayPause(); A.adv(3 * MIN + 20000); A.t.renderMatchPanels(A.clock.t);
  assert.strictEqual(A.els().fairnessLine.hidden, false);
  assert.ok(/Størst forskjell 3:20/.test(A.els().fairnessLine.textContent), A.els().fairnessLine.textContent);
  A.close();
});
test('N-rapport tekst med resultat og scorere, tidslinje uten markup', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team({ opponentName: 'Brann' }) } });
  await sleep(5);
  const text = A.t.buildReportText({ opponentName: 'Brann', homeScore: 2, awayScore: 1, endedAt: 1, players: [{ name: 'Ola N', ms: 60000 }], goals: [{ team: 'home', scorerName: 'Ola N', matchMs: 200000 }] });
  assert.ok(/2–1 Brann/.test(text) && /Mål: Ola \(3:20\)/.test(text), text);
  const html = A.t.buildTimelineHtml({ players: [{ id: 'x', name: '<img id=pwn9>' }], events: [{ k: 'goal', team: 'home', a: 'x', ms: 1000 }] });
  assert.ok(!/<img/.test(html), html);
  A.close();
});
test('N-foreldre: egen lesekode, skriver aldri, rører ikke kampen på telefonen', async () => {
  const be = makeBackend();
  if (!be.hasRpc) return;
  const base = team({ sessionOwnerDeviceId: 'devA', opponentName: 'Brann', participants: [{ deviceId: 'devA', joinedAt: 1 }] });
  be.insertSession('K7M2QX', base); be.tables.sessions.K7M2QX.view_code = 'VIEWCODE';
  const mine = team({ opponentName: 'MinEgenKamp' });
  const P = loadApp(be, { storage: { [KEYS.state]: mine } });
  await sleep(5);
  const w0 = be.writes;
  P.t.startSpectator('VIEWCODE');
  await sleep(20);
  assert.strictEqual(P.t.state.opponentName, 'Brann', 'ser kampen');
  assert.strictEqual(P.t.canEdit(), false);
  assert.strictEqual(P.t.isMaster(), false);
  assert.strictEqual(P.t.state.participants.length, 0, 'ingen enhets-id-er');
  P.t.saveState(); P.t.pushRemoteState();
  P.setHidden(true); P.setHidden(false);
  await sleep(20);
  assert.strictEqual(be.writes, w0, 'ingen skriving');
  assert.ok(/MinEgenKamp/.test(P.w.localStorage.getItem(KEYS.state)), 'egen kamp urørt');
  const tok = P.q('#field [data-id="p1"]');
  tok.dispatchEvent(new P.w.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
  assert.ok(P.t.selected && P.t.selected.id === 'p1', 'kan trykke for å se tid');
  P.close();
});
test('N-cup neste kamp og forslag til motstander ved kampslutt', async () => {
  const be = makeBackend();
  const now = new Date(1800000000000);
  const pad = (n) => String(n).padStart(2, '0');
  const later = new Date(now.getTime() + 40 * MIN);
  const time = pad(later.getHours()) + ':' + pad(later.getMinutes());
  const A = loadApp(be, { storage: { [KEYS.state]: team({ cup: { name: 'Cup', matches: [{ id: 'm', time, opponent: 'Tønsberg' }] } }) } });
  await sleep(5); A.t.renderAll();
  assert.strictEqual(A.t.cupNextMatch(A.clock.t).opponent, 'Tønsberg');
  A.t.renderMatchPanels(A.clock.t);
  assert.ok(/Neste kamp .* mot Tønsberg \(om 40 min\)/.test(A.els().fairnessLine.textContent), A.els().fairnessLine.textContent);
  A.click('endBtn');
  assert.strictEqual(A.els().endNextOpponent.value, 'Tønsberg');
  A.close();
});
test('N-statistikk summerer spillere over kamper', async () => {
  const be = makeBackend();
  const A = loadApp(be, {});
  await sleep(5);
  const st = A.t.computeSeasonStats([
    { homeScore: 2, awayScore: 1, players: [{ name: 'Ola', ms: 600000, goals: 2 }, { name: 'Kari', ms: 0, goals: 0 }] },
    { homeScore: 0, awayScore: 0, players: [{ name: 'ola', ms: 300000, goals: 0 }, { name: 'Kari', ms: 300000, goals: 0 }] },
  ]);
  assert.strictEqual(st.matches, 2); assert.strictEqual(st.wins, 1); assert.strictEqual(st.draws, 1);
  const ola = st.players.find(p => p.name.toLowerCase() === 'ola');
  assert.strictEqual(ola.matches, 2); assert.strictEqual(ola.ms, 900000); assert.strictEqual(ola.goals, 2);
  assert.strictEqual(st.players.find(p => p.name === 'Kari').matches, 1, 'teller ikke kamp uten spilletid');
  A.close();
});
test('N-konto glemt passord og slett konto', async () => {
  const be = makeBackend();
  const A = loadApp(be, { client: { initialSession: { user: { id: 'u1' } } } });
  await sleep(10);
  A.els().accountLoginEmail.value = 'a@b.no';
  A.click('accountForgotLink');
  await sleep(5);
  assert.strictEqual(A.client.resetFor, 'a@b.no');
  assert.ok(/e-post/.test(A.els().accountLoginNote.textContent));
  A.client.authCb('PASSWORD_RECOVERY', { user: { id: 'u1' } });
  assert.ok(A.open('newPasswordModal'));
  A.q('#newPasswordInput').value = 'hemmelig123';
  A.click('newPasswordSaveBtn');
  await sleep(5);
  assert.strictEqual(A.client.newPassword, 'hemmelig123');
  assert.strictEqual(A.open('newPasswordModal'), false);
  A.click('deleteAccountBtn');
  assert.strictEqual(be.deleted, undefined, 'første trykk sletter ikke');
  A.click('deleteAccountBtn');
  await sleep(10);
  if (be.hasRpc) assert.strictEqual(be.deleted, true);
  else assert.ok(/ikke tilgjengelig/.test(A.q('#deleteAccountNote').textContent), 'forklarer');
  A.close();
});
test('N-design velges og huskes per enhet', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5);
  assert.strictEqual(A.t.currentDesign(), 'a');
  assert.strictEqual(A.qa('#designPicker .design-card').length, 5);
  A.q('#designPicker [data-design-id="d"]').click();
  assert.strictEqual(A.w.document.documentElement.getAttribute('data-design'), 'd');
  assert.strictEqual(A.w.localStorage.getItem('spillerbytte_design_v1'), 'd');
  assert.ok(A.q('#designPicker .design-card.on').dataset.designId === 'd');
  A.close();
});

// ---------- SIKKERHET ----------
test('X1 historikk: skadelig team-verdi blir ikke HTML', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5);
  A.t.setHistoryCache([{ id: 'h1', endedAt: 1, opponentName: 'x', opponentAbbr: '', homeScore: 1, awayScore: 0,
    players: [{ name: 'a', ms: 1, goals: 0 }], goals: [{ team: '"><img src=x id=pwn1>', scorerName: 's', matchMs: 1 }] }]);
  A.t.renderHistoryList();
  A.q('.history-row-main').click();
  assert.strictEqual(A.q('#pwn1'), null, 'ingen injisert element');
  A.close();
});
test('X2 delt state: skadelig spiller-id og poeng blir ikke HTML', async () => {
  const { A, B, be } = sharedPair();
  await sleep(15);
  const evil = JSON.parse(JSON.stringify(row(be).data));
  evil.rev = 99;
  evil.players[0].id = '"><img src=x id=pwn2>';
  evil.onField[0] = evil.players[0].id;
  evil.players[1].name = '<img src=x id=pwn3>';
  evil.matchHistory = [{ id: 'm', opponentName: 'x', homeScore: '<img src=x id=pwn4>', awayScore: 0, endedAt: 1, playerMs: {}, goals: [] }];
  evil.goalLog = [{ id: 'g', team: 'home', playerId: evil.players[0].id, at: 1, matchMs: 1 }];
  row(be).data = evil; row(be).origin = 'angriper'; be.broadcast(row(be));
  await sleep(20);
  A.t.openGoalPlayerModal('add');
  A.t.renderEndMatchSummary();
  A.t.renderCupModal();
  ['pwn2', 'pwn3', 'pwn4'].forEach(id => assert.strictEqual(A.q('#' + id), null, id));
  assert.strictEqual(A.errors.length, 0, 'ingen krasj: ' + A.errors[0]);
  A.close(); B.close();
});
test('N1 normalizeState tåler søppel uten å krasje tegning', async () => {
  const be = makeBackend();
  const s = team();
  s.players.push(null, { id: 5, name: 7 }, { id: 'p1', name: 'Duplikat' }, { name: 'uten id' });
  s.onField = ['p1', 'p1', 'finnes-ikke'];
  s.onBench = ['p2', 'p1'];                                     // p3-p5 ligger ingen steder
  s.fieldTimers = { p1: { baseElapsedMs: 'x', sinceTs: null } };
  s.matchClock = { baseElapsedMs: NaN };
  s.goalLog = [null, { team: 'home', playerId: 'p1', at: 1 }];
  const A = loadApp(be, { storage: { [KEYS.state]: s } });
  await sleep(5);
  const st = A.t.state;
  assert.ok(st.players.every(p => p && typeof p.id === 'string' && typeof p.name === 'string'), 'bare gyldige spillere');
  assert.strictEqual(new Set(st.players.map(p => p.id)).size, st.players.length, 'unike id-er');
  const zones = st.onField.concat(st.onBench);
  assert.strictEqual(new Set(zones).size, zones.length, 'ingen i to soner');
  st.players.forEach(p => assert.ok(zones.includes(p.id), p.id + ' skal ha en sone'));
  assert.ok(Number.isFinite(A.t.matchClockElapsed(A.clock.t)), 'klokke er tall');
  assert.ok(Number.isFinite(A.t.fieldElapsed('p1', A.clock.t)), 'timer er tall');
  assert.ok(st.goalLog.every(g => g && (g.team === 'home' || g.team === 'away')), 'goalLog ryddet');
  assert.strictEqual(A.errors.length, 0, 'ingen krasj: ' + A.errors[0]);
  A.close();
});

// ---------- OPPSTART ----------
test('O1 uten supabase-klient: kodefeltet sier ikke synkronisert', async () => {
  const be = makeBackend();
  const A = loadApp(be, { noSupabase: true, storage: { [KEYS.state]: team(), [KEYS.code]: '123' } });
  await sleep(5);
  const bar = A.els().sessionCodeBar;
  assert.notStrictEqual(bar.style.display, 'none', 'kodefelt synlig');
  assert.ok(bar.classList.contains('offline'), 'markert usynkronisert');
  A.close();
});
test('O3 oppstart med kode tegner lokal kamp straks selv om nettet henger', async () => {
  const be = makeBackend();
  be.insertSession('123', team());
  const A = loadApp(be, { prepare: c => { c.hang = true; }, storage: { [KEYS.state]: team(), [KEYS.code]: '123' } });
  await sleep(20);
  assert.strictEqual(A.qa('#field .token').length, 3, 'banen skal være tegnet');
  assert.strictEqual(A.qa('#bench .token').length, 2, 'benken skal være tegnet');
  A.close();
});

// ---------- HISTORIKK ----------
test('H1 lagring uten nett legges i kø og sendes senere, uten duplikat', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5);
  A.client.offline = true;
  A.t.archiveInProgressMatch(true);
  await sleep(10);
  assert.strictEqual(Object.keys(be.tables.match_history).length, 0);
  A.client.offline = false;
  A.w.dispatchEvent(new A.w.Event('online'));
  await sleep(30);
  assert.strictEqual(Object.keys(be.tables.match_history).length, 1, 'kampen skal være lagret');
  A.w.dispatchEvent(new A.w.Event('online'));
  await sleep(30);
  assert.strictEqual(Object.keys(be.tables.match_history).length, 1, 'ikke duplikat');
  A.close();
});
test('H1b køen overlever omstart av appen', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5);
  A.client.offline = true;
  A.t.archiveInProgressMatch(true);
  await sleep(10);
  const saved = {}; for (let i = 0; i < A.w.localStorage.length; i++) { const k = A.w.localStorage.key(i); saved[k] = A.w.localStorage.getItem(k); }
  A.close();
  const B = loadApp(be, { storage: saved });
  await sleep(30);
  assert.strictEqual(Object.keys(be.tables.match_history).length, 1);
  B.close();
});
test('H2 nettfeil i historikk vises ikke som tom liste', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5);
  A.client.offline = true;
  A.t.fetchAndRenderHistoryList();
  await sleep(10);
  assert.ok(!/Ingen kamper/.test(A.els().historyEmpty.textContent), 'skal ikke påstå at det ikke finnes kamper: ' + A.els().historyEmpty.textContent);
  A.close();
});

// ---------- BLI MED ----------
test('J1 bli med: egen kamp overskrives ikke uten bekreftelse', async () => {
  const be = makeBackend();
  be.insertSession('777', team({ players: [{ id: 'x', name: 'Fremmed' }], onField: ['x'], onBench: [], fieldTimers: {}, benchTimers: {} }));
  const A = loadApp(be, { storage: { [KEYS.state]: team({ matchClock: { baseElapsedMs: 5 * MIN, sinceTs: 0 } }) } });
  await sleep(5);
  const input = A.els().launcherJoinInput;
  input.value = '777'; input.dispatchEvent(new A.w.Event('input', { bubbles: true }));
  await sleep(10);
  assert.strictEqual(A.t.state.players.length, 5, 'egen kamp skal fortsatt være der');
  assert.strictEqual(A.t.sessionCode, null);
  assert.ok(A.open('joinConfirmModal'), 'skal spørre');
  A.click('joinConfirmCancelBtn');
  assert.strictEqual(A.t.state.players.length, 5);
  input.value = '777'; input.dispatchEvent(new A.w.Event('input', { bubbles: true }));
  await sleep(10);
  A.click('joinConfirmYesBtn');
  await sleep(10);
  assert.strictEqual(A.t.state.players[0].name, 'Fremmed');
  assert.strictEqual(A.t.sessionCode, '777');
  A.close();
});
test('J1b tom enhet blir med uten spørsmål', async () => {
  const be = makeBackend();
  be.insertSession('777', team());
  const A = loadApp(be, {});
  await sleep(5);
  const input = A.els().launcherJoinInput;
  input.value = '777'; input.dispatchEvent(new A.w.Event('input', { bubbles: true }));
  await sleep(10);
  assert.strictEqual(A.t.sessionCode, '777');
  A.close();
});
test('J2 nettfeil ved bli med sier ikke "fant ingen økt"', async () => {
  const be = makeBackend();
  const A = loadApp(be, {});
  await sleep(5);
  A.client.offline = true;
  const input = A.els().launcherJoinInput;
  input.value = '777'; input.dispatchEvent(new A.w.Event('input', { bubbles: true }));
  await sleep(10);
  assert.ok(!/Fant ingen/.test(A.els().launcherJoinError.textContent), A.els().launcherJoinError.textContent);
  A.close();
});

// ---------- FORLAT / EIER ----------
test('L1 første trykk på Ny økt kobler ikke deltaker fra', async () => {
  const { A, B } = sharedPair({ matchClock: { baseElapsedMs: MIN, sinceTs: 0 } });
  await sleep(15);
  assert.strictEqual(B.t.isMaster(), false);
  B.click('newSessionChoiceBtn');
  assert.strictEqual(B.t.sessionCode, '123', 'skal fortsatt være i økten etter første trykk');
  A.close(); B.close();
});
test('L2 ny lokal økt arver ikke fremmed eier/deltakere', async () => {
  const { A, B } = sharedPair({ matchClock: { baseElapsedMs: MIN, sinceTs: 0 } });
  await sleep(15);
  B.t.leaveSession();
  B.t.resetMatch();
  assert.strictEqual(B.t.state.sessionOwnerDeviceId, null);
  assert.strictEqual(B.t.state.participants.length, 0);
  A.close(); B.close();
});
test('L2b ny delt økt beholder ikke gamle deltakere', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team({ participants: [{ deviceId: 'gammel', joinedAt: 1 }] }), [KEYS.dev]: 'devA' } });
  await sleep(5);
  let code; A.t.createNewSession(c => { code = c; });
  await sleep(15);
  assert.ok(code);
  assert.deepStrictEqual(Array.from(A.t.state.participants).map(p => p.deviceId), ['devA']);
  A.close();
});
test('L3 eier som slår av deling overfører eierskap', async () => {
  const { be, A, B } = sharedPair();
  await sleep(15);
  A.t.openSettings(false);
  const tog = A.els().shareSessionToggle; tog.checked = false; tog.dispatchEvent(new A.w.Event('change'));
  await sleep(15);
  assert.strictEqual(A.t.sessionCode, null);
  assert.strictEqual(row(be).data.sessionOwnerDeviceId, 'devB', 'B skal bli eier');
  A.close(); B.close();
});

// ---------- KONTO ----------
test('A1b kontologin: ubekreftet e-post og nettfeil gir riktig melding, knappen slippes', async () => {
  const be = makeBackend();
  const A = loadApp(be, { client: { signIn: () => ({ data: {}, error: { code: 'email_not_confirmed', status: 400, message: 'x' } }) } });
  await sleep(5);
  A.els().accountLoginEmail.value = 'a@b.no'; A.els().accountLoginPassword.value = 'x';
  A.click('accountLoginBtn');
  await sleep(5);
  assert.ok(/bekreft/i.test(A.els().accountLoginNote.textContent), A.els().accountLoginNote.textContent);
  A.close();
  const C = loadApp(be, { client: { signIn: () => new Error('boom') } });
  await sleep(5);
  C.els().accountLoginEmail.value = 'a@b.no'; C.els().accountLoginPassword.value = 'x';
  C.click('accountLoginBtn');
  await sleep(5);
  assert.strictEqual(C.els().accountLoginBtn.disabled, false, 'knappen skal slippes');
  C.close();
});
test('A2 registrering: lagnavn og forkortelse overskrives ikke av kappløp', async () => {
  const be = makeBackend();
  const A = loadApp(be, { client: { latency: 2 } });
  await sleep(5);
  A.els().registerTeamName.value = 'Sandefjord BK';
  A.els().registerEmail.value = 'a@b.no'; A.els().registerPassword.value = 'pw'; A.els().registerPasswordRepeat.value = 'pw';
  A.click('registerSubmitBtn');
  await sleep(40);
  assert.strictEqual(be.tables.team_settings.u2.home_team_name, 'Sandefjord BK');
  assert.strictEqual(A.t.loadCoachDefaults().homeTeamName, 'Sandefjord BK');
  assert.strictEqual(A.t.loadCoachDefaults().homeTeamAbbr, 'SB', 'forkortelse skal følge lagnavnet');
  A.close();
});
test('A3 utlogging midt i henting krasjer ikke', async () => {
  const be = makeBackend();
  let rejection = null;
  const A = loadApp(be, { client: { latency: 5, initialSession: { user: { id: 'u1' } } } });
  A.w.addEventListener('unhandledrejection', e => { rejection = e; });
  const onRej = (e) => { rejection = e; };
  process.on('unhandledRejection', onRej);
  await sleep(2);
  A.client.sb.auth.signOut();
  await sleep(30);
  process.off('unhandledRejection', onRej);
  assert.strictEqual(rejection, null, 'ingen uhåndtert feil: ' + (rejection && rejection.message));
  A.close();
});

// ---------- DIVERSE ----------
test('M1 lyd låses opp på touchend/click, og igjen etter skjermlås', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5);
  A.w.document.body.dispatchEvent(new A.w.Event('touchend', { bubbles: true }));
  assert.strictEqual(A.w.__audio.created, 1, 'opprettet på touchend');
  assert.strictEqual(A.w.__audio.resumed, 1);
  A.w.document.body.dispatchEvent(new A.w.Event('click', { bubbles: true }));
  assert.strictEqual(A.w.__audio.resumed, 1, 'ikke på nytt når den går');
  A.close();
});
test('M2 lagret-melding viser ikke gammel feiltekst', async () => {
  const be = makeBackend();
  const A = loadApp(be, {});
  await sleep(5);
  A.els().settingsSavedNote.textContent = 'Lagret lokalt, men kontoen kunne ikke oppdateres akkurat nå.';
  A.click('settingsSaveBtn');
  assert.ok(/Lagret ✓/.test(A.els().settingsSavedNote.textContent), A.els().settingsSavedNote.textContent);
  A.close();
});
test('M3 valgt spiller nullstilles når en fjernoppdatering flytter hen', async () => {
  const { A, B, be } = sharedPair();
  await sleep(15);
  A.t.selected = { id: 'p1', zone: 'field' };
  B.t.performSwap('p1', 'p4'); B.t.saveState();
  await sleep(10);
  assert.strictEqual(A.t.selected, null);
  A.close(); B.close();
});
test('M4 trykk-bytte gir samme grønne blink som dra', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5); A.t.renderAll();
  A.t.handleTap('p1', 'field'); A.t.handleTap('p4', 'bench');
  assert.ok(A.q('#field [data-id="p4"]').classList.contains('swap-flash'));
  assert.ok(A.q('#bench [data-id="p1"]').classList.contains('swap-flash'));
  A.close();
});
test('M5 inngangsanimasjon bare på spillere som faktisk er flyttet', async () => {
  const be = makeBackend();
  const A = loadApp(be, { storage: { [KEYS.state]: team() } });
  await sleep(5); A.t.renderAll();
  A.t.renderAll();
  assert.strictEqual(A.qa('.token-enter').length, 0, 'ingen blink ved ny tegning uten endring');
  A.t.performSwap('p1', 'p4'); A.t.renderAll();
  assert.strictEqual(A.qa('.token-enter').length, 2, 'bare de to som ble byttet');
  A.close();
});
test('V1 versjonen stemmer i app.js og sw.js, og alle filer i APP_SHELL finnes', async () => {
  const fs = require('fs'), path = require('path');
  const ROOT = path.resolve(__dirname, '..');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.strictEqual(sw.match(/APP_VERSION = '([^']+)'/)[1], app, 'APP_VERSION i sw.js');
  assert.ok(sw.match(/CACHE_NAME = '([^']+)'/)[1].endsWith('v' + app), 'CACHE_NAME følger versjonen');
  const shell = eval(sw.match(/APP_SHELL = (\[[^\]]+\])/)[1]);
  shell.filter(f => f !== '/').forEach(f => assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' finnes'));
  ['style.css', 'designs.css', 'design-init.js', 'app.js', 'index.html'].forEach(f => assert.ok(shell.includes('/' + f), f + ' er med'));
});

(async () => {
  let pass = 0, fail = 0; const failed = [];
  for (const t of tests) {
    if (only && !t.name.startsWith(only)) continue;
    try { await Promise.race([t.fn(), sleep(12000).then(() => { throw new Error('timeout'); })]); pass++; console.log('  ok   ' + t.name); }
    catch (e) { fail++; failed.push(t.name); console.log('  FEIL ' + t.name + '\n         ' + String(e.message).split('\n')[0]); }
  }
  console.log(`\n${pass} ok, ${fail} feil av ${pass + fail}`);
  process.exit(0);
})();
