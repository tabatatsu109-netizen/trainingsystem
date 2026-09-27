/* 🧠 ヘディング練習のログ（端末の中だけ。DOM なし。storage には localStorage を渡す）
   1 本ごとの数字と ◎○△、ステップの合格、練習後の気づき、自分の感覚の予想を残す。映像は残さない */
(function (root) {
  'use strict';
  var HF = root && root.HeadingForm ? root.HeadingForm : require('./heading-form.js');
  var KEY = 'trainingsystem.heading.v2';
  var MAX_REPS = 1500;

  function empty() { return { reps: [], notes: [], passed: {} }; }
  function load(storage) {
    try {
      var s = JSON.parse(storage.getItem(KEY));
      if (s && Array.isArray(s.reps) && Array.isArray(s.notes)) { s.passed = s.passed || {}; return s; }
    } catch (e) { /* 壊れていたら空から */ }
    return empty();
  }
  function save(storage, log) {
    try { storage.setItem(KEY, JSON.stringify(log)); return true; } catch (e) { return false; }
  }
  var seq = 0;
  function uid(p) { return p + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6); }

  // res: HeadingForm.analyzeRep の結果。数字と評価だけ残す
  function addRep(log, playerId, stepId, res, extra, when) {
    extra = extra || {};
    var step = stepById(stepId);
    var focus = step ? step.focus : null;
    var rep = {
      id: uid('h'), at: (when || new Date()).toISOString(), playerId: playerId || '', stepId: stepId || null,
      mode: res.mode, m: res.m, g: res.g, focus: focus,
      pass: focus ? res.g[focus] === 'A' : null,
      hit: !!extra.hit, pred: extra.pred || null
    };
    if (rep.pred && res.m.timingSec != null) rep.predHit = rep.pred === HF.timingClass(res.m.timingSec);
    log.reps.push(rep);
    if (log.reps.length > MAX_REPS) log.reps.splice(0, log.reps.length - MAX_REPS);
    return rep;
  }
  function removeRep(log, id) { log.reps = log.reps.filter(function (r) { return r.id !== id; }); }
  function repsOf(log, playerId, stepId) {
    return log.reps.filter(function (r) { return (playerId == null || r.playerId === playerId) && (!stepId || r.stepId === stepId); });
  }
  function stepById(id) {
    for (var i = 0; i < HF.STEPS.length; i++) if (HF.STEPS[i].id === id) return HF.STEPS[i];
    return null;
  }
  function passKey(playerId, stepId) { return (playerId || '-') + ':' + stepId; }

  // ステップの状態: 直近 5 本の ◎ の数・合格・開いているか
  function stepState(log, playerId, stepId, openAll) {
    var idx = -1;
    HF.STEPS.forEach(function (s, i) { if (s.id === stepId) idx = i; });
    var recent = repsOf(log, playerId, stepId).slice(-HF.PASS_OF).map(function (r) { return r.pass === true; });
    var good = recent.filter(Boolean).length;
    var passed = !!log.passed[passKey(playerId, stepId)];
    var prev = idx > 0 ? HF.STEPS[idx - 1].id : null;
    var unlocked = !!openAll || idx <= 0 || !!log.passed[passKey(playerId, prev)] || passed || recent.length > 0;
    return { recent: recent, good: good, passed: passed, unlocked: unlocked, total: repsOf(log, playerId, stepId).length };
  }
  // 1 本足したあとに呼ぶ。今回はじめて合格したら true
  function checkPass(log, playerId, stepId) {
    if (!stepId) return false;
    var k = passKey(playerId, stepId);
    if (log.passed[k]) return false;
    var st = stepState(log, playerId, stepId);
    if (st.good >= HF.PASS_NEED) {
      log.passed[k] = new Date().toISOString();
      return true;
    }
    return false;
  }
  // いま取り組むステップ: 合格していない最初のもの（全部合格なら最後）
  function currentStep(log, playerId) {
    for (var i = 0; i < HF.STEPS.length; i++) if (!log.passed[passKey(playerId, HF.STEPS[i].id)]) return HF.STEPS[i];
    return HF.STEPS[HF.STEPS.length - 1];
  }

  // 週（月曜はじまり）
  function weekStart(now) {
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var wd = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - wd);
    return d;
  }
  // 今週、ボールが頭に当たった本数（playerId が '' なら選手なしの分だけ、null なら全員）
  function weekHits(log, playerId, now) {
    var from = weekStart(now || new Date()).getTime();
    return log.reps.filter(function (r) { return r.hit && (playerId == null || r.playerId === playerId) && new Date(r.at).getTime() >= from; }).length;
  }

  // 自分の感覚（予想）がどれだけ当たっているか。直近 n 回
  function senseStats(log, playerId, n) {
    var rs = log.reps.filter(function (r) { return r.playerId === (playerId || '') && r.predHit != null; }).slice(-(n || 20));
    return { n: rs.length, hit: rs.filter(function (r) { return r.predHit; }).length };
  }

  // 練習のまとめ（その日の本数・局面ごとの ◎ の割合・いちばん伸ばしたい局面）
  function sessionSummary(reps) {
    var by = {};
    HF.PHASES.forEach(function (p) { by[p.id] = { A: 0, B: 0, C: 0, n: 0 }; });
    reps.forEach(function (r) {
      Object.keys(r.g || {}).forEach(function (k) {
        var v = r.g[k];
        if (v && by[k]) { by[k][v]++; by[k].n++; }
      });
    });
    var weak = null, weakScore = Infinity;
    HF.PRIORITY.forEach(function (id) {   // 同じ点なら、直す順番が先のもの
      var b = by[id];
      if (b.n < 2) return;
      var score = (b.A * 2 + b.B) / (b.n * 2);
      if (score < weakScore) { weakScore = score; weak = id; }
    });
    var ts = reps.map(function (r) { return r.m && r.m.timingSec; }).filter(function (v) { return v != null; });
    var avgT = ts.length ? ts.reduce(function (a, b) { return a + b; }, 0) / ts.length : null;
    return { n: reps.length, by: by, weak: weakScore < 0.75 ? weak : null, avgTiming: avgT == null ? null : Math.round(avgT * 100) / 100 };
  }

  function addNote(log, playerId, chips, text, theme, when) {
    var n = { id: uid('n'), at: (when || new Date()).toISOString(), playerId: playerId || '', chips: chips || [], text: String(text || '').slice(0, 300), theme: theme || null };
    log.notes.push(n);
    if (log.notes.length > 300) log.notes.splice(0, log.notes.length - 300);
    return n;
  }
  function lastNote(log, playerId) {
    for (var i = log.notes.length - 1; i >= 0; i--) if (log.notes[i].playerId === (playerId || '')) return log.notes[i];
    return null;
  }
  function removePlayer(log, playerId) {
    log.reps = log.reps.filter(function (r) { return r.playerId !== playerId; });
    log.notes = log.notes.filter(function (n) { return n.playerId !== playerId; });
    Object.keys(log.passed).forEach(function (k) { if (k.indexOf(playerId + ':') === 0) delete log.passed[k]; });
  }

  var api = { KEY: KEY, load: load, save: save, addRep: addRep, removeRep: removeRep, repsOf: repsOf, stepById: stepById,
    stepState: stepState, checkPass: checkPass, currentStep: currentStep, weekStart: weekStart, weekHits: weekHits,
    senseStats: senseStats, sessionSummary: sessionSummary, addNote: addNote, lastNote: lastNote, removePlayer: removePlayer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HeadingLog = api;
})(typeof window !== 'undefined' ? window : this);
