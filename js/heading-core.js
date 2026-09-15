/* 🧠 ヘディングの判定と分析（DOM なし。ページからは <script src>、テストからは require で読む）
   MediaPipe Pose の 33 点（正規化 0〜1 → px に直したもの）と、ボールの検出 {x, y, r}（px）を使う */
(function (root) {
  'use strict';

  var L = { nose: 0, leye: 2, reye: 5, lear: 7, rear: 8, lsh: 11, rsh: 12, lel: 13, rel: 14, lwr: 15, rwr: 16,
            lhip: 23, rhip: 24, lknee: 25, rknee: 26, lank: 27, rank: 28, lheel: 29, rheel: 30, lfoot: 31, rfoot: 32 };

  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }
  function vis(p, min) { return p && (p.visibility == null || p.visibility >= (min == null ? 0.4 : min)); }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  // 正規化の 33 点 → px。見えない点は visibility を持ったまま
  function toPx(landmarks, w, h) {
    var out = new Array(landmarks.length);
    for (var i = 0; i < landmarks.length; i++) {
      var p = landmarks[i];
      out[i] = { x: p.x * w, y: p.y * h, visibility: p.visibility == null ? 1 : p.visibility };
    }
    return out;
  }

  // 頭の中心（目の高さ）と頭の大きさ s（半径くらい、px）。見えなければ null
  function headOf(lm) {
    var pts = [L.nose, L.leye, L.reye, L.lear, L.rear].map(function (i) { return lm[i]; }).filter(function (p) { return vis(p); });
    if (!pts.length) return null;
    var sx = 0, sy = 0;
    pts.forEach(function (p) { sx += p.x; sy += p.y; });
    var s = 0;
    if (vis(lm[L.lear]) && vis(lm[L.rear])) s = Math.max(s, dist(lm[L.lear], lm[L.rear]) * 0.75);
    if (vis(lm[L.leye]) && vis(lm[L.reye])) s = Math.max(s, dist(lm[L.leye], lm[L.reye]) * 1.7);
    if (vis(lm[L.lsh]) && vis(lm[L.rsh])) s = Math.max(s, dist(lm[L.lsh], lm[L.rsh]) * 0.3);
    if (vis(lm[L.lsh]) && vis(lm[L.nose])) s = Math.max(s, Math.abs(lm[L.lsh].y - lm[L.nose].y) * 0.45);
    if (!s) return null;
    return { x: sx / pts.length, y: sy / pts.length, s: s };
  }
  function ankleY(lm) {
    var ys = [];
    if (vis(lm[L.lank])) ys.push(lm[L.lank].y);
    if (vis(lm[L.rank])) ys.push(lm[L.rank].y);
    return ys.length ? Math.max.apply(null, ys) : null;
  }
  function angleAt(a, b, c) {
    var v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
    var d = (v1x * v2x + v1y * v2y) / (Math.sqrt(v1x * v1x + v1y * v1y) * Math.sqrt(v2x * v2x + v2y * v2y) || 1);
    return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
  }
  // 1 コマの体の要約（分析で使う）
  function bodyOf(lm) {
    var head = headOf(lm);
    if (!head) return null;
    var b = { head: head, ankleY: ankleY(lm) };
    if (vis(lm[L.lsh]) && vis(lm[L.rsh])) b.shoulder = mid(lm[L.lsh], lm[L.rsh]);
    if (vis(lm[L.lhip]) && vis(lm[L.rhip])) b.hip = mid(lm[L.lhip], lm[L.rhip]);
    var el = [];
    if (vis(lm[L.lel]) && vis(lm[L.lsh])) el.push(lm[L.lsh].y - lm[L.lel].y);
    if (vis(lm[L.rel]) && vis(lm[L.rsh])) el.push(lm[L.rsh].y - lm[L.rel].y);
    if (el.length) b.elbowRise = Math.max.apply(null, el);   // 肘が肩よりどれだけ上か（px、上が正）
    var kn = [];
    if (vis(lm[L.lhip]) && vis(lm[L.lknee]) && vis(lm[L.lank])) kn.push(angleAt(lm[L.lhip], lm[L.lknee], lm[L.lank]));
    if (vis(lm[L.rhip]) && vis(lm[L.rknee]) && vis(lm[L.rank])) kn.push(angleAt(lm[L.rhip], lm[L.rknee], lm[L.rank]));
    if (kn.length) b.knee = Math.min.apply(null, kn);       // 膝の角度（180=まっすぐ）
    if (b.shoulder && b.hip) b.lean = Math.atan2(b.shoulder.x - b.hip.x, b.hip.y - b.shoulder.y) * 180 / Math.PI;   // 上体の傾き（右へ正）
    return b;
  }

  // ---------- その場で数える ----------
  //  ・頭の高さの近くで、ボールとの距離がいちばん近くなって離れた／落ちてきたボールが跳ね返った
  //  ・頭の陰でボールが一瞬見えなくなっても、頭より上に出てきたら当たり
  //  ・cooldown 秒以内の続けての当たりは 1 回
  function HeadingCounter(o) {
    o = o || {};
    this.cooldown = o.cooldown || 0.6;
    this.reach = o.reach || 1.25;
    this.hideSec = o.hideSec || 0.5;
    this.reset();
  }
  HeadingCounter.prototype.reset = function () { this.hist = []; this.hidden = null; this.lastHit = -Infinity; this.count = 0; };
  HeadingCounter.prototype.hit = function (t, extra) {
    this.hidden = null; this.hist = [];
    if (t - this.lastHit < this.cooldown) return null;
    this.lastHit = t; this.count++;
    var ev = { type: 'hit', t: t, count: this.count };
    if (extra) for (var k in extra) ev[k] = extra[k];
    return ev;
  };
  HeadingCounter.prototype.push = function (t, ball, head) {
    if (!head) return null;
    var h = this.hist;
    if (!ball) {
      var last = h[h.length - 1];
      if (!this.hidden && last && last.near && t - last.t < 0.25) this.hidden = { t: last.t, ball: last.ball };
      if (this.hidden && t - this.hidden.t > this.hideSec) this.hidden = null;
      this.hist = [];
      return null;
    }
    var d = dist(ball, head);
    var lim = (head.s + ball.r) * this.reach;
    var cur = { t: t, d: d, y: ball.y, lim: lim, near: d < lim * 1.8, above: ball.y < head.y + head.s * 1.5, ball: ball };
    if (this.hidden) {
      var hid = this.hidden; this.hidden = null;
      if (t - hid.t <= this.hideSec && cur.near && ball.y < head.y) return this.hit(hid.t, { ball: hid.ball });
    }
    h.push(cur);
    if (h.length > 3) h.shift();
    if (h.length === 3) {
      var a = h[0], b = h[1], c = h[2];
      var closest = b.d < b.lim && b.d <= a.d && c.d > b.d;
      var bounced = b.near && a.y < b.y && c.y < b.y - b.lim * 0.1;
      if (b.above && (closest || bounced) && c.t - a.t < 0.4) return this.hit(b.t, { ball: b.ball });
    }
    return null;
  };

  // ---------- 撮ったクリップの分析 ----------
  // frames: [{t, ball:{x,y,r}|null, body:bodyOf(...)|null}]（t は秒、時間順）
  // 立っている基準: 足首が地面にあって、頭〜足首がいちばん長いコマ
  // まっすぐ立っているコマ（頭〜足首がいちばん長いコマの 97% 以上）のうち、足がいちばん低い（地面にある）ほうから 3 割を平均する
  function standingRef(frames, heightCm) {
    var cands = [];
    frames.forEach(function (f) {
      if (!f.body || f.body.ankleY == null) return;
      var headTop = f.body.head.y - f.body.head.s;
      cands.push({ span: f.body.ankleY - headTop, ankleY: f.body.ankleY, headTop: headTop, headS: f.body.head.s });
    });
    if (!cands.length) return null;
    var maxSpan = 0;
    cands.forEach(function (c) { if (c.span > maxSpan) maxSpan = c.span; });
    var tall = cands.filter(function (c) { return c.span >= maxSpan * 0.97; }).sort(function (a, b) { return b.ankleY - a.ankleY; });
    var use = tall.slice(0, Math.max(1, Math.round(tall.length * 0.3)));
    var best = { span: 0, ankleY: 0, headTop: 0, headS: 0 };
    use.forEach(function (c) { best.span += c.span; best.ankleY += c.ankleY; best.headTop += c.headTop; best.headS += c.headS; });
    ['span', 'ankleY', 'headTop', 'headS'].forEach(function (k) { best[k] /= use.length; });
    best.groundY = best.ankleY + best.headS * 0.35;     // 足首より少し下が地面
    best.pxPerCm = best.span / (heightCm * 0.96);       // 頭のてっぺん〜足首は身長の約 96%
    return best;
  }
  function classifyContact(ball, head) {
    var dy = (ball.y - head.y) / head.s;
    if (dy < -1.05) return 'top';        // 頭頂
    if (dy > 0.45) return 'low';         // 顔・首
    return 'forehead';                   // 額
  }
  function nearestFrame(frames, i, t) {
    var best = i, bd = Infinity;
    for (var k = Math.max(0, i - 40); k < Math.min(frames.length, i + 40); k++) {
      var d = Math.abs(frames[k].t - t);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
  function contactMetrics(frames, i, ev, ref) {
    var ci = nearestFrame(frames, i, ev.t);
    var f = frames[ci];
    var body = f.body || frames[i].body;
    var ball = ev.ball || f.ball;
    var m = { t: ev.t, frame: ci, ball: ball, contact: body && ball ? classifyContact(ball, body.head) : null };
    if (!ref || !body) return m;
    var cm = function (px) { return px / ref.pxPerCm; };
    if (ball) m.contactHeightCm = Math.round(cm(ref.groundY - ball.y));
    m.headTopHeightCm = Math.round(cm(ref.groundY - (body.head.y - body.head.s)));
    m.jumpCm = Math.max(0, Math.round(cm(ref.headTop - (body.head.y - body.head.s))));
    // 踏み切り: 当たる前 1.2 秒以内で、足首が地面から離れていた最初のコマ
    var liftPx = ref.headS * 0.25;   // 足首が 4cm くらい上がったら「離れた」
    var take = null, land = null, k;
    for (k = ci; k >= 0 && ev.t - frames[k].t < 1.2; k--) {
      var b = frames[k].body;
      if (!b || b.ankleY == null) continue;
      if (ref.ankleY - b.ankleY > liftPx) take = frames[k].t; else if (take !== null) break;
    }
    for (k = ci; k < frames.length && frames[k].t - ev.t < 1.2; k++) {
      var b2 = frames[k].body;
      if (!b2 || b2.ankleY == null) continue;
      if (ref.ankleY - b2.ankleY <= liftPx && frames[k].t > ev.t) { land = frames[k].t; break; }
    }
    if (take !== null) m.takeoffToContactSec = Math.round((ev.t - take) * 100) / 100;
    // 反り: 当たる前 0.5 秒の、ボールと反対側への上体の傾きの最大と、当たった瞬間の傾き
    // ボールが来た側: 当たる 0.15〜0.5 秒前のボールの位置が頭のどちらか
    var side = 1, from = null;
    for (k = ci - 1; k >= 0 && ev.t - frames[k].t < 0.5; k--) {
      if (frames[k].ball && ev.t - frames[k].t >= 0.15) { from = frames[k].ball; break; }
    }
    if (from) side = from.x >= body.head.x ? 1 : -1;
    else if (ball) side = ball.x >= body.head.x ? 1 : -1;
    var leanMax = null;
    for (k = ci; k >= 0 && ev.t - frames[k].t < 0.5; k--) {
      var b3 = frames[k].body;
      if (!b3 || b3.lean == null) continue;
      var back = -b3.lean * side;
      if (leanMax === null || back > leanMax) leanMax = back;
    }
    if (leanMax !== null) m.backLeanDeg = Math.round(leanMax);
    if (body.lean != null) m.leanAtContactDeg = Math.round(-body.lean * side);
    if (body.elbowRise != null) m.elbowRiseCm = Math.round(cm(body.elbowRise));
    // 着地の膝: 着地後 0.4 秒の膝の角度の最小
    if (land !== null) {
      var kmin = null;
      for (k = 0; k < frames.length; k++) {
        var fr = frames[k];
        if (fr.t < land || fr.t > land + 0.4 || !fr.body || fr.body.knee == null) continue;
        if (kmin === null || fr.body.knee < kmin) kmin = fr.body.knee;
      }
      if (kmin !== null) m.landingKneeDeg = Math.round(kmin);
    }
    return m;
  }
  // 当たった瞬間を見つけ、フォームの数字を出す
  function analyzeClip(frames, o) {
    o = o || {};
    var ref = standingRef(frames, o.heightCm || 150);
    var counter = new HeadingCounter({ cooldown: o.cooldown || 0.5 });
    var contacts = [];
    frames.forEach(function (f, i) {
      var ev = counter.push(f.t, f.ball, f.body && f.body.head);
      if (ev) contacts.push(contactMetrics(frames, i, ev, ref));
    });
    return { ref: ref, contacts: contacts };
  }

  var api = { L: L, toPx: toPx, headOf: headOf, bodyOf: bodyOf, HeadingCounter: HeadingCounter,
              standingRef: standingRef, classifyContact: classifyContact, analyzeClip: analyzeClip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HeadingCore = api;
})(typeof window !== 'undefined' ? window : this);
