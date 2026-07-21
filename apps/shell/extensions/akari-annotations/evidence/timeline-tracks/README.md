# evidence: timeline-tracks

## 実装契約

- タイムラインは上から字幕、overlay track の降順、クリップの順で描画する。
- `track` 欠落と不正値は表示時に 0 へ劣化し、不正値は warning を出す。edit-lint では不正値を error とする。
- overlay の通常コンテナは `z-index: 10 + track` と `data-akari-track` を持つ。`#overlay-stage` を
  z-index 1 のスタッキングコンテキストにし、字幕 plate はコンテナ内の最前面、メッセージ層は
  stage 外の z-index 10 に置く（`stage.hidden = true` で unsupported-format メッセージ表示時は
  overlay-stage 自体を丸ごと隠すため、z 値の数値的な大小に関わらず実際に競合しない）。
- render-cut は track 昇順の安定ソートを行い、同一 track の元配列順を保存する。生成字幕は overlay
  より後に合成して常に最前面にする。

## session-local 状態

スピーカー、overlay track の目、字幕の目はプレビューセッション内だけで保持する。edit.json や
captions.json には保存しない。アプリのリロードまたは再起動では全て ON に戻る。edit.json 更新に伴う
同一プレビューの再生成では、そのセッション内の状態を引き継ぐ。

## L0

2026-07-21 に次を実行し、全て exit 0 を確認した（ラッパー自身が再実行して独立確認済み）。

- `apps/shell`: `npm run build:ext`
- `apps/shell`: `npm run lint`
- `packages/edit-lint`: `node --test test/*.mjs`（29 tests passed、新規 `overlay track accepts
  missing/zero/integer and rejects negative, fractional, and non-number values` を含む）
- `packages/render-cut`: `node --test test/*.mjs`（21 tests passed、新規 `overlay sheet orders
  tracks back-to-front while preserving order within a track` を含む）

## L1 実測 — 総合判定: PASS

検証環境: production ビルド（`npm run build`、browser/node/electron とも 0 errors）の Electron を
隔離 user-data-dir + `--remote-debugging-port` で `--no-sandbox` 起動し、生 CDP（`scripts/cdp-lib.mjs`）
で実際のマウス・キーボード・wheel イベントをディスパッチして操作した。ワークスペースは
`templates/project-default/`（`.akari/` 込み）を `<SCRATCH>/l1-ws/` へ展開したもの。fixture は
`fixture/`（10秒・640x360・h264/yuv420p 映像 + MP3 音声。3 cuts・2 captions・overlay 4 件 —
track 0/1/2 の各 1 件（`ov-a`/`ov-b`/`ov-c`）+ track 欠落 1 件（`ov-d`）。`ov-a`（track0, timeline
[1,5]）と `ov-b`（track1, timeline [2,4]）は時間的に重なるよう配置し、z 反転の観測に使用）。
`ALL ACCEPTANCE CRITERIA PASSED`（全アサーション通過、`run-log-final.json` に一括走行の全記録）。

再現コマンド:

```sh
node apps/shell/extensions/akari-annotations/evidence/timeline-tracks/scripts/run-l1.mjs \
  <cdpPort> <workspaceDir> <evidenceDir>
```

| # | 受け入れ条件 | 結果 | 実測値 |
|---|---|---|---|
| 1 | レーン縦順: 上=字幕帯 / 中=トラック行（track 2,1,0 の順）/ 下=クリップ帯 | **PASS** | 下記「L1-1」 |
| 2 | `track` 欠落 overlay が track 0 行に表示される | **PASS** | 下記「L1-2」 |
| 3 | 上下ドラッグで `track` 書き戻し・既存整形バイト保存・undo で復元 | **PASS** | 下記「L1-3」 |
| 4 | 最上段の上へドロップ → 新規 track 行、track 値が既存 max+1 | **PASS** | 下記「L1-3」に含む |
| 5 | 同時刻に重なる2 overlay の track 変更後、プレビューの重なりが入れ替わる | **PASS** | 下記「L1-4」 |
| 6 | スピーカー OFF → `video.muted===true`。ON で false | **PASS** | 下記「L1-5」 |
| 7 | track 行の目 OFF → 該当 track が非表示 + タイムライン減光。字幕帯の目 OFF → caption-plate 非表示 | **PASS** | 下記「L1-5」 |
| 8 | render-cut: track 逆転ケースの `node --test` | **PASS** | L0 節参照（`overlay sheet orders tracks back-to-front...`） |
| 9 | 回帰: 再生同期・選択連動・字幕コピペ・caption 水平ドラッグ・ズーム HUD | **PASS** | 下記「L1-6」 |
| 10 | evidence 実測値記録・内部パス秘匿・session-local の割り切り明記 | 本ファイル | — |

