/* 共通の部品: 音・カメラ・画面ロック・選手の選択・記録の保存・トースト・CSV */
(function () {
  'use strict';
  var R = window.TrainingRecords;

  // ---------- 音 ----------
  var audioCtx = null;
  function audio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function beep(freq, dur, gainVal, type) {
    try {
      var ac = audio();
      var osc = ac.createOscillator(), gain = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(gainVal || 0.2, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + (dur || 0.12));
      osc.connect(gain).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + (dur || 0.12));
    } catch (e) { /* 音が出せなくても続ける */ }
  }
  // 合図の「ドン」。鳴らした瞬間の performance.now() を返す
  function bang() {
    beep(220, 0.35, 0.6, 'square');
    beep(880, 0.25, 0.3, 'sine');
    return performance.now();
  }
  function unlockAudio() { try { audio(); } catch (e) { /* ignore */ } }

  // ---------- カメラ ----------
  function startCamera(video, o) {
    o = o || {};
    if (video._stream) { video._stream.getTracks().forEach(function (t) { t.stop(); }); video._stream = null; }
    var c = { audio: false, video: { facingMode: o.facing || 'environment',
      width: { ideal: o.width || 1280 }, height: { ideal: o.height || 720 }, frameRate: { ideal: o.fps || 60 } } };
    return navigator.mediaDevices.getUserMedia(c).then(function (s) {
      video._stream = s;
      video.srcObject = s;
      video.muted = true;
      video.setAttribute('playsinline', '');
      return video.play().then(function () {
        var tr = s.getVideoTracks()[0];
        var st = tr && tr.getSettings ? tr.getSettings() : {};
        return { stream: s, width: video.videoWidth, height: video.videoHeight, fps: st.frameRate || 30, facing: st.facingMode || o.facing };
      });
    });
  }
  function cameraError(err) {
    var msg = String(err && (err.name || err.message) || err);
    if (!window.isSecureContext) return 'このページは HTTPS で開く必要があります（ホーム画面のアイコン、または https:// のアドレスから開いてください）';
    if (msg.indexOf('NotAllowed') !== -1) return 'カメラの使用が許可されませんでした。ブラウザの設定でカメラを許可してください';
    if (msg.indexOf('NotFound') !== -1 || msg.indexOf('Overconstrained') !== -1) return 'カメラが見つかりませんでした';
    if (msg.indexOf('NotReadable') !== -1) return 'カメラを他のアプリが使っています。閉じてからもう一度';
    return 'カメラを起動できませんでした（' + msg + '）';
  }
  var wakeLock = null;
  function keepAwake() {
    try {
      if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (wl) { wakeLock = wl; }).catch(function () {});
    } catch (e) { /* ignore */ }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && wakeLock) keepAwake(); });

  // ---------- 記録 ----------
  var store = R.load(localStorage);
  function saveStore() { R.save(localStorage, store); }
  function playersSorted() {
    return store.players.slice().sort(function (a, b) {
      var an = parseInt(a.num, 10), bn = parseInt(b.num, 10);
      if (isFinite(an) && isFinite(bn) && an !== bn) return an - bn;
      return a.name.localeCompare(b.name, 'ja');
    });
  }
  // 選手を選ぶ <select> と「＋追加」ボタン。onChange(playerId|'') を呼ぶ。最後に選んだ選手を覚える
  function playerPicker(el, onChange) {
    var sel = document.createElement('select');
    var add = document.createElement('button');
    add.textContent = '＋';
    add.title = '選手を追加';
    add.className = 'ghost';
    function render() {
      var cur = sel.value || localStorage.getItem('trainingsystem.lastPlayer') || '';
      sel.innerHTML = '<option value="">選手を選ばない</option>' + playersSorted().map(function (p) {
        return '<option value="' + p.id + '">' + (p.num ? '#' + p.num + ' ' : '') + esc(p.name) + '</option>';
      }).join('');
      sel.value = R.playerById(store, cur) ? cur : '';
    }
    sel.addEventListener('change', function () {
      localStorage.setItem('trainingsystem.lastPlayer', sel.value);
      onChange && onChange(sel.value);
    });
    add.addEventListener('click', function () {
      var name = prompt('選手の名前');
      if (!name || !name.trim()) return;
      var num = prompt('背番号（なければ空でOK）') || '';
      var p = R.addPlayer(store, name, num);
      if (!p) return;
      saveStore();
      render();
      sel.value = p.id;
      localStorage.setItem('trainingsystem.lastPlayer', p.id);
      onChange && onChange(p.id);
    });
    el.classList.add('pick');
    el.appendChild(sel); el.appendChild(add);
    render();
    return { get: function () { return sel.value; }, refresh: render, el: sel };
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- トースト・CSV ----------
  var toastEl = null, toastTimer = 0;
  function toast(msg, ms) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2200);
  }
  function downloadText(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/csv' });
    if (navigator.share && navigator.canShare) {
      try {
        var file = new File([blob], name, { type: blob.type });
        if (navigator.canShare({ files: [file] })) return navigator.share({ files: [file], title: name }).catch(function () {});
      } catch (e) { /* 共有できない端末は下へ */ }
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return Promise.resolve();
  }
  function fmtSec(s) { return (Math.round(s * 100) / 100).toFixed(2); }

  // ---------- オフライン用 ----------
  function registerSW() {
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  window.TS = { beep: beep, bang: bang, unlockAudio: unlockAudio, startCamera: startCamera, cameraError: cameraError, keepAwake: keepAwake,
    store: store, saveStore: saveStore, players: playersSorted, playerPicker: playerPicker, esc: esc,
    toast: toast, downloadText: downloadText, fmtSec: fmtSec, registerSW: registerSW };
})();
