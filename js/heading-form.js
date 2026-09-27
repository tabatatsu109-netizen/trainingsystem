/* 🧠 ジャンプヘッドのフォーム分析（DOM なし。ページからは <script src>、テストからは require で読む）
   1 本分のコマ [{t 秒, lm: 33 点（px）| null, ball: {x,y,r} | null}] から、
   踏み切り → 空中で反る → 頂点 → 振り戻す（当たる）→ 着地 を見つけて、局面ごとに ◎○△ を付ける。
   真横から撮る前提。高さは身長から px→cm に直す。跳んだ高さと頂点の時刻は滞空時間から出す（体の大きさに左右されない） */
(function (root) {
  'use strict';
  var HC = root && root.HeadingCore ? root.HeadingCore : require('./heading-core.js');
  var L = HC.L;
  var G = 980;          // cm/s²
  var LIFT_CM = 4;      // 足がこれだけ浮いたら「空中」

  function vis(p) { return p && (p.visibility == null || p.visibility >= 0.4); }
  function deg(r) { return r * 180 / Math.PI; }
  function wrap(a) { while (a > 180) a -= 360; while (a < -180) a += 360; return a; }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function quantile(a, q) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
  }
  function r1(v) { return v == null ? null : Math.round(v * 10) / 10; }
  function r2(v) { return v == null ? null : Math.round(v * 100) / 100; }
  function avgPt(lm, idxs) {
    var x = 0, y = 0, n = 0;
    idxs.forEach(function (i) { if (vis(lm[i])) { x += lm[i].x; y += lm[i].y; n++; } });
    return n ? { x: x / n, y: y / n } : null;
  }
  // 見えている点のうち、いちばん下（y が大きい）
  function lowest(lm, idxs) {
    var y = null;
    idxs.forEach(function (i) { if (vis(lm[i]) && (y === null || lm[i].y > y)) y = lm[i].y; });
    return y;
  }
  function kneeAngle(a, b, c) {
    var v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
    var d = (v1x * v2x + v1y * v2y) / (Math.sqrt(v1x * v1x + v1y * v1y) * Math.sqrt(v2x * v2x + v2y * v2y) || 1);
    return deg(Math.acos(Math.max(-1, Math.min(1, d))));
  }

  // 体の向き: 鼻が耳より右なら右向き（+1）
  function facingOf(frames) {
    var v = 0;
    frames.forEach(function (f) {
      var lm = f.lm;
      if (!lm || !vis(lm[L.nose])) return;
      var ear = avgPt(lm, [L.lear, L.rear]);
      if (!ear) return;
      var d = lm[L.nose].x - ear.x;
      v += d > 0 ? 1 : d < 0 ? -1 : 0;
    });
    return v >= 0 ? 1 : -1;
  }

  // 1 コマの要約。角度は「顔の向き」を前として符号を合わせる
  //  lean: 上体の前傾（°、後ろへ反ると −）  neck: 胴体に対する頭の前への倒れ（°）
  function derive(f, facing) {
    var lm = f.lm;
    if (!lm) return null;
    var head = HC.headOf(lm);
    if (!head) return null;
    var d = { t: f.t, head: head, headTop: head.y - head.s };
    d.footL = lowest(lm, [L.lank, L.lheel, L.lfoot]);
    d.footR = lowest(lm, [L.rank, L.rheel, L.rfoot]);
    d.foot = d.footL === null ? d.footR : d.footR === null ? d.footL : Math.max(d.footL, d.footR);
    var sh = avgPt(lm, [L.lsh, L.rsh]), hip = avgPt(lm, [L.lhip, L.rhip]);
    if (sh && hip) {
      d.sh = sh; d.hip = hip;
      var trunk = Math.atan2(sh.x - hip.x, hip.y - sh.y);
      d.lean = deg(trunk) * facing;
      d.neck = wrap(deg(Math.atan2(head.x - sh.x, sh.y - head.y) - trunk)) * facing;
    }
    if (sh) {
      var wr = [], el = [];
      [L.lwr, L.rwr].forEach(function (i) { if (vis(lm[i])) wr.push(sh.y - lm[i].y); });
      [L.lel, L.rel].forEach(function (i) { if (vis(lm[i])) el.push(sh.y - lm[i].y); });
      if (wr.length) d.wristRise = Math.max.apply(null, wr);     // 手首が肩よりどれだけ上か（px）
      if (el.length) d.elbowRise = Math.max.apply(null, el);     // 肘が肩よりどれだけ上か（px）
    }
    var kn = [], kh = [];
    [[L.lhip, L.lknee, L.lank], [L.rhip, L.rknee, L.rank]].forEach(function (s) {
      if (vis(lm[s[0]]) && vis(lm[s[1]]) && vis(lm[s[2]])) kn.push(kneeAngle(lm[s[0]], lm[s[1]], lm[s[2]]));
      if (vis(lm[s[0]]) && vis(lm[s[1]])) kh.push(lm[s[0]].y - lm[s[1]].y);
    });
    if (kn.length) d.knee = Math.min.apply(null, kn);             // 膝の角度（180=まっすぐ）
    if (kh.length) d.kneeHigh = Math.max.apply(null, kh);         // 膝が腰よりどれだけ上か（px、ふつうは −）
    return d;
  }

  // 1-2-1 の重みでならす（抜けているコマは飛ばす）。key+'S' に入れる
  function smooth(ds, key) {
    for (var i = 0; i < ds.length; i++) {
      var c = ds[i][key];
      if (c == null) { ds[i][key + 'S'] = null; continue; }
      var s = c * 2, w = 2;
      [i - 1, i + 1].forEach(function (j) {
        var o = ds[j];
        if (o && o[key] != null && Math.abs(o.t - ds[i].t) < 0.06) { s += o[key]; w++; }
      });
      ds[i][key + 'S'] = s / w;
    }
  }
  function inWin(ds, key, t0, t1) { return ds.filter(function (d) { return d.t >= t0 && d.t <= t1 && d[key] != null; }); }
  function maxBy(arr, key) { var b = null; arr.forEach(function (d) { if (!b || d[key] > b[key]) b = d; }); return b; }
  function minBy(arr, key) { var b = null; arr.forEach(function (d) { if (!b || d[key] < b[key]) b = d; }); return b; }
  function valueAt(ds, key, t) {
    var b = null, bd = 0.08;
    ds.forEach(function (d) { if (d[key] != null && Math.abs(d.t - t) <= bd) { bd = Math.abs(d.t - t); b = d; } });
    return b ? b[key] : null;
  }
  function nearestIndex(frames, t) {
    var bi = 0, bd = Infinity;
    frames.forEach(function (f, i) { var d = Math.abs(f.t - t); if (d < bd) { bd = d; bi = i; } });
    return bi;
  }

  // 空中にいた区間（足のいちばん低い点が地面から LIFT 以上浮いていた）。いちばん長いものを返す
  function findFlight(ds, ground, liftPx) {
    var thr = ground - liftPx, segs = [], cur = null, lastGround = null;
    ds.forEach(function (d) {
      if (d.foot == null) return;
      if (d.foot < thr) {
        if (!cur) cur = { a: d, b: d, before: lastGround };
        else cur.b = d;
      } else {
        if (cur) { cur.after = d; segs.push(cur); cur = null; }
        lastGround = d;
      }
    });
    if (cur) segs.push(cur);
    var cross = function (p, q) {   // p（地面）→ q（空中）の間で thr を横切った時刻
      if (!p) return q.t;
      var dy = p.foot - q.foot;
      return dy > 0 ? p.t + (q.t - p.t) * (p.foot - thr) / dy : q.t;
    };
    var best = null;
    segs.forEach(function (s) {
      var take = cross(s.before, s.a);
      var land = s.after ? cross(s.after, s.b) : s.b.t;
      var dur = land - take;
      if (dur >= 0.15 && (!best || dur > best.dur)) best = { takeoff: take, landing: land, dur: dur, closed: !!(s.before && s.after) };
    });
    return best;
  }

  // 頂点: 放物線なので滞空の真ん中。腰の高さの放物線の頂点とも合わせる（大きくずれたら真ん中を採る）
  function apexOf(ds, fl) {
    var midT = (fl.takeoff + fl.landing) / 2;
    var pts = ds.filter(function (d) { return d.hip && d.t > fl.takeoff + 0.03 && d.t < fl.landing - 0.03; });
    if (pts.length >= 5) {
      // y = a t² + b t + c を最小二乗で（t は midT からの差にしてから）
      var s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, y0 = 0, y1 = 0, y2 = 0;
      pts.forEach(function (d) {
        var t = d.t - midT, y = d.hip.y;
        s0++; s1 += t; s2 += t * t; s3 += t * t * t; s4 += t * t * t * t; y0 += y; y1 += y * t; y2 += y * t * t;
      });
      var det = s4 * (s2 * s0 - s1 * s1) - s3 * (s3 * s0 - s1 * s2) + s2 * (s3 * s1 - s2 * s2);
      if (Math.abs(det) > 1e-12) {
        var a = (y2 * (s2 * s0 - s1 * s1) - s3 * (y1 * s0 - s1 * y0) + s2 * (y1 * s1 - s2 * y0)) / det;
        var b = (s4 * (y1 * s0 - y0 * s1) - y2 * (s3 * s0 - s1 * s2) + s2 * (s3 * y0 - y1 * s2)) / det;
        if (a > 0) {
          var v = midT - b / (2 * a);
          if (Math.abs(v - midT) < 0.05) return (v + midT) / 2;
        }
      }
    }
    return midT;
  }

  // ボールが頭に当たった瞬間（HeadingCounter と同じ見つけ方）。頂点にいちばん近いもの
  function ballContact(frames, near) {
    var c = new HC.HeadingCounter({ cooldown: 0.3 }), evs = [];
    frames.forEach(function (f) {
      var head = f.lm ? HC.headOf(f.lm) : null;
      var ev = c.push(f.t, f.ball, head);
      if (ev) { ev.head = head; evs.push(ev); }
    });
    // 陰で見えなくなって当たりにしたものは、頭をそのコマのものに合わせ直す
    evs.forEach(function (ev) {
      var i = nearestIndex(frames, ev.t);
      var h = frames[i].lm ? HC.headOf(frames[i].lm) : null;
      if (h) ev.head = h;
    });
    var best = null;
    evs.forEach(function (ev) { if (!best || Math.abs(ev.t - near) < Math.abs(best.t - near)) best = ev; });
    return best;
  }

  // 手でボールをつかんだ瞬間: ボールが手首の近くに来て、そこから離れない最初のコマ（肩より上）
  function catchMoment(frames, t0, t1) {
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      if (f.t < t0 || f.t > t1 || !f.ball || !f.lm) continue;
      var head = HC.headOf(f.lm);
      if (!head) continue;
      var sh = avgPt(f.lm, [L.lsh, L.rsh]);
      if (sh && f.ball.y > sh.y) continue;
      var lim = f.ball.r * 1.3 + head.s * 1.3, hit = false;
      [L.lwr, L.rwr].forEach(function (k) {
        var w = f.lm[k];
        if (vis(w) && Math.sqrt((w.x - f.ball.x) * (w.x - f.ball.x) + (w.y - f.ball.y) * (w.y - f.ball.y)) < lim) hit = true;
      });
      if (!hit) continue;
      // その後 0.15 秒、ボールが遠くへ離れていかないこと（見えなくなるのは手の中なので可）
      var stay = true;
      for (var j = i + 1; j < frames.length && frames[j].t - f.t <= 0.15; j++) {
        var b = frames[j].ball;
        if (b && Math.abs(b.y - f.ball.y) > lim * 1.5) { stay = false; break; }
      }
      if (stay) return { t: f.t, ball: f.ball };
    }
    return null;
  }

  // ---------- 採点 ----------
  // 'A'=◎ 'B'=○ 'C'=△。null は測れなかった
  var ORDER = { A: 0, B: 1, C: 2 };
  function worst() {
    var w = null;
    for (var i = 0; i < arguments.length; i++) { var g = arguments[i]; if (g && (!w || ORDER[g] > ORDER[w])) w = g; }
    return w;
  }
  // 付け足しの項目は ◎ を ○ に下げるだけ
  function soften(main, sub) { return main === 'A' && (sub === 'B' || sub === 'C') ? 'B' : main; }
  function band(v, a, b, higherIsBetter) {
    if (v == null) return null;
    if (higherIsBetter === false) return v <= a ? 'A' : v <= b ? 'B' : 'C';
    return v >= a ? 'A' : v >= b ? 'B' : 'C';
  }
  // 頂点との差（当たった − 頂点、秒）。わずかに手前（上がりきる直前）までを ◎ にする
  var TIMING = { aLo: -0.07, aHi: 0.03, bLo: -0.12, bHi: 0.07 };
  function timingGrade(dt) {
    if (dt == null) return null;
    if (dt >= TIMING.aLo && dt <= TIMING.aHi) return 'A';
    if (dt >= TIMING.bLo && dt <= TIMING.bHi) return 'B';
    return 'C';
  }
  function timingClass(dt) { return dt == null ? null : dt < TIMING.aLo ? 'early' : dt > TIMING.aHi ? 'late' : 'ok'; }

  function gradeRep(m, mode) {
    var it = {};
    it.armUp = band(m.armUpCm, 8, -5);
    it.takeKnee = m.takeoffKneeDeg == null ? null : (m.takeoffKneeDeg >= 90 && m.takeoffKneeDeg <= 140 ? 'A' : m.takeoffKneeDeg >= 75 && m.takeoffKneeDeg <= 158 ? 'B' : 'C');
    it.arch = band(m.archDeg, 12, 6);
    it.chin = band(m.chinUpDeg, 15, 28, false);
    it.timing = timingGrade(m.timingSec);
    it.share = band(m.bodyShare, 0.7, 0.5);
    it.swing = band(m.swingDeg, 20, 10);
    it.pull = band(m.armPullCm, 8, 3);
    it.contact = m.contact == null ? null : m.contact === 'forehead' ? 'A' : 'C';
    it.landKnee = band(m.landKneeDeg, 150, 165, false);
    it.landFeet = band(m.landFeetGapSec, 0.08, 0.15, false);
    var g = {
      takeoff: soften(it.armUp, it.takeKnee) || it.takeKnee,
      air: soften(it.arch, it.chin),
      timing: it.timing,
      swing: soften(worst(it.share, it.swing), it.pull),
      contact: mode === 'ball' ? it.contact : null,
      landing: soften(it.landKnee, it.landFeet)
    };
    if (mode === 'catch') { g.swing = null; g.air = soften(it.arch, it.chin); }
    return { g: g, items: it };
  }

  // ---------- 1 本の分析 ----------
  // o: {heightCm, mode: 'shadow'|'catch'|'ball', pxPerCm?（前の本の値。立ったコマが無いときに使う）}
  function analyzeRep(frames, o) {
    o = o || {};
    var mode = o.mode || 'shadow';
    var res = { mode: mode, ok: false, m: {}, t: {}, k: {}, g: {}, items: {}, notes: [] };
    if (!frames || frames.length < 8) { res.error = 'short'; return res; }
    var facing = res.facing = facingOf(frames);
    var ds = [];
    frames.forEach(function (f, i) { var d = derive(f, facing); if (d) { d.i = i; ds.push(d); } });
    if (ds.length < 8) { res.error = 'body'; return res; }
    ['lean', 'neck', 'elbowRise', 'wristRise', 'knee'].forEach(function (k) { smooth(ds, k); });

    var ref = HC.standingRef(frames.map(function (f) { return { t: f.t, body: f.lm ? HC.bodyOf(f.lm) : null }; }), o.heightCm || 160);
    var ppc = ref ? ref.pxPerCm : (o.pxPerCm || null);
    res.pxPerCm = ppc;
    var cm = function (px) { return px == null || !ppc ? null : px / ppc; };
    var feet = ds.filter(function (d) { return d.foot != null; }).map(function (d) { return d.foot; });
    var ground = quantile(feet, 0.8);
    res.groundY = ground;
    var liftPx = ppc ? LIFT_CM * ppc : (ref ? ref.headS * 0.45 : ds[0].head.s * 0.45);
    var fl = ground == null ? null : findFlight(ds, ground, liftPx);
    var tEnd = frames[frames.length - 1].t;
    var m = res.m, t = res.t;

    if (fl) {
      t.takeoff = fl.takeoff; t.landing = fl.landing; t.apex = apexOf(ds, fl);
      var hCm = G * fl.dur * fl.dur / 8 + LIFT_CM;     // 足が LIFT 浮いてからの滞空 → 跳んだ高さ
      m.jumpCm = Math.round(hCm);
      m.flightSec = r2(Math.sqrt(8 * hCm / G));        // 足が地面を離れてからの本当の滞空時間
    } else {
      res.notes.push('nojump');
    }
    var w0 = fl ? fl.takeoff - 0.2 : frames[0].t, w1 = fl ? fl.landing : tEnd;

    // 反りの最大
    var archD = minBy(inWin(ds, 'leanS', w0, w1), 'leanS');
    if (archD) { t.arch = archD.t; m.archDeg = Math.max(0, Math.round(-archD.leanS)); }

    // 当たった瞬間
    var impact = null, contactHead = null;
    if (mode === 'ball') {
      var ev = ballContact(frames, t.apex != null ? t.apex : (t.arch != null ? t.arch + 0.15 : tEnd / 2));
      if (ev) {
        impact = ev.t; res.ball = ev.ball; contactHead = ev.head;
        if (ev.ball && ev.head) m.contact = HC.classifyContact(ev.ball, ev.head);
        if (ev.ball && ppc && ground != null) m.contactHeightCm = Math.round(cm(ground - ev.ball.y));
      } else res.notes.push('noball');
    } else if (mode === 'catch') {
      var c = catchMoment(frames, w0, w1 + 0.1);
      if (c) { impact = c.t; res.ball = c.ball; if (ppc && ground != null) m.catchHeightCm = Math.round(cm(ground - c.ball.y)); }
      else {
        // ボールが見つからないときは、手がいちばん高くなった瞬間で代わりにする
        var hi = maxBy(inWin(ds, 'wristRiseS', w0, w1), 'wristRiseS');
        if (hi) { impact = hi.t; res.notes.push('catchGuess'); }
      }
    }
    // 振り戻し: 反りから前へ、上体がいちばん速く戻った瞬間
    var swingPeak = null;
    if (archD) {
      for (var i = 1; i < ds.length - 1; i++) {
        var p = ds[i - 1], q = ds[i + 1];
        if (ds[i].t < archD.t || ds[i].t > (fl ? fl.landing - 0.02 : tEnd) || p.leanS == null || q.leanS == null || q.t === p.t) continue;
        var w = (q.leanS - p.leanS) / (q.t - p.t);
        if (!swingPeak || w > swingPeak.w) swingPeak = { t: ds[i].t, w: w };
      }
    }
    if (swingPeak && swingPeak.w > 0) m.swingSpeed = Math.round(swingPeak.w);
    if (impact == null && mode !== 'catch') {
      if (mode === 'ball') res.notes.push('impactFromBody');
      if (swingPeak && swingPeak.w > 30) impact = swingPeak.t;
      else if (t.apex != null) { impact = t.apex; res.notes.push('noswing'); }
    }
    t.impact = impact;

    if (impact != null && t.apex != null) {
      m.timingSec = r2(impact - t.apex);
      m.dropCm = Math.round(0.5 * G * (impact - t.apex) * (impact - t.apex));
    }
    // 打点（頭のてっぺんの高さ）と、立ったときとの差
    if (impact != null && ppc && ground != null) {
      var hd = contactHead ? contactHead.y - contactHead.s : valueAt(ds, 'headTop', impact);
      if (hd != null) {
        m.headTopCm = Math.round(cm(ground - hd));
        m.reachCm = Math.round(m.headTopCm - (o.heightCm || 160));
      }
    }
    // 振りの大きさ・体で振ったか・あご
    if (archD && impact != null && mode !== 'catch') {
      var endT = impact + 0.05;
      var fwd = maxBy(inWin(ds, 'leanS', archD.t, Math.min(tEnd, endT + 0.1)), 'leanS');
      if (fwd) m.swingDeg = Math.round(fwd.leanS - archD.leanS);
      var nA = valueAt(ds, 'neckS', archD.t), nI = valueAt(ds, 'neckS', endT), lI = valueAt(ds, 'leanS', endT);
      if (nA != null && nI != null && lI != null) {
        var trunkD = lI - archD.leanS, neckD = Math.max(0, nI - nA);
        if (trunkD + neckD > 4) m.bodyShare = r2(Math.max(0, trunkD) / (Math.max(0, trunkD) + neckD));
      }
    }
    if (archD) {
      var pre = ds.filter(function (d) { return d.neckS != null && d.t < (fl ? fl.takeoff - 0.1 : archD.t - 0.3); }).map(function (d) { return d.neckS; });
      var nArch = valueAt(ds, 'neckS', archD.t);
      if (pre.length >= 3 && nArch != null) m.chinUpDeg = Math.max(0, Math.round(median(pre) - nArch));
    }
    // 腕: 踏み切りで振り上げたか、振り戻しで引いたか
    if (fl) {
      var up = maxBy(inWin(ds, 'wristRiseS', fl.takeoff - 0.05, fl.takeoff + 0.3), 'wristRiseS');
      if (up && ppc) m.armUpCm = Math.round(cm(up.wristRiseS));
      if (impact != null && ppc) {
        var eHi = maxBy(inWin(ds, 'elbowRiseS', fl.takeoff, impact), 'elbowRiseS');
        var eAt = valueAt(ds, 'elbowRiseS', impact + 0.05);
        if (eHi && eAt != null) m.armPullCm = Math.max(0, Math.round(cm(eHi.elbowRiseS - eAt)));
      }
      var kn = minBy(inWin(ds, 'kneeS', fl.takeoff - 0.4, fl.takeoff), 'kneeS');
      if (kn) m.takeoffKneeDeg = Math.round(kn.kneeS);
      var h0 = null, h1 = null;
      ds.forEach(function (d) {
        if (!d.hip) return;
        if (d.t <= fl.takeoff - 0.25 && (!h0 || d.t > h0.t)) h0 = d;
        if (d.t <= fl.takeoff && (!h1 || d.t > h1.t)) h1 = d;
      });
      if (h0 && h1 && h1.t - h0.t > 0.1 && ppc) m.approachMs = r1(Math.max(0, (h1.hip.x - h0.hip.x) * facing / (h1.t - h0.t) / ppc / 100));
      var fk = maxBy(inWin(ds, 'kneeHigh', fl.takeoff, fl.takeoff + 0.3), 'kneeHigh');
      if (fk && ppc) m.freeKneeCm = Math.round(cm(fk.kneeHigh));
      // 着地: 膝をどれだけ曲げたか、両足がそろって着いたか
      var lk = minBy(inWin(ds, 'kneeS', fl.landing, fl.landing + 0.4), 'kneeS');
      if (lk) m.landKneeDeg = Math.round(lk.kneeS);
      var thr = ground - liftPx, touch = function (key) {
        for (var j = 0; j < ds.length; j++) {
          var d = ds[j];
          if (d.t > (t.apex || fl.takeoff) && d[key] != null && d[key] >= thr) return d.t;
        }
        return null;
      };
      var tl = touch('footL'), tr = touch('footR');
      if (tl != null && tr != null && fl.closed) m.landFeetGapSec = r2(Math.abs(tl - tr));
    }

    var gr = gradeRep(m, mode);
    res.g = gr.g; res.items = gr.items;
    ['takeoff', 'arch', 'apex', 'impact', 'landing'].forEach(function (k) { if (t[k] != null) res.k[k] = nearestIndex(frames, t[k]); });
    res.ok = impact != null || !!fl;
    if (!res.ok) res.error = 'nomove';
    return res;
  }

  // ---------- ひとこと（次の 1 本に向けて。体の外に意識を向ける言い方で） ----------
  var PHASES = [
    { id: 'takeoff', label: '踏み切り' },
    { id: 'air', label: '空中姿勢' },
    { id: 'timing', label: 'タイミング' },
    { id: 'swing', label: '体で振る' },
    { id: 'contact', label: '当てる場所' },
    { id: 'landing', label: '着地' }
  ];
  var PRAISE = {
    takeoff: '腕の振り上げと踏み切り、いい感じ！',
    air: 'きれいな弓の形ができている！',
    timing: 'ドンピシャ！ 一番高いところで放てている',
    swing: '体全体で叩けている！',
    contact: 'おでこの真ん中で当てられている！',
    landing: '両足でやわらかく着地できている'
  };
  function issueText(item, m, mode) {
    switch (item) {
      case 'timing':
        if (timingClass(m.timingSec) === 'early') return mode === 'ball' ? '跳ぶのが早い。ボールをもう一瞬待って、上がりきったところで叩こう'
          : mode === 'catch' ? '手を出すのが早い。上がりきったところでボールをつかもう' : '振るのが早い。一番高いところまでガマンしてから振ろう';
        return mode === 'ball' ? '落ちながら当たっている。もう少し早く跳んで、上で待とう'
          : mode === 'catch' ? '落ちながらつかんでいる。もう少し早く跳んで、上で待とう' : '振るのが遅い。上がりきったらすぐ振ろう';
      case 'arch': return '胸を空に向けて、弓を引くように反ろう';
      case 'chin': return 'あごが上がっている。ボールの上半分を見続けよう';
      case 'share': return '首だけで振っている。おへそからボールにぶつかっていこう';
      case 'swing': return '反ったら、お腹の力で一気に前へ。ボールを地面に叩きつけるつもりで';
      case 'pull': return '振るときに両ひじを後ろへ引こう。体が前に速く出る';
      case 'armUp': return '両腕を下から大きく振り上げて跳ぼう';
      case 'takeKnee': return m.takeoffKneeDeg != null && m.takeoffKneeDeg < 90 ? '沈みすぎ。少し浅く沈んで、素早く地面を押そう' : '踏み切る前に少し沈んで、地面を強く押そう';
      case 'contact': return m.contact === 'top' ? '頭のてっぺんに当たっている。ボールを最後まで見て、おでこで迎えにいこう' : '当たる位置が低い。ボールの下にもぐらず、おでこで迎えにいこう';
      case 'landKnee': return '着地で膝が伸びている。ひざをやわらかく曲げて降りよう';
      case 'landFeet': return '片足で着地している。両足で降りよう';
    }
    return '';
  }
  var PHASE_ITEMS = {
    takeoff: ['armUp', 'takeKnee'], air: ['arch', 'chin'], timing: ['timing'],
    swing: ['share', 'swing', 'pull'], contact: ['contact'], landing: ['landKnee', 'landFeet']
  };
  // 局面の中で、直すべき項目（いちばん悪いもの、同じなら並び順で先）
  function worstItem(res, phase) {
    var best = null;
    PHASE_ITEMS[phase].forEach(function (k) {
      var g = res.items[k];
      if (g && g !== 'A' && (!best || ORDER[g] > ORDER[res.items[best]])) best = k;
    });
    return best;
  }
  var PRIORITY = ['timing', 'swing', 'air', 'contact', 'takeoff', 'landing'];
  // focus: 練習している局面（ステップのテーマ）。無ければいちばん直すべき所を選ぶ
  function coach(res, focus) {
    var g = res.g, out = { phase: null, grade: null, text: '', safety: '' };
    if (!focus || !g[focus]) {
      focus = null;
      ['C', 'B'].some(function (lv) {
        return PRIORITY.some(function (p) { if (g[p] === lv) { focus = p; return true; } return false; });
      });
      if (!focus) {
        var any = PRIORITY.filter(function (p) { return g[p]; });
        out.phase = any[0] || null; out.grade = out.phase ? 'A' : null;
        out.text = any.length ? '全部 ◎！ この感じをもう一度' : '';
        return out;
      }
    }
    out.phase = focus; out.grade = g[focus];
    if (g[focus] === 'A') out.text = PRAISE[focus];
    else out.text = issueText(worstItem(res, focus) || PHASE_ITEMS[focus][0], res.m, res.mode);
    if (focus !== 'landing' && g.landing === 'C') out.safety = issueText(worstItem(res, 'landing') || 'landKnee', res.m, res.mode);
    return out;
  }

  // ---------- その場でジャンプを見つける（撮りっぱなしで、跳んだら自動で切り出す） ----------
  // push(t, lm) を毎コマ（姿勢を見たコマだけでよい）呼ぶ。着地して settle 秒たったら {takeoff, landing} を返す
  function JumpTrigger(o) {
    o = o || {};
    this.minAir = o.minAir || 0.2;      // 走っているときの一瞬の浮きは数えない
    this.maxAir = o.maxAir || 1.2;
    this.settle = o.settle == null ? 0.45 : o.settle;
    this.reset();
  }
  JumpTrigger.prototype.reset = function () {
    this.hist = []; this.state = 'ground'; this.air0 = null; this.land = null; this.lastSeen = -Infinity; this.lastGroundPt = null; this.span = null;
  };
  JumpTrigger.prototype.ground = function () {
    var ys = this.hist.map(function (h) { return h.y; });
    return ys.length >= 8 ? quantile(ys, 0.85) : null;
  };
  // 準備 OK（全身が見えていて、地面の高さがわかっている）
  JumpTrigger.prototype.ready = function (t) { return this.ground() != null && t - this.lastSeen < 0.5; };
  JumpTrigger.prototype.push = function (t, lm) {
    var head = lm ? HC.headOf(lm) : null;
    var foot = lm ? lowest(lm, [L.lank, L.rank, L.lheel, L.rheel, L.lfoot, L.rfoot]) : null;
    if (!head || foot == null) {
      if (this.state !== 'ground' && t - this.lastSeen > 0.5) this.reset();
      return null;
    }
    this.lastSeen = t;
    var span = foot - (head.y - head.s);
    this.span = this.span == null ? span : this.span * 0.9 + span * 0.1;
    var g = this.ground(), thr = g == null ? null : g - this.span * 0.035;
    var air = thr != null && foot < thr;
    if (this.state === 'ground') {
      if (!air) {
        this.hist.push({ t: t, y: foot });
        while (this.hist.length && t - this.hist[0].t > 2) this.hist.shift();
        this.lastGroundPt = { t: t, y: foot };
      } else {
        var p = this.lastGroundPt;
        this.air0 = p && t - p.t < 0.15 && p.y > foot ? p.t + (t - p.t) * (p.y - thr) / (p.y - foot) : t;
        this.state = 'air';
      }
      return null;
    }
    if (this.state === 'air') {
      if (t - this.air0 > this.maxAir) { this.state = 'ground'; this.hist = []; return null; }
      if (!air) {
        if (t - this.air0 >= this.minAir) { this.land = t; this.state = 'landed'; }
        else this.state = 'ground';
      }
      return null;
    }
    // landed: 着地の姿勢まで撮ってから返す
    if (t - this.land >= this.settle) {
      var ev = { takeoff: this.air0, landing: this.land };
      this.state = 'ground';
      return ev;
    }
    return null;
  };

  // ---------- 段階別のステップ（中学生向け） ----------
  //  mode: shadow=ボールなし / catch=投げたボールを手でキャッチ / ball=ヘディング
  var STEPS = [
    { id: 's1', title: '弓を引く', mode: 'shadow', run: false, focus: 'air',
      how: 'その場で両足ジャンプ。両腕を振り上げて、胸を空に向けて反る', goal: '上体の反り 12° 以上' },
    { id: 's2', title: '一番高いところで放つ', mode: 'shadow', run: false, focus: 'timing',
      how: 'その場ジャンプ。上がりきったところで、反った体を一気に前へ', goal: '頂点との差 −0.07〜+0.03 秒' },
    { id: 's3', title: '体で叩く', mode: 'shadow', run: false, focus: 'swing',
      how: '首は固めて、おへそから前へ。ひじを後ろへ引いて勢いをつける', goal: '振りの 7 割以上を体で・20° 以上振る' },
    { id: 's4', title: '最高点キャッチ', mode: 'catch', run: false, focus: 'timing',
      how: '下から投げてもらったボールを、ジャンプして一番高いところで両手でつかむ（ヘディング 0 回）', goal: '頂点でキャッチ' },
    { id: 's5', title: '助走から放つ', mode: 'shadow', run: true, focus: 'timing',
      how: '2〜3 歩の助走から片足で踏み切る。勢いを止めずに、頂点で振る', goal: '助走つきで頂点との差 −0.07〜+0.03 秒' },
    { id: 's6', title: 'ジャンプヘッド', mode: 'ball', run: false, focus: 'contact',
      how: '下から投げてもらったボールを、その場ジャンプでおでこに当てる（ボールネットのペンデルでも OK）', goal: 'おでこの真ん中で当てる' },
    { id: 's7', title: '助走ジャンプヘッド', mode: 'ball', run: true, focus: 'timing',
      how: '助走から片足で踏み切り、一番高いところで叩く', goal: '頂点との差 −0.07〜+0.03 秒' }
  ];
  var PASS_OF = 5, PASS_NEED = 3;   // 直近 5 本のうち ◎ が 3 本で合格

  var MODES = {
    shadow: { label: 'ボールなし', icon: '🌀', load: false },
    catch: { label: '最高点キャッチ', icon: '🙌', load: false },
    ball: { label: 'ボールあり', icon: '⚽', load: true }
  };
  // JFA「育成年代でのヘディング習得のためのガイドライン」U-13〜15: ペアが投げたボールのヘディング 10 回／週
  var WEEK_CAP = 10;

  var api = {
    G: G, analyzeRep: analyzeRep, JumpTrigger: JumpTrigger, coach: coach, gradeRep: gradeRep, timingGrade: timingGrade, timingClass: timingClass,
    facingOf: facingOf, findFlight: findFlight, PHASES: PHASES, PRIORITY: PRIORITY, STEPS: STEPS, MODES: MODES, TIMING: TIMING,
    PASS_OF: PASS_OF, PASS_NEED: PASS_NEED, WEEK_CAP: WEEK_CAP, issueText: issueText
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HeadingForm = api;
})(typeof window !== 'undefined' ? window : this);
