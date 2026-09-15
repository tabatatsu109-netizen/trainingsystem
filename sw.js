/* オフライン用: ページ・部品・AI モデルを最初に開いたときに端末へ入れておく（合計 約45MB）。
   2 回目からはネットが無くても動く。VERSION を上げると入れ直す */
const VERSION = 'ts-v1';
const FILES = [
  'index.html', 'timing.html', 'heading.html', 'records.html',
  'lifting-counter.html', 'jump-meter.html', 'delay-replay.html',
  'manifest.webmanifest', 'css/app.css',
  'js/records.js', 'js/common.js', 'js/timing-core.js', 'js/heading-core.js', 'js/vision.js',
  'img/icon-192.png', 'img/icon-512.png', 'img/favicon.png',
  'vendor/mediapipe/vision_bundle.mjs',
  'vendor/mediapipe/wasm/vision_wasm_internal.js', 'vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js', 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
  'models/pose_landmarker_lite.task', 'models/pose_landmarker_full.task', 'models/efficientdet_lite0.tflite'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(async c => {
    // 大きいファイルは 1 つずつ（失敗しても他は入れる）
    for (const f of FILES) { try { await c.add(new Request(f, { cache: 'reload' })); } catch (err) { console.warn('cache miss', f, err); } }
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// ページや小さなファイルはまずネットから（更新がすぐ反映される）、つながらなければ端末の中のもの。
// AI モデルと wasm は大きいので端末の中のものを先に使う
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const big = /\.(wasm|task|tflite|png)$/.test(new URL(req.url).pathname);
  e.respondWith(big ? cacheFirst(req) : networkFirst(req));
});
async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
  return res;
}
async function networkFirst(req) {
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw e;
  }
}
