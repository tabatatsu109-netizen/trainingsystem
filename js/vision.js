/* MediaPipe（端末の中で動く姿勢・ボールの検出）。部品とモデルはこのアプリの中に置いてあるので、オフラインでも動く */
import { FilesetResolver, PoseLandmarker, ObjectDetector } from '../vendor/mediapipe/vision_bundle.mjs';

let fileset = null;
async function wasm() {
  if (!fileset) fileset = await FilesetResolver.forVisionTasks('vendor/mediapipe/wasm');
  return fileset;
}
async function withFallback(make) {
  try { return await make('GPU'); }
  catch (e) { console.warn('GPU が使えないので CPU で動かします', e); return await make('CPU'); }
}
// kind: 'lite'（速い・その場で数える用） / 'full'（正確・フォーム分析用）
export async function createPose(kind, runningMode) {
  const fs = await wasm();
  return withFallback(delegate => PoseLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetPath: `models/pose_landmarker_${kind === 'full' ? 'full' : 'lite'}.task`, delegate },
    runningMode: runningMode || 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5
  }));
}
export async function createBall(runningMode) {
  const fs = await wasm();
  return withFallback(delegate => ObjectDetector.createFromOptions(fs, {
    baseOptions: { modelAssetPath: 'models/efficientdet_lite0.tflite', delegate },
    runningMode: runningMode || 'VIDEO', maxResults: 2, scoreThreshold: 0.25, categoryAllowlist: ['sports ball']
  }));
}
// 検出結果 → いちばん確かなボール {x, y, r, score}（px）。無ければ null
export function ballFrom(result) {
  let best = null;
  for (const d of (result && result.detections) || []) {
    const b = d.boundingBox, s = d.categories && d.categories[0] ? d.categories[0].score : 0;
    if (!b || (best && s <= best.score)) continue;
    best = { x: b.originX + b.width / 2, y: b.originY + b.height / 2, r: Math.max(b.width, b.height) / 2, score: s };
  }
  return best;
}
export const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS;
