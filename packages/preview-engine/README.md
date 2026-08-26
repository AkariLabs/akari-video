# @akari-video/preview-engine

> ## 🧊 状態: **凍結中（2026-08-27 裁定）** — 接続先未定・ビルド/配信ラインから除外済み
>
> このパッケージは **どのアプリからも import されていない**。2026-07-15〜16 の実装ラウンド以降、
> `packages/preview-server` が `public/preview-engine.bundle.js` へバンドル・配信していたが、
> `public/index.html` にも `public/app.js` にも読み込み口が無く、実行されたことは一度も無い
> （死蔵の確定根拠: 内部監査 2026-08-17）。維持費（ビルド時間・381KB のバンドル配信・
> 追随改修による保守錯覚）だけが発生していたため、**ビルド・配信ラインから外した**:
>
> - `packages/preview-server/package.json` の `build` から preview-engine の esbuild を削除
> - 追跡されていた `packages/preview-server/public/preview-engine.bundle.js` を削除
> - `packages/preview-server/test/server.spec.mjs` の「配信されるか」スモークを削除
>
> **コードは消していない**。エンジン v2 構想（合成エンジンを 1 個に統一する
> WebCodecs + GPU コンポジタ路線・2026-08-26 オーナー承認）で **土台候補**として実査済みであり、
> 「再利用するか新規に起こすか」はエンジン v2 のゲート G1（Phase 0 スパイクの実測と併せて裁定）
> に委ねられている。それまでは触らない — **本パッケージへの追随改修を新たに入れないこと**
> （入れても誰も実行しない。必要な変更は G1 の裁定後に、再利用と決まってから行う）。
>
> ### 凍結の解除（復活）手順
>
> 1. `packages/preview-server/package.json` の `build` 先頭へ次を戻す:
>    `esbuild ../preview-engine/src/index.ts --bundle --format=esm --outfile=public/preview-engine.bundle.js --target=chrome122 --platform=browser && `
> 2. `public/index.html` か `public/app.js` に**実際の読み込み口**を作る（これが無かったのが死蔵の原因）
> 3. 必要なら `server.spec.mjs` の配信スモークを復活させる（削除前の内容は git 履歴を参照）
>
> ### 凍結中に確定した申し送り
>
> - **ducking の正本は本パッケージではない**。`src/duckingGain.ts` は「BGM を下げる区間」の
>   計算を純関数 + テスト付きで持つ唯一の実装だが、同じ規則が Web UI（`packages/preview-server/public/app.js`）
>   と shell（`apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts`）に
>   インラインで各 1 本ある（= プレビュー側は計 3 実装）。2026-08-27 時点で 3 者は数値的に同値
>   （0〜10s を 10ms 刻み × ducking on/off の 2,002 点で不一致 0 を実測）。
>   共有カーネル（`packages/edit-store`）への一本化は消費側 2 ファイルの書き換えを伴うため
>   別タスク扱い。**復活時は `src/duckingGain.ts` を残さず、カーネル側を import すること**
> - `src/timeline.ts` の `Timeline` は MVP 用の素朴な解決器で、`packages/edit-store` の
>   timeline-map 共有カーネル（トラック勝者・時間写像の正本）とは別物。復活時は timeline-map を正とする


シェル非依存の TS プレビューエンジン（レベル3: Chromium 内完結、WebCodecs + `@webav/av-cliper` 基盤）。
正本契約（E1〜E5）は非公開の内部 planning で管理する（本リポには置かない方針）。
パラメータの根拠・設計判断の要約は本 README 「E1〜E4 の実装メモ」節を参照。

新シェル（Electron レンダラー等）はこのパッケージを `<canvas>` にマウントし、タイムラインを渡し、
`seek()` / `play()` を呼ぶだけでよい。GOP 距離依存の decode コスト・カット境界のフリーズ・
AAC configure 無限リトライ・末尾 GOP のフレーム欠落といった WebCodecs 特有の地雷は
このパッケージが内部で吸収する（詳細な調査記録は非公開の内部タスクで管理する。
要点は本 README 「E1〜E4 の実装メモ」節に記載）。

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
  enableThumbnailScrub: true,          // E5: メモリ内サムネによる即時スクラブ表示
  thumbnailMaxCount: 40,               // E5: 1クリップあたりの上限
  thumbnailIntervalSec: 2,             // E5: キーフレーム索引が無い場合の粗い間隔
  thumbnailWidth: 160,                 // E5: 低解像度サムネの幅
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

### narration 再生 + 静的ダッキング近似

`loadTimeline()` の `audio.narration` に `edit.json` の `audio.narration[]`
（契約: `docs/contract-2026-07-20-edit-json-v1-narration.md`）に対応する配列を渡すと、
各要素が `t` 秒オフセット + `gainDb` で Web Audio API（`AudioContext`）上に再生登録される。
`audio.narration` を省略した場合の挙動は完全に従来どおり（非退行）。