### L1-1: レーン縦順（`AC1`）

`getBoundingClientRect().top` を全レーンバンドで比較（`02-lane-order.png`）:

```
captions: 501.73  <  track-2: 525.73  <  track-1: 549.73  <  track-0: 573.73  <  clips: 597.73
```

上から 字幕 → track 2 → track 1 → track 0 → クリップ の順で厳密に単調増加することを実測。

### L1-2: track 欠落 overlay の劣化表示（`AC2`）

`ov-d`（edit.json に `track` プロパティなし）のタイムライン要素は `dataset.akariTrack === "0"`
で track-0 行に描画される（座標が track-0 バンドの top と一致）。

### L1-3: 上下ドラッグ = track 変更・新規 track 作成・undo/redo（`AC3`/`AC4`）

`ov-a`（track 0）をタイムライン上で縦に、現在の最上段行（track 2, `ov-c` の行）のさらに上へドラッグ:

- ドラッグ前 overlays: `ov-a:0, ov-b:1, ov-c:2, ov-d:(なし)`
- ドラッグ後 overlays: `ov-a:3, ov-b:1, ov-c:2, ov-d:(なし)`（`maxTrackBefore=2` → `newTrack=3=max+1`
  を実測。`04-after-track-drag.png`）
- 無関係な `ov-b`/`ov-c` の track 値は書き戻し後も不変（既存整形バイト保存、`"id": "ov-a"` /
  `"id": "ov-b"` とも変更後の edit.json にテキストとして残存 — 文字列パッチ規約の確認）
- Cmd+Z → `ov-a.track` が `0`（ドラッグ前の値）に復元（`06-after-undo.png`）。Cmd+Shift+Z →
  `3` に再適用（`trackState` ベースの undo/redo が機能）

### L1-4: track 変更に伴うプレビューの z 反転（`AC5`）

`ov-a`（track0）と `ov-b`（track1）は timeline 上で `[1,5]` と `[2,4]` が重なる。ドラッグ前後の
`getComputedStyle(...).zIndex` を実測:

```
ドラッグ前: ov-a zIndex=10 (track0) < ov-b zIndex=11 (track1)  -> ov-b が前面
（03-overlap-before-drag.png）
ドラッグ後: ov-a zIndex=13 (track3) > ov-b zIndex=11 (track1)  -> ov-a が前面に反転
（05-overlap-after-drag-flipped.png）
```

前面/背面が数値・スクリーンショットの両方で入れ替わることを確認。

### L1-5: トラックヘッダー（目・スピーカー）（`AC6`/`AC7`）

- **track の目 OFF**（新設 track-3 行）: タイムライン側 `hiddenBand.hidden===true` +
  overlay 要素 `opacity: 0.28`（`07-track-hidden.png`）。プレビュー側は該当 `[data-akari-track="3"]`
  コンテナが `display:none` に変化することを実測。目を再度 ON にすると `display:block` に復帰
- **字幕の目 OFF**: プレビューの `#caption-plate` の `getComputedStyle(...).visibility` が
  `hidden` に変化（`08-captions-hidden.png`）。ON で `visible` に復帰
- **スピーカー OFF**: プレビュー `video.muted` が `true` に変化（`09-speaker-muted.png`）。
  ON で `false` に復帰

### L1-6: 回帰

- **選択連動（タイムライン→プレビュー）**: `ov-b` をタイムラインでクリック →
  プレビュー webview 内 `[data-overlay-id="ov-b"][data-akari-interaction-selected="true"]` を実測
  （`10-selection-sync.png`）。overlay-runtime（無編集）は overlay コンテナの
  `visibility` を `tick()` のアクティブ区間判定で管理するため、選択対象が現在アクティブな
  時刻へプレビューを明示的にシークしてから選択操作を行った（検証ドライバ側の対応。詳細は
  「検証で判明した注意点」参照）
