# three-video-texture-live 検証証跡（スマホ 3D の画面動画が黒 / ちらつく）

シェルのライブプレビューで、`materialOverrides` に動画（`screen.mp4`）を差した 3D スマホ
（内部素材 `phone-pro-titanium-live` を使うオーナー案件 `2026-08-07-akari-reel` の `panel-12.html`）の
画面が**真っ黒のまま、たまに 1 フレームだけ出る（= ちらつき）**症状を、Electron tier 2 + CDP で
BEFORE / AFTER 比較した。静止画（`screen.png`）を差した対照 overlay を同じ位置に置き、
**動画だけが黒い**ことを切り分けている。

計測値は [results.json](./results.json) の `before` / `after` を正とする。PNG 3 点は
実機走行の生記録（`*-play-frames.png` は再生開始直後 16 draw の 3D canvas を 1/4 縮尺で並べたもの）。

## 原因（3 つ重なっていた）

1. **CORS 無し**: ランタイムが作る `<video>` に `crossOrigin` が無く、asset stream
   （`127.0.0.1`、`Access-Control-Allow-Origin: *`）は webview（`*.webview.localhost`）から見て
   別オリジンなので canvas が汚染され、WebGL への転送が黙って空になる → **画面が黒**。
   静止画は three の `TextureLoader` が既定で `crossOrigin="anonymous"` なので出ていた
   （BEFORE の `static.phone-mp4.brightPixels` 58 vs `phone-png` 358）。
2. **シーク嵐**: `syncVideos` が tick ごとに `currentTime` を書き、前のシークが終わる前に次を積む。
   keyframe が 81 frame に 1 つの素材では毎回先頭から復号し直しになり、`seeking=true /
   readyState=1` のまま提示フレームに到達しない（BEFORE 再生中 322 draw のうち 191 が seeking）。
   その間の上げ直しは黒、完了した瞬間だけ絵が出る。
3. **転送の重さ**: 1 を直すと転送が実際に走るようになり、毎 tick 無条件の `needsUpdate` +
   完了するようになったシークで frame-engine が遅れ、**タイムラインが実時間の 0.22〜0.5 倍**
   でしか進まなくなった（途中計測: crossOrigin のみ 0.50 / +mipmap 無効 0.24 / +逐次シーク 0.22）。

## 修正（`packages/overlay-runtime/src/three-runtime.js` / `overlay-runtime.js`）

- `<video>` を `crossOrigin="anonymous"` で作る
- `overlay-runtime.js` の `tick(t, playing)` が `render(..., { syncVideos, playing })` を渡す
- 再生中（`playing`）: `<video>` を `play()` し、ズレは `playbackRate`（±0.25 まで）で寄せる。
  ループ素材は巻き戻り直後を跨ぐズレを最短距離で測る。ハードシークは 1 秒以上ズレたときだけ
- 停止・スクラブ中: シークで追従するが、`seeking` 中は次を積まず保留し、`seeked` で最新へ 1 回追いつく。
  `seeked` 後は停止中でも描き直す
- GPU 転送はライブ同期時のみ「提示フレームが変わった（`requestVideoFrameCallback`）」かつ
  `readyState >= HAVE_CURRENT_DATA` のときだけ。書き出し（`syncVideos` 無し）は従来どおり毎 draw

## 結果（`results.json`）

| | BEFORE | AFTER |
| --- | --- | --- |
| 再生中の画面（`phone-mp4` bright 画素 min/median/max） | 32 / 91 / 168（黒。本体の反射のみ） | 206 / 337 / 418（静止画対照 288 / 372 / 448 と同等） |
| 停止中の画面（同） | 58（黒） | 360 |
| 再生中に seeking だった draw | 191 / 322 | 3 / 297 |
| タイムライン進行 / 実時間 | 0.97 | 0.99 |
| tick 間隔 median / p95 | 17 / 22 ms | 17 / 22 ms |

`before-phone-mp4-play-frames.png` は画面が黒、`after-phone-mp4-play-frames.png` は動画が出ている。
`after-playing.png` は AFTER 走行中のシェル全体。

## 回帰テスト

`packages/overlay-runtime/test-harness/three-video-texture-live.test.mjs` — ページを `localhost`、
動画を `127.0.0.1`（`Access-Control-Allow-Origin: *`）から配って別オリジンを再現し、緑一色の VP9 を
差した ScreenMaterial の中央画素が緑であること、`playing: true` で `<video>` が走り `false` で止まる
ことを headless Chrome で確認する。修正前のランタイムでは `crossOrigin` の assert で落ちる。

## 環境・フィクスチャ・手順

- macOS（Darwin 25.2.0 / arm64）、Electron 39.8.7、CDP の product は Chrome/142.0.7444.265。
  実施日 2026-09-16 JST。worktree のビルドは `npm run build`（dev 起動。`lib/overlay-runtime` は
  無く、webview は `packages/overlay-runtime/src` を読む）。
- フィクスチャ（毎回 `mkdtemp` へコピー。オーナー案件は読み取りコピーのみ）:
  - `assets/source/base.mp4`: `ffmpeg -f lavfi -i testsrc2=size=1080x1920:rate=30 -f lavfi -i sine=frequency=440 -t 8 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest`
  - `assets/scene3d/phone/{model.glb,screen.mp4,screen.png}`: `2026-08-07-akari-reel` からコピー
    （`screen.mp4` は 540×960 / 30fps / 2.7 秒 / H.264、**keyframe 1 つ**）
  - `overlays/phone-mp4.html`: `panel-12.html` の先頭コメントを除いたもの。
    `overlays/phone-png.html`: 同じ宣言で texture を `screen.png` に置換
  - `edit.json` version 2 / 1080×1920 / 30fps。V1 base 0〜240f、V2 phone-mp4 と V3 phone-png を 30f から 180f
- 走行: `node run-l1.mjs --label <name> --electron <Electron> --shell <apps/shell> --project <fixture>
  --port <cdp port> --out <dir> --puppeteer-root <puppeteer-core を持つ root>`
  1. 「編集データ」を実クリックで開き、t=2.0 へシーク、両 overlay の `status === "ready"` を待つ
  2. `interaction.captureCanvasContent`（`draw()` 直後に必ず呼ばれる）を包み、描画ごとに 3D canvas を
     1/4 縮尺でコピーして輝度 > 140 の画素数（bright）・前 draw との差・`<video>` の状態を記録
  3. 停止中に同時刻を 24 回描く → `play-toggle` で 6 秒再生 → 停止。`runtime.tick(t, playing)` も包んで
     タイムラインの進みを実時間と比べる
  4. スクリーンショットと最初の 16 draw の canvas PNG を保存
