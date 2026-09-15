/* 📊 選手と記録の保存（端末の中だけ）と CSV 書き出し。DOM なし（storage には localStorage を渡す）。
   映像は保存しない。残すのはタイムや回数などの数字だけ */
(function (root) {
  'use strict';

  var KEY = 'trainingsystem.records.v1';
  // best: 'min'=小さいほど良い / 'max'=大きいほど良い / null=ベストを出さない（回数の見守り用）
  var KINDS = {
    sprint10: { label: '10m スプリント', unit: '秒', best: 'min', digits: 2 },
    sprint20: { label: '20m スプリント', unit: '秒', best: 'min', digits: 2 },
    sprint30: { label: '30m スプリント', unit: '秒', best: 'min', digits: 2 },
    agility505: { label: '505 アジリティ', unit: '秒', best: 'min', digits: 2 },
    heading: { label: 'ヘディング回数', unit: '回', best: null, digits: 0 },
    headHeight: { label: 'ヘディング打点の高さ', unit: 'cm', best: 'max', digits: 0 },
    headJump: { label: 'ヘディングのジャンプ', unit: 'cm', best: 'max', digits: 0 }
  };

  function empty() { return { players: [], records: [] }; }
  function load(storage) {
    try {
      var s = JSON.parse(storage.getItem(KEY));
      if (s && Array.isArray(s.players) && Array.isArray(s.records)) return s;
    } catch (e) { /* 壊れていたら空から */ }
    return empty();
  }
  function save(storage, store) {
    try { storage.setItem(KEY, JSON.stringify(store)); return true; } catch (e) { return false; }
  }

  var seq = 0;
  function uid(p) { return p + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6); }

  function addPlayer(store, name, num) {
    name = String(name == null ? '' : name).trim().slice(0, 20);
    if (!name) return null;
    var p = { id: uid('p'), name: name, num: String(num == null ? '' : num).replace(/[^0-9]/g, '').slice(0, 3) };
    store.players.push(p);
    return p;
  }
  function removePlayer(store, id) {
    store.players = store.players.filter(function (p) { return p.id !== id; });
    store.records = store.records.filter(function (r) { return r.playerId !== id; });
  }
  function playerById(store, id) {
    for (var i = 0; i < store.players.length; i++) if (store.players[i].id === id) return store.players[i];
    return null;
  }

  function addRecord(store, playerId, kind, value, when) {
    if (!KINDS[kind] || typeof value !== 'number' || !isFinite(value) || value < 0) return null;
    var r = {
      id: uid('r'),
      playerId: playerId || '',
      kind: kind,
      value: KINDS[kind].digits === 0 ? Math.round(value) : Math.round(value * 100) / 100,
      at: (when || new Date()).toISOString()
    };
    store.records.push(r);
    return r;
  }
  function removeRecord(store, id) {
    store.records = store.records.filter(function (r) { return r.id !== id; });
  }
  // 新しい順
  function recordsOf(store, playerId, kind) {
    return store.records.filter(function (r) {
      return (!playerId || r.playerId === playerId) && (!kind || r.kind === kind);
    }).sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
  }
  // タイムは一番速い記録、高さは一番高い記録。回数の種目はベストを出さない
  function best(store, playerId, kind) {
    var k = KINDS[kind];
    if (!k || !k.best) return null;
    var b = null;
    recordsOf(store, playerId, kind).forEach(function (r) {
      if (b === null || (k.best === 'min' ? r.value < b.value : r.value > b.value)) b = r;
    });
    return b;
  }
  function fmtValue(kind, v) {
    var k = KINDS[kind];
    return k && k.digits === 0 ? String(Math.round(v)) : Number(v).toFixed(2);
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  // その日の合計（ヘディングの回数の見守り用）
  function todayTotal(store, playerId, kind, now) {
    now = now || new Date();
    var s = 0;
    recordsOf(store, playerId, kind).forEach(function (r) { if (sameDay(new Date(r.at), now)) s += r.value; });
    return s;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function csvCell(v) {
    v = String(v == null ? '' : v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  // Excel で文字化けしないように先頭に BOM を付ける。古い順
  function toCSV(store) {
    var rows = [['日付', '時刻', '選手', '背番号', '種目', '記録', '単位']];
    store.records.slice().sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; }).forEach(function (r) {
      var d = new Date(r.at);
      var p = playerById(store, r.playerId) || { name: '（選手なし）', num: '' };
      var k = KINDS[r.kind] || { label: r.kind, unit: '' };
      rows.push([
        d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()),
        pad(d.getHours()) + ':' + pad(d.getMinutes()),
        p.name, p.num, k.label,
        fmtValue(r.kind, r.value),
        k.unit
      ]);
    });
    return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  var api = {
    KEY: KEY, KINDS: KINDS, load: load, save: save,
    addPlayer: addPlayer, removePlayer: removePlayer, playerById: playerById,
    addRecord: addRecord, removeRecord: removeRecord, recordsOf: recordsOf,
    best: best, todayTotal: todayTotal, toCSV: toCSV, fmtValue: fmtValue
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrainingRecords = api;
})(typeof window !== 'undefined' ? window : this);
