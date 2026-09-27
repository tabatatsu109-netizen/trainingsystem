const test = require('node:test');
const assert = require('node:assert/strict');
const HC = require('../js/heading-core.js');
const HF = require('../js/heading-form.js');
const HL = require('../js/heading-log.js');
const { L } = HC;

const near = (a, b, eps, msg) => assert.ok(a != null && Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

/* 真横から見た、右を向いた人（px）。身長 heightCm、ppc px/cm。
   lift: 地面からの浮き（cm）、lean: 上体の前傾（°、反ると −）、neck: 首の前への倒れ（°）、
   armUp: 手首を肩より上に（cm）、elbowUp: 肘を肩より上に（cm）、knee: 膝の曲げ（°、0=まっすぐ） */
function athlete({ heightCm = 160, ppc = 3, x = 500, lift = 0, lean = 0, neck = 0, armUp = -40, elbowUp = -25, knee = 0, facing = 1 } = {}) {
  const H = heightCm * ppc, ground = 900 - lift * ppc;
  const lm = [];
  for (let i = 0; i < 33; i++) lm.push({ x, y: 0, visibility: 0 });
  const set = (i, px, py) => { lm[i] = { x: px, y: py, visibility: 1 }; };
  const leg = H * 0.25, kr = knee * Math.PI / 180;
  const hipY = ground - H * 0.03 - 2 * leg * Math.cos(kr / 2);
  const hip = { x, y: hipY };
  const kneeP = { x: x + facing * leg * Math.sin(kr / 2), y: hipY + leg * Math.cos(kr / 2) };
  const ank = { x, y: kneeP.y + leg * Math.cos(kr / 2) };
  const lr = lean * Math.PI / 180, T = H * 0.3;
  const sh = { x: x + facing * T * Math.sin(lr), y: hipY - T * Math.cos(lr) };
  const nr = (lean + neck) * Math.PI / 180, N = H * 0.12;
  const hc = { x: sh.x + facing * N * Math.sin(nr), y: sh.y - N * Math.cos(nr) };
  const s = H * 0.06;
  set(L.nose, hc.x + facing * s * 0.8, hc.y + s * 0.1);
  set(L.leye, hc.x + facing * s * 0.5, hc.y - s * 0.15); set(L.reye, hc.x + facing * s * 0.5, hc.y - s * 0.15);
  set(L.lear, hc.x - facing * s * 0.2, hc.y); set(L.rear, hc.x - facing * s * 0.2, hc.y);
  set(L.lsh, sh.x, sh.y); set(L.rsh, sh.x, sh.y);
  set(L.lel, sh.x + facing * 10, sh.y - elbowUp * ppc); set(L.rel, sh.x + facing * 10, sh.y - elbowUp * ppc);
  set(L.lwr, sh.x + facing * 20, sh.y - armUp * ppc); set(L.rwr, sh.x + facing * 20, sh.y - armUp * ppc);
  set(L.lhip, hip.x, hip.y); set(L.rhip, hip.x, hip.y);
  set(L.lknee, kneeP.x, kneeP.y); set(L.rknee, kneeP.x, kneeP.y);
  set(L.lank, ank.x, ank.y); set(L.rank, ank.x, ank.y);
  set(L.lheel, ank.x - facing * H * 0.03, ground - H * 0.005); set(L.rheel, ank.x - facing * H * 0.03, ground - H * 0.005);
  set(L.lfoot, ank.x + facing * H * 0.06, ground); set(L.rfoot, ank.x + facing * H * 0.06, ground);
  return lm;
}
const ease = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
const G = 980;

/* 1 本のシャドーヘディング。flight 秒の滞空、takeoff 秒に踏み切り、swingAt 秒に振り戻しの真ん中。
   bodySwing=false なら首だけで振る */
function shadowRep({ fps = 60, takeoff = 1.0, flight = 0.5, swingAt = null, arch = 18, bodySwing = true, armUp = 15, pull = true, landKnee = 45, chin = 0, facing = 1, dur = 2.2 } = {}) {
  const frames = [], v0 = G * flight / 2, land = takeoff + flight;
  if (swingAt == null) swingAt = takeoff + flight / 2;
  for (let i = 0; i < Math.round(dur * fps); i++) {
    const t = i / fps;
    let lift = 0, knee = 0, lean = 0, neck = 0, arm = -40, elbow = -25;
    if (t > takeoff && t < land) { const u = t - takeoff; lift = v0 * u - G / 2 * u * u; }
    if (t > takeoff - 0.3 && t <= takeoff) knee = 60 * Math.sin((t - (takeoff - 0.3)) / 0.3 * Math.PI);   // 沈み込み
    if (t >= land && t < land + 0.4) knee = landKnee * Math.sin((t - land) / 0.4 * Math.PI);
    if (t > takeoff - 0.1) arm = armUp;
    if (t > takeoff - 0.1 && t < swingAt) elbow = 10;
    if (t >= swingAt) elbow = pull ? -15 : 10;
    // 反り: 踏み切り後に反って、swingAt を中心に 0.12 秒で前へ
    const archIn = ease((t - takeoff) / 0.15), sw = ease((t - (swingAt - 0.06)) / 0.12);
    if (bodySwing) lean = -arch * archIn * (1 - sw) + 12 * sw;
    else { lean = -arch * archIn; neck = 30 * sw; }
    neck -= chin * archIn * (1 - sw);
    frames.push({ t, lm: athlete({ lift, lean, neck, armUp: arm, elbowUp: elbow, knee, facing }), ball: null });
  }
  return frames;
}

test('analyzeRep（ボールなし）: 滞空時間から跳んだ高さ、頂点、振り戻しの時刻、頂点との差が出る', () => {
  const r = HF.analyzeRep(shadowRep({ swingAt: 1.25 }), { heightCm: 160, mode: 'shadow' });
  assert.ok(r.ok, r.error);
  near(r.m.jumpCm, 31, 2, '跳んだ高さ（0.5 秒の滞空 ≈ 30.6cm）');
  near(r.t.takeoff, 1.0, 0.03, '踏み切り');
  near(r.t.landing, 1.5, 0.03, '着地');
  near(r.t.apex, 1.25, 0.02, '頂点');
  near(r.t.impact, 1.25, 0.03, '振り戻し');
  near(r.m.timingSec, 0, 0.03, '頂点との差');
  assert.equal(r.g.timing, 'A');
  near(r.m.archDeg, 18, 3, '反り');
  assert.equal(r.g.air, 'A');
  assert.ok(r.m.swingDeg >= 20, `振りの大きさ ${r.m.swingDeg}`);
  assert.ok(r.m.bodyShare >= 0.9, `体で振った割合 ${r.m.bodyShare}`);
  assert.equal(r.g.swing, 'A');
  assert.ok(r.m.armUpCm >= 10, `腕の振り上げ ${r.m.armUpCm}`);
  assert.ok(r.m.armPullCm >= 8, `腕を引く ${r.m.armPullCm}`);
  assert.ok(r.m.landKneeDeg < 150, `着地の膝 ${r.m.landKneeDeg}`);
  assert.equal(r.g.landing, 'A');
  assert.equal(r.g.contact, null, 'ボールなしでは当てる場所は出さない');
  assert.ok(r.k.apex > 0 && r.k.impact > 0, 'キーのコマ');
});

test('analyzeRep: 振るのが早い・遅いを見分ける。落ちた高さは物理で出す', () => {
  const early = HF.analyzeRep(shadowRep({ swingAt: 1.1 }), { heightCm: 160 });
  near(early.m.timingSec, -0.15, 0.03, '早い');
  assert.equal(early.g.timing, 'C');
  assert.equal(HF.timingClass(early.m.timingSec), 'early');
  near(early.m.dropCm, 11, 3, '頂点より下（½gt²）');
  assert.match(HF.coach(early, 'timing').text, /ガマン/);
  const late = HF.analyzeRep(shadowRep({ swingAt: 1.35 }), { heightCm: 160 });
  near(late.m.timingSec, 0.1, 0.03, '遅い');
  assert.equal(HF.timingClass(late.m.timingSec), 'late');
  assert.match(HF.coach(late, 'timing').text, /遅い/);
});

test('analyzeRep: 首だけで振ると「体で叩く」が △、反らないと「空中姿勢」が △', () => {
  const nod = HF.analyzeRep(shadowRep({ bodySwing: false }), { heightCm: 160 });
  assert.ok(nod.m.bodyShare != null && nod.m.bodyShare < 0.5, `体で振った割合 ${nod.m.bodyShare}`);
  assert.equal(nod.g.swing, 'C');
  assert.match(HF.coach(nod, 'swing').text, /首だけ/);
  const flat = HF.analyzeRep(shadowRep({ arch: 3 }), { heightCm: 160 });
  assert.ok(flat.m.archDeg <= 5, `反り ${flat.m.archDeg}`);
  assert.equal(flat.g.air, 'C');
  assert.match(HF.coach(flat, 'air').text, /弓/);
});

test('analyzeRep: 左向きでも同じ数字。腕を上げない・膝を伸ばして着地するのも見つける', () => {
  const r = HF.analyzeRep(shadowRep({ facing: -1, swingAt: 1.25 }), { heightCm: 160 });
  assert.equal(r.facing, -1);
  near(r.m.timingSec, 0, 0.03, '左向きの頂点との差');
  near(r.m.archDeg, 18, 3, '左向きの反り');
  const bad = HF.analyzeRep(shadowRep({ armUp: -30, landKnee: 5, pull: false }), { heightCm: 160 });
  assert.equal(bad.items.armUp, 'C');
  assert.equal(bad.items.landKnee, 'C');
  assert.equal(bad.items.pull, 'C');
  const c = HF.coach(bad, 'timing');
  assert.match(c.safety, /膝/, '着地が危ないときは、テーマと別に一言添える');
});

test('analyzeRep: あごが上がると ○ に下がる', () => {
  const r = HF.analyzeRep(shadowRep({ chin: 35 }), { heightCm: 160 });
  assert.ok(r.m.chinUpDeg >= 28, `あご ${r.m.chinUpDeg}`);
  assert.equal(r.items.chin, 'C');
  assert.equal(r.g.air, 'B');
});

test('analyzeRep（ボールあり）: ボールが額で跳ね返った瞬間を当たりにして、打点と場所を出す', () => {
  const frames = shadowRep({ swingAt: 1.23 });
  // ボールは右上から来て、1.22 秒に額に当たって跳ね返る
  frames.forEach(f => {
    const head = HC.headOf(f.lm);
    const dt = f.t - 1.22;
    if (Math.abs(dt) > 0.3) return;
    const bx = head.x + 40 + Math.abs(dt) * 600, by = head.y - 8 + (dt < 0 ? dt * 300 : -dt * 500);
    f.ball = { x: dt === 0 ? head.x + 40 : bx, y: by, r: 33 };
  });
  const r = HF.analyzeRep(frames, { heightCm: 160, mode: 'ball' });
  near(r.t.impact, 1.22, 0.04, '当たった瞬間');
  assert.equal(r.m.contact, 'forehead');
  assert.equal(r.g.contact, 'A');
  assert.ok(r.m.contactHeightCm > 160 && r.m.contactHeightCm < 210, `打点 ${r.m.contactHeightCm}`);
  assert.ok(r.m.reachCm > 15, `立ったときより上 ${r.m.reachCm}`);
});

test('analyzeRep（キャッチ）: ボールを手首の近くでつかんだ瞬間を頂点と比べる', () => {
  const frames = shadowRep({ swingAt: 9 });   // 振り戻しはしない
  frames.forEach(f => {
    const lm = f.lm, w = lm[L.rwr];
    if (f.t < 1.05 || f.t > 1.6) return;
    // 1.3 秒につかむ（遅め）。それまでは上から落ちてくる
    f.ball = f.t < 1.3 ? { x: w.x + 5, y: w.y - 60 - (1.3 - f.t) * 900, r: 30 } : { x: w.x + 5, y: w.y - 25, r: 30 };
  });
  const r = HF.analyzeRep(frames, { heightCm: 160, mode: 'catch' });
  near(r.t.impact, 1.3, 0.03, 'つかんだ瞬間');
  near(r.m.timingSec, 0.05, 0.03, '頂点との差');
  assert.equal(r.g.timing, 'B');
  assert.equal(r.g.swing, null);
  assert.ok(r.m.catchHeightCm > 180, `キャッチの高さ ${r.m.catchHeightCm}`);
  assert.match(HF.coach(r, 'timing').text, /つかもう|落ちながら/);
});

test('analyzeRep: 跳ばない・人がいないとき', () => {
  const still = [];
  for (let i = 0; i < 60; i++) still.push({ t: i / 60, lm: athlete(), ball: null });
  const r = HF.analyzeRep(still, { heightCm: 160 });
  assert.ok(r.notes.includes('nojump'));
  assert.equal(r.m.timingSec, undefined);
  const none = HF.analyzeRep(still.map(f => ({ t: f.t, lm: null, ball: null })), {});
  assert.equal(none.ok, false);
  assert.equal(none.error, 'body');
});

test('analyzeRep: 30fps でも使える', () => {
  const r = HF.analyzeRep(shadowRep({ fps: 30, swingAt: 1.2 }), { heightCm: 160 });
  near(r.m.jumpCm, 31, 4, '跳んだ高さ');
  near(r.m.timingSec, -0.05, 0.04, '頂点との差');
});

test('coach: テーマが無ければ、いちばん直すべき所（タイミング優先）を選ぶ。全部 ◎ ならほめる', () => {
  const r = HF.analyzeRep(shadowRep({ swingAt: 1.1, arch: 3 }), { heightCm: 160 });
  assert.equal(HF.coach(r).phase, 'timing');
  const good = HF.analyzeRep(shadowRep(), { heightCm: 160 });
  const c = HF.coach(good);
  assert.equal(c.grade, 'A');
  assert.match(HF.coach(good, 'timing').text, /ドンピシャ/);
});

test('HeadingLog: 直近 5 本で ◎ 3 本で合格し、次のステップが開く', () => {
  const log = HL.load({ getItem: () => null });
  const good = HF.analyzeRep(shadowRep(), { heightCm: 160 });
  const bad = HF.analyzeRep(shadowRep({ arch: 2 }), { heightCm: 160 });
  assert.equal(HL.stepState(log, 'p1', 's2').unlocked, false, 's2 はまだ');
  HL.addRep(log, 'p1', 's1', bad); HL.checkPass(log, 'p1', 's1');
  HL.addRep(log, 'p1', 's1', good); assert.equal(HL.checkPass(log, 'p1', 's1'), false);
  HL.addRep(log, 'p1', 's1', good); assert.equal(HL.checkPass(log, 'p1', 's1'), false);
  HL.addRep(log, 'p1', 's1', good); assert.equal(HL.checkPass(log, 'p1', 's1'), true, '3 本目の ◎ で合格');
  assert.equal(HL.checkPass(log, 'p1', 's1'), false, '合格は 1 回だけ');
  assert.equal(HL.stepState(log, 'p1', 's2').unlocked, true);
  assert.equal(HL.currentStep(log, 'p1').id, 's2');
  assert.equal(HL.stepState(log, 'p2', 's2').unlocked, false, '別の選手には関係ない');
});

test('HeadingLog: 今週のヘディング本数（月曜はじまり）、感覚の一致、まとめ、気づき', () => {
  const log = HL.load({ getItem: () => '{broken' });
  const r = HF.analyzeRep(shadowRep({ swingAt: 1.1 }), { heightCm: 160 });
  const mon = new Date(2026, 8, 28, 10), sun = new Date(2026, 8, 27, 10), wed = new Date(2026, 8, 30, 10);
  HL.addRep(log, 'p1', null, r, { hit: true }, sun);
  HL.addRep(log, 'p1', null, r, { hit: true, pred: 'early' }, mon);
  HL.addRep(log, 'p1', null, r, { hit: false, pred: 'ok' }, mon);
  HL.addRep(log, 'p2', null, r, { hit: true }, mon);
  assert.equal(HL.weekHits(log, 'p1', wed), 1, '日曜は先週');
  const s = HL.senseStats(log, 'p1');
  assert.deepEqual(s, { n: 2, hit: 1 });
  const sum = HL.sessionSummary(HL.repsOf(log, 'p1'));
  assert.equal(sum.n, 3);
  assert.equal(sum.weak, 'timing');
  near(sum.avgTiming, -0.15, 0.03, '平均の頂点との差');
  HL.addNote(log, 'p1', ['跳ぶのが早い'], 'ボールを待つ', 'timing', mon);
  assert.equal(HL.lastNote(log, 'p1').theme, 'timing');
  assert.equal(HL.lastNote(log, 'p2'), null);
  const store = {}; HL.save({ setItem: (k, v) => { store[k] = v; } }, log);
  assert.equal(HL.load({ getItem: k => store[k] }).reps.length, 4);
  HL.removePlayer(log, 'p1');
  assert.equal(HL.repsOf(log, 'p1').length, 0);
});

test('JumpTrigger: 立っている → 跳ぶ → 着地して少したったら 1 回だけ知らせる。走っているときの一瞬の浮きは数えない', () => {
  const trig = new HF.JumpTrigger();
  const evs = [];
  shadowRep({ dur: 3 }).forEach(f => { const e = trig.push(f.t, f.lm); if (e) evs.push({ at: f.t, ...e }); });
  assert.equal(evs.length, 1);
  near(evs[0].takeoff, 1.0, 0.04, '踏み切り');
  near(evs[0].landing, 1.5, 0.04, '着地');
  assert.ok(evs[0].at >= 1.9, '着地の姿勢まで待つ');
  // 走る: 0.1 秒の浮きが続く
  const run = new HF.JumpTrigger();
  let n = 0;
  for (let i = 0; i < 180; i++) {
    const t = i / 60, ph = t % 0.35, lift = t > 1 && ph < 0.1 ? 490 * ph * (0.1 - ph) * 10 : 0;
    if (run.push(t, athlete({ lift }))) n++;
  }
  assert.equal(n, 0);
  assert.equal(run.ready(3), true);
  // 人がいなくなったら準備 OK ではない
  assert.equal(run.ready(4), false);
});
