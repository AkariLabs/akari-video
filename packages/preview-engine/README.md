# @akari-video/preview-engine

シェル非依存の TS プレビューエンジン（レベル3: Chromium 内完結、WebCodecs + `@webav/av-cliper` 基盤）。
正本契約: `akari-video-internal/planning/contract-2026-07-15-preview-engine.md`（E1〜E4）。

新シェル（Electron レンダラー等）はこのパッケージを `<canvas>` にマウントし、タイムラインを渡し、
`seek()` / `play()` を呼ぶだけでよい。GOP 距離依存の decode コスト・カット境界のフリーズ・
AAC configure 無限リトライ・末尾 GOP のフレーム欠落といった WebCodecs 特有の地雷は
このパッケージが内部で吸収する（詳細は `../../akari-video-internal/tasks/2026-07-15-engine-e1-e4/report.md`）。

## インストール

パッケージ内で完結（`npm install --no-workspaces`。モノレポ workspaces を使わない — 理由は
`.npmrc` のコメント参照）。

```sh
cd packages/preview-engine
npm install --no-workspaces
npm run build   # dist/ を生成
```

## 公開 API

```ts
import { PreviewEngine } from '@akari-video/preview-engine';

const engine = new PreviewEngine({
  // すべて省略可。既定値は契約 §2 の Palmier 実測値 import
  scrubThrottleMs: 1000 / 30,          // E1: 30Hz スロットル
  keyframeSnapBeyondTolerance: true,   // E1: 長GOP素材向けの拡張（後述）
  lookaheadCacheSize: 24,              // E2
  warmupLeadInSec: 0.75,               // E3
  loadTimeoutMs: 4000,                 // E4
  tickTimeoutMs: 4000,                 // E4
  tailMarginUs: undefined,             // E4: 既定は timeline.fps から 2 フレーム分を自動算出
});

// 1. マウント（HTMLCanvasElement に 2D で描画する）
engine.mount(canvasEl);

// 2. タイムラインをロード（MVP: カット + オーバーレイのみ。エフェクト/トランジションは非スコープ）
await engine.loadTimeline({
  fps: 30,
  clips: [
    { id: 'a', src: 'file:///path/to/a.mp4', startFrame: 0,   endFrame: 600, track: 0, mediaType: 'video' },
    { id: 'b', src: 'file:///path/to/b.mp4', startFrame: 600, endFrame: 1200, sourceInUs: 12_000_000, track: 0, mediaType: 'video' },
  ],
});

// 3a. ドラッグ中（interactiveScrub） — 呼びっぱなしでよい。30Hz スロットル・最新1件のみ・陳腐シーク破棄は内部で処理
canvasEl.addEventListener('pointermove', (e) => {
  engine.seek(frameFromPointerX(e.clientX), 'interactiveScrub');
});

// 3b. リリース/プログラム的な厳密シーク — Promise が解決した時点で canvas に描画済み
await engine.seek(targetFrame, 'exact');

// 4. 再生
engine.play();
engine.pause();

// 5. 破棄（デコーダ・キャッシュ・タイマーを全て解放）
engine.dispose();
```

### イベント

```ts
engine.on('frame', ({ frame, clipId, approx, tickMs, drawn }) => {});
engine.on('warning', ({ kind, clipId, message, detail }) => {});
engine.on('warmup', ({ clipId, primedAtFrame, tookMs }) => {});
engine.on('play', ({ frame }) => {});
engine.on('pause', ({ frame }) => {});
engine.on('dispose', () => {});
```

`warning` の `kind` 一覧（すべて E4 由来。ユーザー可視の通知として shell 側で拾うことを想定）:

| kind | 意味 |
|---|---|
| `audioDecoderFallback` | AAC 等の `AudioDecoder.configure()` 不整合を検知し、音声無効で再読込した |
| `hwDecoderDegraded` | HW デコードが失敗/枯渇し、SW へフォールバック（またはそれも失敗）した |
| `tailGopMarginClamped` | クリップ末尾近傍のシークを安全マージン分クランプした（w3c/webcodecs#116 対策） |
| `decodeTimeout` | configure/decode がタイムアウトした |
| `clipUnavailable` | 全フォールバックを使い切り、そのクリップは利用不能 |

## E1〜E4 の実装メモ（設計判断の根拠）

### E1: tolerance スクラブ