```ts
await engine.loadTimeline({
  fps: 30,
  clips: [ /* ... */ ],
  audio: {
    bgm: { ducking: true },        // 省略可。ducking:true で静的近似を有効化
    narration: [
      { id: 'n-0001', src: 'file:///path/to/n-0001.mp3', t: 2.5, gainDb: 0 },
      { id: 'n-0002', src: 'file:///path/to/n-0002.mp3', t: 10.0 }, // gainDb 省略時は 0
    ],
  },
});

engine.play(); // narration もタイムライン位置に同期して鳴る（seek/pause でも再スケジュールされる）

// bgm.ducking:true のとき、narration 区間 [t, t+実尺] で BGM に加算すべき静的ダッキング量(dB)を返す。
// 区間外・ducking:false のときは 0（無効果）。固定 -12dB 近似（契約 §3 と同一の既定値）。
const duckDb = engine.narrationDuckGainDbAt(currentTimeSec);
```

**重要な設計上の制約（要オーナー確認）**: `packages/preview-engine` には
**BGM/SFX 自体のプレビュー再生がまだ実装されていない**（`audio.bgm` / `audio.sfx` の
プレビュー側実装は `contract-2026-07-14-edit-json-v1-audio.md` §3 の表で AVFoundation ベースの
legacy Tauri 実装として説明されているが、WebCodecs ベースの本パッケージには未移植。
BGM/SFX のプレビュー再生は render-cut（書き出し側、ffmpeg ベース）にのみ実装済み）。
そのため `narrationDuckGainDbAt()` は **BGM の GainNode を自前で持たず、適用すべきダッキング量(dB)を
計算して返すだけ**にとどめている。BGM プレビュー再生を実装する側（将来タスク）が、自前の
BGM GainNode の基準ゲインにこの値を加算適用する想定。narration 自体の再生・区間計算・
劣化規約（ファイル欠落時のスキップ）はこのパッケージ内で完結している。

narration が読めない（fetch/decode 失敗）場合や `t`/`gain_db` が不正な場合は、契約 §4 の劣化規約
どおり **その要素だけ**を無視し（`console.warn` + `warning` イベント `kind: 'narrationUnavailable'`）、
他の narration・映像・プレビュー全体には影響しない。`gain_db` が範囲外の有限値なら
`[-60, 12]` にクランプして採用する（棄却しない）。

純粋関数（`clampGainDb` / `dbToLinear` / `computeDuckIntervals` / `computeBgmDuckGainDb` /
`validateNarrationSpecs`）は DOM 非依存で `npm test`（`node --test`）から直接検証できる。
実際の decode + Web Audio スケジューリング（`NarrationTrack`）の L1 相当の実測は
`test/browser/narration-offline-check.mjs`（`OfflineAudioContext` によるオフラインレンダリング検証。
実行方法は同ファイルのコメント参照）で行う。

### イベント

```ts
engine.on('frame', ({ frame, clipId, approx, tickMs, drawn }) => {});
engine.on('thumbnail', ({ frame, clipId, drawnAtMs }) => {});
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
| `narrationUnavailable` | narration 要素の fetch/decode 失敗、または `t`/`gain_db` が不正でその要素だけ無視した（契約 §4。`clipId` には narration の `id` が入る） |

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

### E5: サムネスクラブ表示層

`loadTimeline()` は先頭クリップのロード後、既存の E1 キーフレーム索引を優先して低解像度の
`ImageBitmap` 列をバックグラウンド生成する。索引が無い場合だけ `thumbnailIntervalSec` 間隔で
粗く抽出する。生成には既存の `ClipSession.tickBackground()` を使うため、実スクラブや exact seek の
foreground 要求が割り込むとサムネ生成側が譲る。別解像度の動画ファイルは生成せず、成果物は
メモリ内の bitmap だけで、`dispose()` / タイムライン再ロード時にすべて `close()` する。

`seek(frame, 'interactiveScrub')` は ready 済みトラックの最近傍サムネを同期描画し、`thumbnail`
イベントを発火してから、従来どおり E1 の実フレーム要求を続行する。実フレームが解決すると既存の
`frame` 描画がサムネを差し替える。同一サムネが連続する入力では再描画とイベントを省略する。
リリース時は従来どおり `seek(frame, 'exact')` を呼び、E3/E2 を含む既存経路で exact フレームへ収束する。

## 既知の非スコープ（契約 §4）

- エフェクト・トランジションのリアルタイム合成（v0 は カット + オーバーレイのみ）
- 書き出しパイプライン
- レベル2（ネイティブプレーン移植）

## テスト

`npm test`（`node --test test/*.test.mjs`）で DOM 非依存の純粋関数（narration の劣化規約・
ダッキングゲイン計算）を検証する。`pretest` で自動的に `npm run build` する
（`dist/` の最新ビルドに対してテストする）。

## 計測

`bench/` に Electron ベンチアプリがある（`lab/webcodecs-spike/` の計測手法を再利用）。

```sh
cd bench
npm install --no-workspaces
cd ..
npm run bench:build
cd bench && npm start
```

Test8 がサムネ描画 p50/p95、4K/1080p 実フレーム追従 Hz、静止後 exact p50/p95、サムネイベント
カバレッジを記録する。結果は `bench/evidence/measurements.json` に保存される。スパイク実測値との
比較表は非公開の内部レポートで管理する（本リポには置かない方針）。
