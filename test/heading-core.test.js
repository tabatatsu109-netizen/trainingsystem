const test = require('node:test');
const assert = require('node:assert/strict');
const { L, toPx, headOf, bodyOf, HeadingCounter, standingRef, classifyContact, analyzeClip } = require('../js/heading-core.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

/* 横から見た人の 33 点を作る（px）。headY: 目の高さ、ankleY: 足首、lean: 上体の傾き（度、右へ正）、
   elbowUp: 肘を肩より上げる、kneeBend: 膝を曲げる */
function person({ x = 400, headY = 200, ankleY = 700, lean = 0, elbowUp = false, kneeBend = 0 } = {}) {
  const lm = [];
  for (let i = 0; i < 33; i++) lm.push({ x, y: 0, visibility: 0 });
  const H = ankleY - headY;                      // 目〜足首
  const s = H * 0.09;                            // 頭の大きさ
  const set = (i, px, py) => { lm[i] = { x: px, y: py, visibility: 1 }; };
  set(L.nose, x + s * 0.3, headY + s * 0.2);
  set(L.leye, x - s * 0.35, headY); set(L.reye, x + s * 0.35, headY);
  set(L.lear, x - s * 0.9, headY + s * 0.1); set(L.rear, x + s * 0.9, headY + s * 0.1);
  const shY = headY + s * 2.2, hipY = headY + H * 0.5;
  const dx = Math.tan(lean * Math.PI / 180) * (hipY - shY);
  set(L.lsh, x + dx - s, shY); set(L.rsh, x + dx + s, shY);
  set(L.lhip, x - s * 0.7, hipY); set(L.rhip, x + s * 0.7, hipY);
  const elY = elbowUp ? shY - s * 1.5 : shY + s * 1.5;
  set(L.lel, x + dx - s * 1.5, elY); set(L.rel, x + dx + s * 1.5, elY);
  const kneeY = hipY + (ankleY - hipY) * 0.5;
  set(L.lknee, x - s * 0.5 + kneeBend, kneeY); set(L.rknee, x + s * 0.5 + kneeBend, kneeY);
  set(L.lank, x - s * 0.5, ankleY); set(L.rank, x + s * 0.5, ankleY);
  return lm;
}

test('toPx / headOf: 正規化の点を px にして、頭の中心と大きさが取れる', () => {
  const lm = toPx(person().map(p => ({ x: p.x / 1000, y: p.y / 1000, visibility: p.visibility })), 1000, 1000);
  const h = headOf(lm);
  near(h.y, 200, 6, '目の高さ');
  assert.ok(h.s > 30 && h.s < 75, `頭の大きさ ${h.s}`);
  const hidden = person(); [L.nose, L.leye, L.reye, L.lear, L.rear].forEach(i => { hidden[i].visibility = 0; });
  assert.equal(headOf(hidden), null, '顔が見えなければ null');
});

test('bodyOf: 上体の傾き・肘の高さ・膝の角度', () => {
  near(bodyOf(person({ lean: 20 })).lean, 20, 1.5, '傾き');
  assert.ok(bodyOf(person({ elbowUp: true })).elbowRise > 0, '肘が上');
  assert.ok(bodyOf(person({ elbowUp: false })).elbowRise < 0, '肘が下');
  assert.ok(bodyOf(person()).knee > 170, 'まっすぐ');
  assert.ok(bodyOf(person({ kneeBend: 60 })).knee < 150, '曲げる');
});

test('HeadingCounter: 落ちてきたボールが頭で跳ね返ったら 1 回。離れた所を通り過ぎても数えない', () => {
  const c = new HeadingCounter();
  const head = { x: 400, y: 200, s: 40 };
  let hits = 0;
  // ボールが上から落ちてきて額（y≈190）で跳ね返る
  const ys = [40, 90, 140, 175, 190, 175, 140, 90, 40];
  ys.forEach((y, i) => { if (c.push(i * 0.033, { x: 405, y, r: 22 }, head)) hits++; });
  assert.equal(hits, 1);
  // 遠くを通り過ぎる
  const c2 = new HeadingCounter();
  [40, 90, 140, 190, 240, 290].forEach((y, i) => { assert.equal(c2.push(i * 0.033, { x: 700, y, r: 22 }, head), null); });
  // 頭の陰で見えなくなって、上に出てくる
  const c3 = new HeadingCounter();
  const seq = [{ y: 120 }, { y: 160 }, null, null, { y: 150 }, { y: 100 }];
  let h3 = 0;
  seq.forEach((b, i) => { if (c3.push(i * 0.033, b && { x: 400, y: b.y, r: 22 }, head)) h3++; });
  assert.equal(h3, 1, '陰から跳ね返った');
});

test('classifyContact: 額・頭頂・低い', () => {
  const head = { x: 0, y: 100, s: 40 };
  assert.equal(classifyContact({ x: 10, y: 80 }, head), 'forehead');
  assert.equal(classifyContact({ x: 0, y: 40 }, head), 'top');
  assert.equal(classifyContact({ x: 0, y: 140 }, head), 'low');
});

test('analyzeClip: 立った基準から、打点の高さ・ジャンプ・踏み切り〜当たるまで・反り・着地の膝が出る', () => {
  const FPS = 60, frames = [];
  const heightCm = 150, ankle0 = 700, head0 = 200;   // 目〜足首 500px、頭のてっぺん〜足首 ≈ 545px ≈ 144cm
  for (let i = 0; i < 120; i++) {
    const t = i / FPS;
    let dy = 0, lean = 0, elbowUp = false, kneeBend = 0;
    if (t >= 0.6 && t < 1.0) { const u = (t - 0.6) / 0.4; dy = -Math.sin(u * Math.PI) * 60; }   // 0.4 秒のジャンプ、最高 60px
    if (t >= 0.45 && t < 0.8) lean = -15;                                                    // 当たる前に反る（左へ）
    if (t >= 0.7 && t < 0.9) { lean = 10; elbowUp = true; }
    if (t >= 1.0 && t < 1.3) kneeBend = 50;
    const lm = person({ headY: head0 + dy, ankleY: ankle0 + dy, lean, elbowUp, kneeBend });
    const body = bodyOf(lm);
    // ボール: 右から飛んできて t=0.8 に額（目の少し上）に当たって戻る
    let ball = null;
    if (t >= 0.5 && t < 1.1) {
      const u = (t - 0.8) / 0.3;
      ball = { x: 405 + Math.abs(u) * 300, y: body.head.y - 15 + u * u * 60, r: 22 };
    }
    frames.push({ t, ball, body });
  }
  const r = analyzeClip(frames, { heightCm });
  assert.ok(r.ref, '基準');
  near(r.ref.pxPerCm, 545 / (150 * 0.96), 0.4, 'px/cm');
  assert.equal(r.contacts.length, 1, '1 回');
  const c = r.contacts[0];
  near(c.t, 0.8, 0.05, '当たった時刻');
  assert.equal(c.contact, 'forehead');
  assert.ok(c.jumpCm >= 12 && c.jumpCm <= 20, `ジャンプ ${c.jumpCm}cm（60px ≈ 16cm）`);
  assert.ok(c.contactHeightCm > 140 && c.contactHeightCm < 175, `打点 ${c.contactHeightCm}cm`);
  assert.ok(c.takeoffToContactSec >= 0.15 && c.takeoffToContactSec <= 0.25, `踏み切り〜当たる ${c.takeoffToContactSec}`);
  assert.ok(c.backLeanDeg >= 12, `反り ${c.backLeanDeg}°`);
  assert.ok(c.elbowRiseCm > 0, '肘が上');
  assert.ok(c.landingKneeDeg < 160, `着地の膝 ${c.landingKneeDeg}°`);
});