契約のパラメータ（`tolerance = min(0.75s, 0.15×activeLayerCount)`, 30Hz スロットル, 保留は最新1件,
毎回陳腐シーク破棄）は Palmier(`VideoEngine.swift` L223-269, AVFoundation の
`toleranceBefore/After`)からの輸入。WebCodecs 環境ではキーフレーム位置に自前でスナップする必要があるため、
`@webav/mp4box.js` で `MP4Clip.getFileHeaderBinData()`（ftyp+moov のみ、mdat 不要）を解析し
sync sample（キーフレーム）の時刻一覧を構築する（`src/keyframeIndex.ts`）。

**契約からの明示的拡張**: `av-cliper` 1.2.8 の内部実装を読み取り確認したところ、
`MP4Clip.tick()` は「後方シーク or 前方3秒超ジャンプで直前キーフレームまでデコーダをフルリセットし、
そこから対象時刻まで全フレームを歩いてデコードする」という設計になっている。つまり
**要求時刻をキーフレーム自身の cts に丸めるだけで、リセット後の歩行コストがほぼゼロになる**。
一方でスパイクの意地悪素材は GOP≈4s（実測、120フレーム間隔）と意図的に長く、
契約の tolerance 上限 0.75s では「範囲内にキーフレームが存在しない」ケースが支配的になる
（Palmier のパラメータは ProRes 等の短GOP/全イントラ素材を前提にしていると推測される）。
そのため `keyframeSnapBeyondTolerance`（既定 `true`）で「範囲内に無ければ範囲外でも直前キーフレームへ
スナップする」拡張を導入した。`false` にすると契約の文字通りの実装（長GOP素材では実質 exact 落ちが多発）
になる。両方の実測値は `bench/evidence/measurements.json` と report.md 比較表を参照。

### E2: 先読みキャッシュ

`LookaheadCache`（`src/lookaheadCache.ts`）はプレイヘッド近傍のフレームを VideoFrame ごと保持する。
WebCodecs の `VideoFrame` は `close()` 後は再利用不能なため、**キャッシュはマスターを保持し
呼び出し側には常に `clone()` を渡す**（呼び出し側が自由に close して良い設計）。exact シーク後に
数フレーム分バックグラウンドで先読みする（`prefetchForward`）。

### E3: カット点ウォームアップ

`WarmupManager`（`src/warmupManager.ts`）が `Timeline.resolve()` の `secondsToBoundary` を監視し、
残り `warmupLeadInSec` 秒を切ったら次クリップの `ClipSession.load()` + 先頭フレーム prime を
バックグラウンドで実行する。

### E4: 監視・防御層

- **AAC 無限リトライ対策**: `av-cliper` の VideoDecoder/AudioDecoder エラーハンドラは
  Promise 拒否ではなく `throw` で実装されており、`await clip.ready` / `await clip.tick()` には
  伝播しない（`window` の `'error'` / `'unhandledrejection'` として表面化する — スパイクで見た
  "Uncaught Error 無限出力" の実際のメカニズムと推測）。そのため `guard.ts` で
  `window.addEventListener('error'|'unhandledrejection', ...)` を一時的に監視し、
  デコーダ関連の例外を検知したら `preventDefault()` してエンジン内の `warning` イベントに
  一本化しつつ、`Promise.race` ベースのタイムアウトと組み合わせて中断する。
  ロードは `audio:true+HW → audio:false+HW → audio:false+SW` の段階的フォールバック
  （`ClipSession.doLoad`）。
- **末尾 GOP 安全マージン**: `ClipSession.rawTick` が `duration - tailMarginUs` を超える要求を
  自動クランプ（w3c/webcodecs#116 の再現条件を回避）。
- **HW セッション枯渇時の劣化**: 上記フォールバックの3段目（`audio:false + prefer-software`）。
  本プラットフォームでは 4K H.264/HEVC の SW configure 自体が失敗する（スパイクで確認済み）ため、
  実質的には「クリップ利用不能を早期検知してエラー通知に倒す」防御という位置づけ。

## 既知の非スコープ（契約 §4）

- エフェクト・トランジションのリアルタイム合成（v0 は カット + オーバーレイのみ）
- 書き出しパイプライン
- レベル2（ネイティブプレーン移植）

## 計測

`bench/` に Electron ベンチアプリがある（`lab/webcodecs-spike/` の計測手法を再利用）。

```sh
cd bench
npm install --no-workspaces
cd ..
npm run bench:build
cd bench && npm start
```

結果は `bench/evidence/measurements.json` に保存される。スパイク実測値との比較表は
`akari-video-internal/tasks/2026-07-15-engine-e1-e4/report.md` を参照。
