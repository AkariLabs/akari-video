[English](./README.md) | **日本語**

# @akari-video/frame-engine

`frame-engine` は edit-store が解決済みのタイムライン時刻を、1枚の完成 WebGL2 surface へ評価します。同じ `CompositedFrame` を canvas preview 出口と PBO raw-frame 出口が消費し、`evaluateFrame` 自体は preview/export モードを持ちません。

cuts パスはハードカット、速度、静的 crop と線形補間 zoom framing、cut transform/opacity、尺を伸ばす freeze、GPU で描く 5 種の transition（`dissolve` / `fade-black` / `fade-white` / `reveal-down` / `reveal-up`）に対応します。freeze 展開は resolved timeline 層で行い、transition overlap を解決する前に後続の逐次 cut をすべて後ろへずらします。

## Web プレビュー評価モード

preview-server を `?frameEngine=1` 付きで開くと frame-engine canvas を使用します。フラグは既定で off であり、付けない場合は現行 Web UI のネットワーク・DOM 挙動とバイト等価です。engine canvas は cuts パス専用の評価面です。layers、overlays、字幕、音声は描画せず、黙って欠落させないよう UI に未対応バナーを常時表示します。

計測オーバーレイには、表示 fps、late frame、直近の seek 到達時間、Lookahead の cold 対 cache の seek 時間、Warmup 前後の cut 境界 late 数を表示します。独立した L1 ブラウザテストはリポジトリルートから実行します。

```sh
npm --prefix packages/preview-server run test:frame-engine-browser
```

既定の実行は headless です。headless Chromium は animation frame の供給自体が律速になり、engine の評価時間とは独立して表示 fps が下がることがあります。そのため既定実行では headed 用 fps 閾値を課さず、再生位置の進行、計測値、seek、描画、エラー封じ込めを検証します。表示性能は headed browser で実測します。

```sh
AKARI_FRAME_ENGINE_HEADED=1 npm --prefix packages/preview-server run test:frame-engine-browser
```

## ローカル検証

ゴールデンハーネスは Chromium の WebCodecs と WebGL2 実装を必要とします。まずリポジトリにある Electron を起動し、ホストが GUI app を登録できない場合だけ同じ renderer bundle を Playwright Chromium で実行します。H.264 フィクスチャは ffmpeg で生成し、動画と証跡は gitignore 済みの `test/golden/.generated/` にだけ置きます。

```sh
cd packages/frame-engine
npm run typecheck
npm run test:unit
npm test
npm run bench:cuts
```

`npm test` は build、unit test、Electron 実走、機能・transition 28 固定時刻での preview/export RGBA・PNG hash 一致、故意の1px改変の棄却、freeze 内 2 フレームの一致、11 秒 MP4 の ffprobe 尺確認を一括検証します。段階別集計は `test/golden/.generated/metrics.json` に生成されます。

`npm run bench:cuts` は 1920×1080・30fps・13 秒の cuts 常設ベンチです。decode / 事前 cache / 固定 frame、GOP 距離別 Warmup と Lookahead、8MB IPC の invoke / MessagePort / shared memory、raw ffmpeg / WebCodecs encoder、読み取り専用 render-cut 対照を比較します。完走時は [cuts パス実測レポート](./docs/cuts-path-report.md)へ p50/p95 と最終 `v2/render-cut` 比を書き込みます。

CI runner が GPU/WebCodecs 対応 Chromium を持たない場合、Electron/WebCodecs 試験はローカル専用です。unit test と typecheck はその種の CI でも実行できます。

固定した demux/decode 依存の評価は [av-cliper 保守現況](./docs/av-cliper-status.md) を参照してください。
