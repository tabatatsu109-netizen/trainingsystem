# ⚽ トレーニングシステム

カメラを使った練習サポートアプリ。**映像は端末の中だけで処理し、保存もクラウド送信もしない**。
iPhone / iPad の Safari を主な対象にした Web アプリ（PWA）。一度開けばオフラインでも動く。

公開: https://grande-training.web.app （Firebase Hosting、サイト `grande-training`。戦術ボードと同じプロジェクト）

## ページ

| ページ | 内容 |
|---|---|
| `index.html` | メニュー |
| `timing.html` | ⏱ タイム計測（10m / 20m / 30m スプリント、505 アジリティ） |
| `heading.html` | 🧠 ヘディング（かぞえる／フォーム分析） |
| `records.html` | 📊 きろく（選手・ベスト・推移グラフ・CSV） |
| `lifting-counter.html` `jump-meter.html` `delay-replay.html` | 以前からのページ（TensorFlow.js を CDN から読むのでオンラインが必要） |

## 仕組み

### タイム計測（`js/timing-core.js`）
光電管と同じ考え方。画面に引いた線の位置の細い帯（左・中央・右の 3 本、腰〜胸の高さ）を毎コマ見て、
背景と違う画素が帯に増えた瞬間＝体が線を切った瞬間とする（`StripDiff` → `Gate`）。
AI を使わないので 60fps で回せ、コマとコマの間は直線で補う。`requestVideoFrameCallback` の `mediaTime` を時刻に使う。
- `SprintTimer`: スタート線→ゴール線（`lines`）、または合図の音→ゴール線（`signal`）
- `Agility505`: 計測線を出て、折り返し線の帯に体が入り、計測線に戻ったら終了。届かずに戻ると無効
- 背景は動きが無い間ゆっくり覚え直す。線を動かしたときと「背景を覚え直す」で作り直す
- 「テスト」で帯の占有率と反応が見える。感度スライダーで背景との差のしきい値を変える

### ヘディング（`js/heading-core.js`、`js/vision.js`）
MediaPipe Tasks Vision（`vendor/mediapipe/`、Apache 2.0）の PoseLandmarker（33 点）と ObjectDetector（EfficientDet-Lite0、sports ball）。
モデルは `models/` に置いてあるのでオフラインで動く。
- かぞえる: 落ちてきたボールが頭の近くで跳ね返った／いちばん近づいて離れた瞬間を 1 回にする（`HeadingCounter`）。頭の陰で一瞬見えなくても数える。選手ごとの 1 日の上限（既定 20 回）を見守る
- フォーム分析: 撮影中は JPEG のコマを端末のメモリに貯め（最大 10 秒）、撮り終えてから全コマに姿勢とボールの検出をかける（`analyzeClip`）。
  立っているコマから身長で px/cm を決め、打点の高さ・ジャンプ・当てた場所（額／頭頂／低い）・踏み切り〜当たるまで・上体の反り・肘の高さ・着地の膝を出し、スロー（コマ送り）で確認する

### 記録（`js/records.js`）
選手と記録は `localStorage` に保存（`trainingsystem.records.v1`）。CSV は BOM 付き UTF-8。

### オフライン（`sw.js`）
最初に開いたときにページ・部品・モデル（合計約 45MB）を端末に入れる。ページは「まずネット、だめなら端末」、モデルは「端末のものを先に」。
`VERSION` を上げると入れ直す。

## 開発
- テスト: `node --test "test/*.test.js"`（計算部分だけ。DOM・カメラは使わない）
- 手元で動かす: 静的サーバーで開く（例: `npx http-server . -p 8790 -c-1`）。カメラは HTTPS か localhost でしか使えない
- 公開: `firebase deploy --only hosting:training`
