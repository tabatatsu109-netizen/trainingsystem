const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/records.js');

function mem() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; }

test('選手の登録・削除。削除すると記録も消える', () => {
  const st = R.load(mem());
  const p = R.addPlayer(st, ' 太郎 ', '10');
  assert.equal(p.name, '太郎'); assert.equal(p.num, '10');
  assert.equal(R.addPlayer(st, '   '), null);
  R.addRecord(st, p.id, 'sprint10', 2.345);
  R.removePlayer(st, p.id);
  assert.deepEqual(st.players, []); assert.deepEqual(st.records, []);
});

test('記録: タイムは 0.01 秒、回数は整数。ベストは一番速い。壊れた値は入れない', () => {
  const st = R.load(mem());
  const p = R.addPlayer(st, 'A');
  assert.equal(R.addRecord(st, p.id, 'sprint10', 2.345).value, 2.35);
  assert.equal(R.addRecord(st, p.id, 'sprint10', 2.10).value, 2.1);
  assert.equal(R.addRecord(st, p.id, 'heading', 7.6).value, 8);
  assert.equal(R.addRecord(st, p.id, 'nope', 1), null);
  assert.equal(R.addRecord(st, p.id, 'sprint10', NaN), null);
  assert.equal(R.best(st, p.id, 'sprint10').value, 2.1);
  assert.equal(R.best(st, p.id, 'heading'), null, '回数にベストは無い');
  R.addRecord(st, p.id, 'headHeight', 152); R.addRecord(st, p.id, 'headHeight', 160.4);
  assert.equal(R.best(st, p.id, 'headHeight').value, 160, '高さは一番高い');
  assert.equal(R.recordsOf(st, p.id, 'sprint10').length, 2);
});

test('保存して読み直せる。壊れていれば空から', () => {
  const s = mem();
  const st = R.load(s);
  R.addPlayer(st, 'B');
  assert.equal(R.save(s, st), true);
  assert.equal(R.load(s).players[0].name, 'B');
  s.setItem(R.KEY, '{broken');
  assert.deepEqual(R.load(s), { players: [], records: [] });
});

test('今日の合計（ヘディングの見守り）と CSV', () => {
  const st = R.load(mem());
  const p = R.addPlayer(st, '花子', '7');
  const today = new Date(2026, 8, 16, 10, 0), yesterday = new Date(2026, 8, 15, 10, 0);
  R.addRecord(st, p.id, 'heading', 5, today);
  R.addRecord(st, p.id, 'heading', 4, today);
  R.addRecord(st, p.id, 'heading', 9, yesterday);
  assert.equal(R.todayTotal(st, p.id, 'heading', today), 9);
  R.addRecord(st, p.id, 'sprint20', 3.8, today);
  const csv = R.toCSV(st);
  assert.ok(csv.startsWith('﻿日付,時刻,選手,背番号,種目,記録,単位'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 5);
  assert.ok(lines[1].startsWith('2026/09/15,10:00,花子,7,ヘディング回数,9,回'), lines[1]);
  assert.ok(lines[4].includes('20m スプリント,3.80,秒'), lines[4]);
});