- **字幕コピー&ペースト（1 往復）**: caption-a を Cmd+C → 9.5 秒付近へシーク → Cmd+V →
  新規 `caption-copy` 挿入を実測。Cmd+Z → 消滅を確認（`11-caption-paste-undo.png`）
- **caption 水平ドラッグ**: caption-a を水平ドラッグ → `captions[0].start`: `1 → 1.754`
  （`12-caption-drag.png`）
- **ズーム HUD**: ctrl+wheel ズームイン後のカーソル不動点誤差 `0.0128`秒
  （閾値 = 可視幅の2% = `0.0694`秒、`13-zoom-hud.png`）
- **再生 → playhead 同期**: 再生中に playhead px `1512.27 → 1735.83`（単調増加）、
  プレビュー `currentTime` 実測 `8.661`（`14-playback-sync.png`）

## 検証で判明した注意点（製品コード無変更、検証ドライバ側の対応）

1. **`.akari/sidecars/` の正典パス**: `akari-annotations-contribution.ts` の `locate()` は
   `ProjectLocation.videoUri` を `.akari/sidecars/<name>.analysis/analysis.json`
   （`findFirstCanonicalAnalysis` が走査、`CANONICAL_ANALYSIS_SUFFIX='.analysis/analysis.json'`）
   の `source` フィールドから解決する。フラットな `exports/analysis.json` だけを置いても
   `videoUri` は空文字のままになり、タイムライン→プレビュー方向のメッセージ
   （選択連動・スピーカー・track の目・字幕の目のいずれも）が全て無言で届かなくなる
   （`registerTimelineSetting` の `if (!detail?.videoUri) return;` ガードで早期リターンする
   ため、例外もログも出ない）。本 fixture では `.akari/sidecars/sample.mp4.analysis/analysis.json`
   （`source: "../../../exports/sample.mp4"`）を正しく配置して解消した。**製品コードのバグではない**
   （既存 waves の fixture が暗黙に前提としていた配置に、本 fixture のディレクトリ構成が
   最初は倣っていなかっただけ）
2. **overlay の時間ゲート付き可視性**: `packages/overlay-runtime/src/overlay-runtime.js` の
   `tick()` は `overlay.start <= timelineTime < overlay.start + overlay.duration` でのみ
   `visibility:visible` にする（無編集・既存動作）。`applyRequestedOverlaySelection()`
   （`akari-preview-open-handler.ts`、既存コード）は `visibility:hidden` な対象への選択適用を
   スキップするため、選択連動の回帰チェックでは対象 overlay がアクティブな時刻へ
   `video.currentTime` を明示的にシークしてから選択操作を行う必要があった（検証ドライバのみの対応）

## session-local 状態の割り切り（明記）

スピーカー ON/OFF・overlay track の目・字幕の目は `AkariAnnotationsWidget` /
`AkariPreviewOpenHandler` のメモリ上の状態（`clipMuted` / `hiddenTracks` / `captionsVisible` と
`previewSessionSettings` マップ）としてのみ保持し、edit.json・captions.json のいずれにも書き込まない。
アプリの再起動やプレビュータブの再オープンでは全て ON（ミュートなし・全トラック表示・字幕表示）に戻る。
この割り切りは契約 §5 で明示されたスコープどおりであり、永続化は将来 F40 拡張として範囲外とする。

## 実測ログ

`run-log-final.json` に全アサーションの実測値付き記録（`ALL ACCEPTANCE CRITERIA PASSED` を末尾で
確認可能）。`run-log-partial-1.json` は track/z-order/ヘッダー系チェック完了時点の中間スナップ
ショット。`fixture/` に検証用フィクスチャ（edit.json / captions.json / review.json / analysis.json /
overlays/*.html、動画本体は検証後に破棄しコミットしていない）。`scripts/cdp-lib.mjs` は
`evidence/timeline-selection-cp/scripts/cdp-lib.mjs` からの無変更コピー、`scripts/run-l1.mjs` は
同ディレクトリと `evidence/timeline-sync-undo/scripts/run-l1.mjs` を出発点に本タスクの track
受け入れ条件向けへ書き下ろした検証ドライバ本体（依存追加なし、Node 22+ 組み込みのみ）。
