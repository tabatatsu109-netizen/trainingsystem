/* ⏱ タイム計測の計算（DOM なし。ページからは <script src>、テストからは require で読む）
   光電管と同じ考え方: 画面に引いた線の位置の細い帯（ストリップ）を毎コマ見て、
   背景と違う画素が帯の中に増えた瞬間＝体が線を切った瞬間とする。AI を使わないので高い fps で回せる */
(function (root) {
  'use strict';

  // ---------- 帯 1 本の「背景との違い」 ----------
  // update(px, rows, cols) に帯の画素（RGBA、rows 行 × cols 列）を渡すと、
  // 帯の中で背景と違う行の割合（0〜1）を返す。動きが無い間は背景をゆっくり覚え直す
  function StripDiff(o) {
    o = o || {};
    this.thr = o.thr || 26;           // 行の平均差（0〜255）がこれ以上なら「何かある」
    this.quiet = o.quiet || 0.12;     // この割合以下なら背景を覚え直す
    this.adapt = o.adapt || 0.03;     // 覚え直しの速さ
    this.bg = null;
    this.rows = 0;
    this.cols = 0;
    this.lastRowDiff = null;
  }
  StripDiff.prototype.reset = function () { this.bg = null; };
  StripDiff.prototype.update = function (px, rows, cols) {
    var n = rows * cols * 4;
    if (!this.bg || this.rows !== rows || this.cols !== cols) {
      this.bg = new Float32Array(n);
      for (var i = 0; i < n; i++) this.bg[i] = px[i];
      this.rows = rows; this.cols = cols;
      this.lastRowDiff = new Float32Array(rows);
      return 0;
    }
    var bg = this.bg, changed = 0, rd = this.lastRowDiff;
    for (var r = 0; r < rows; r++) {
      var s = 0, base = r * cols * 4;
      for (var c = 0; c < cols; c++) {
        var k = base + c * 4;
        s += Math.abs(px[k] - bg[k]) + Math.abs(px[k + 1] - bg[k + 1]) + Math.abs(px[k + 2] - bg[k + 2]);
      }
      var d = s / (cols * 3);
      rd[r] = d;
      if (d > this.thr) changed++;
    }
    var occ = changed / rows;
    if (occ <= this.quiet) {
      var a = this.adapt;
      for (var j = 0; j < n; j++) bg[j] += (px[j] - bg[j]) * a;
    }
    return occ;
  };

  function interp(t0, v0, t1, v1, th) {
    if (v1 === v0) return t1;
    var u = (th - v0) / (v1 - v0);
    if (u < 0) u = 0; if (u > 1) u = 1;
    return t0 + (t1 - t0) * u;
  }

  // ---------- 線 1 本のゲート ----------
  // 線の左（a）・中央（c）・右（b）の 3 本の帯の占有率を update(t, a, c, b) で渡す。
  // 中央の帯が空 → 埋まった瞬間に {t, dir} を返す（t は占有率が enter を横切った時刻を直線で補ったもの、
  // dir は 1=右へ / -1=左へ。左右どちらの帯が先に埋まったかで決める）
  function Gate(o) {
    o = o || {};
    this.enter = o.enter || 0.45;
    this.leave = o.leave || 0.15;
    this.cooldown = o.cooldown || 0.25;
    this.side = o.side || 0.3;
    this.reset();
  }
  Gate.prototype.reset = function () {
    this.occupied = false;
    this.prev = null;
    this.lastCross = -Infinity;
    this.aAt = -Infinity;
    this.bAt = -Infinity;
    this.aOn = false;
    this.bOn = false;
    this.occ = 0;
  };
  Gate.prototype.update = function (t, a, c, b) {
    this.occ = c;
    if (a > this.side) { if (!this.aOn) this.aAt = t; this.aOn = true; } else if (a < this.leave) this.aOn = false;
    if (b > this.side) { if (!this.bOn) this.bAt = t; this.bOn = true; } else if (b < this.leave) this.bOn = false;
    var out = null;
    if (!this.occupied && c >= this.enter) {
      this.occupied = true;
      if (t - this.lastCross >= this.cooldown) {
        var tc = this.prev ? interp(this.prev.t, this.prev.c, t, c, this.enter) : t;
        var dir = 0;
        if (this.aOn && this.bOn) dir = this.aAt <= this.bAt ? 1 : -1;   // 両方なら先に埋まったほうから来た
        else if (this.aOn) dir = 1;
        else if (this.bOn) dir = -1;
        this.lastCross = tc;
        out = { t: tc, dir: dir };
      }
    } else if (this.occupied && c <= this.leave) {
      this.occupied = false;
    }
    this.prev = { t: t, c: c };
    return out;
  };

  // ---------- スプリント ----------
  // mode 'lines': スタート線を走る向きに切ったら計測開始、ゴール線を切ったら終了
  // mode 'signal': go(t) の合図で計測開始（ゴール線だけ映せばよい）
  function SprintTimer(o) {
    o = o || {};
    this.mode = o.mode === 'signal' ? 'signal' : 'lines';
    this.dir = o.dir || 1;
    this.maxSec = o.maxSec || 20;
    this.minSec = o.minSec || 0.5;
    this.reset();
  }
  SprintTimer.prototype.reset = function () {
    this.state = this.mode === 'signal' ? 'idle' : 'ready';
    this.t0 = null;
  };
  SprintTimer.prototype.arm = function () { if (this.mode === 'lines') this.state = 'ready'; };
  SprintTimer.prototype.go = function (t) { this.state = 'running'; this.t0 = t; };
  SprintTimer.prototype.tick = function (t) {
    if (this.state === 'running' && t - this.t0 > this.maxSec) { this.reset(); return { type: 'timeout' }; }
    return null;
  };
  // which: 'start' | 'finish'、ev: Gate の {t, dir}
  SprintTimer.prototype.onCross = function (which, ev) {
    if (!ev) return null;
    if (which === 'start' && this.mode === 'lines' && this.state === 'ready') {
      if (ev.dir === -this.dir) return null;
      this.state = 'running';
      this.t0 = ev.t;
      return { type: 'start', t: ev.t };
    }
    if (which === 'finish' && this.state === 'running') {
      if (ev.dir === -this.dir) return null;
      var time = ev.t - this.t0;
      if (time < this.minSec) return null;
      this.state = 'done';
      return { type: 'finish', t: ev.t, time: time };
    }
    return null;
  };

  // ---------- 505 アジリティ ----------
  // 計測線（gate）を折り返しの向きに切ったら開始 → 折り返し線の帯に体が入る → 計測線を戻る向きに切ったら終了。
  // 折り返し線まで行かずに戻ったら 'invalid'
  function Agility505(o) {
    o = o || {};
    this.dir = o.dir || 1;
    this.maxSec = o.maxSec || 15;
    this.turnOcc = o.turnOcc || 0.3;
    this.reset();
  }
  Agility505.prototype.reset = function () { this.state = 'ready'; this.turned = false; this.t0 = null; this.turnAt = null; };
  Agility505.prototype.arm = function () { this.reset(); };
  Agility505.prototype.go = function () {};
  Agility505.prototype.tick = function (t) {
    if (this.state === 'running' && t - this.t0 > this.maxSec) { this.reset(); return { type: 'timeout' }; }
    return null;
  };
  Agility505.prototype.turnPresence = function (t, occ) {
    if (this.state === 'running' && !this.turned && occ >= this.turnOcc) {
      this.turned = true; this.turnAt = t;
      return { type: 'turn', t: t };
    }
    return null;
  };
  Agility505.prototype.onCross = function (ev) {
    if (!ev) return null;
    if (this.state === 'ready') {
      if (ev.dir === -this.dir) return null;
      this.state = 'running'; this.turned = false; this.t0 = ev.t;
      return { type: 'start', t: ev.t };
    }
    if (this.state === 'running') {
      if (ev.dir === this.dir) return null;
      if (!this.turned) { this.reset(); return { type: 'invalid', reason: 'turn' }; }
      var time = ev.t - this.t0;
      this.state = 'done';
      return { type: 'finish', t: ev.t, time: time, split: this.turnAt - this.t0 };
    }
    return null;
  };

  var api = { StripDiff: StripDiff, Gate: Gate, SprintTimer: SprintTimer, Agility505: Agility505, interp: interp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimingCore = api;
})(typeof window !== 'undefined' ? window : this);
