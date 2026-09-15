const test = require('node:test');
const assert = require('node:assert/strict');
const { StripDiff, Gate, SprintTimer, Agility505, interp } = require('../js/timing-core.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

/* 帯の画素を作る: rows 行 × cols 列、背景は緑。body 行の範囲を人の色にする */
function strip(rows, cols, bodyFrom, bodyTo, noise) {
  const px = new Uint8ClampedArray(rows * cols * 4);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = (r * cols + c) * 4, body = r >= bodyFrom && r < bodyTo;
    const n = noise ? (Math.random() - 0.5) * noise : 0;
    px[k] = (body ? 200 : 40) + n; px[k + 1] = (body ? 40 : 130) + n; px[k + 2] = (body ? 40 : 60) + n; px[k + 3] = 255;
  }
  return px;
}

test('StripDiff: 最初のコマを背景にし、人が入った行の割合を返す。少しのノイズでは反応しない', () => {
  const sd = new StripDiff();
  assert.equal(sd.update(strip(40, 6, 0, 0, 20), 40, 6), 0, '最初は 0');
  for (let i = 0; i < 5; i++) near(sd.update(strip(40, 6, 0, 0, 20), 40, 6), 0, 0.06, 'ノイズだけ');
  near(sd.update(strip(40, 6, 10, 30, 20), 40, 6), 0.5, 0.06, '半分の行に人');
  near(sd.update(strip(40, 6, 0, 40, 20), 40, 6), 1, 0.06, '全部');
});

test('StripDiff: 動きが無い間は背景をゆっくり覚え直す（照明が変わっても数秒で戻る）', () => {
  const sd = new StripDiff({ adapt: 0.1 });
  sd.update(strip(40, 6, 0, 0), 40, 6);
  const brighter = strip(40, 6, 0, 0); for (let i = 0; i < brighter.length; i++) if (i % 4 !== 3) brighter[i] += 20;
  let occ = 1;
  for (let i = 0; i < 40; i++) occ = sd.update(brighter, 40, 6);
  assert.equal(occ, 0, '覚え直したあとは 0');
});

test('Gate: 中央の帯が埋まった瞬間を、コマの間を直線で補って返す。向きは左右どちらの帯が先か', () => {
  const g = new Gate();
  assert.equal(g.update(0.00, 0, 0, 0), null);
  assert.equal(g.update(0.02, 0.6, 0, 0), null, '左の帯に入った');
  const ev = g.update(0.04, 0.9, 0.9, 0, 0);
  assert.ok(ev, '中央に入った');
  near(ev.t, 0.03, 1e-9, '0→0.9 の途中 0.45 は真ん中');
  assert.equal(ev.dir, 1, '左から右へ');
  assert.equal(g.update(0.06, 0.9, 0.9, 0.9), null, '入ったままでは二度目は無い');
  assert.equal(g.update(0.08, 0, 0, 0.5), null, '抜けた');
  const back = g.update(1.00, 0, 0.8, 0.8);
  assert.ok(back && back.dir === -1, '右から戻る');
});

test('Gate: 短い間隔の二度打ち（腕→胴）は 1 回にする', () => {
  const g = new Gate({ cooldown: 0.25 });
  g.update(0, 0.5, 0, 0);
  assert.ok(g.update(0.02, 0.5, 0.5, 0), '腕');
  g.update(0.04, 0.5, 0.1, 0);
  assert.equal(g.update(0.06, 0.5, 0.9, 0.2), null, '胴はクールダウン内');
});

test('SprintTimer (lines): スタート線→ゴール線でタイム。逆向きや短すぎるものは無視。走り終えたら arm で次へ', () => {
  const s = new SprintTimer({ mode: 'lines', dir: 1 });
  assert.equal(s.onCross('finish', { t: 0.5, dir: 1 }), null, '先にゴール線を切っても始まらない');
  assert.equal(s.onCross('start', { t: 1.0, dir: -1 }), null, '逆向き');
  assert.deepEqual(s.onCross('start', { t: 1.0, dir: 1 }), { type: 'start', t: 1.0 });
  assert.equal(s.onCross('start', { t: 1.2, dir: 1 }), null, '走っている間のスタート線は無視');
  const fin = s.onCross('finish', { t: 2.83, dir: 1 });
  near(fin.time, 1.83, 1e-9, 'タイム');
  assert.equal(s.state, 'done');
  assert.equal(s.onCross('start', { t: 5, dir: 1 }), null, 'arm するまで次は始まらない');
  s.arm();
  assert.ok(s.onCross('start', { t: 6, dir: 1 }));
  assert.deepEqual(s.tick(30), { type: 'timeout' });
});

test('SprintTimer (signal): 合図で開始、ゴール線だけで終了', () => {
  const s = new SprintTimer({ mode: 'signal', dir: -1 });
  assert.equal(s.onCross('finish', { t: 1, dir: -1 }), null, '合図の前');
  s.go(2.0);
  assert.equal(s.onCross('finish', { t: 2.2, dir: -1 }), null, '短すぎ（合図の直後に何か横切った）');
  near(s.onCross('finish', { t: 4.15, dir: -1 }).time, 2.15, 1e-9, 'タイム');
});

test('Agility505: 出て→折り返し線に届いて→戻る。届かずに戻ったら無効', () => {
  const a = new Agility505({ dir: 1 });
  assert.deepEqual(a.onCross({ t: 1, dir: 1 }), { type: 'start', t: 1 });
  assert.equal(a.turnPresence(1.5, 0.1), null);
  assert.deepEqual(a.turnPresence(2.0, 0.6), { type: 'turn', t: 2.0 });
  const fin = a.onCross({ t: 3.4, dir: -1 });
  near(fin.time, 2.4, 1e-9, 'タイム');
  near(fin.split, 1.0, 1e-9, '折り返しまで');
  const b = new Agility505({ dir: 1 });
  b.onCross({ t: 1, dir: 1 });
  assert.deepEqual(b.onCross({ t: 2, dir: -1 }), { type: 'invalid', reason: 'turn' });
  assert.equal(b.state, 'ready', '無効のあとはすぐ次を待つ');
});

test('interp: しきい値を横切った時刻', () => {
  near(interp(0, 0.2, 0.1, 0.7, 0.45), 0.05, 1e-12, '真ん中');
  near(interp(0, 0.5, 0.1, 0.9, 0.45), 0, 1e-12, 'すでに越えていれば前のコマ');
});
