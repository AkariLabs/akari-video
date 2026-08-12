# 3d-text-flat（task 2026-08-12-3d-text-flat）— texts[] flat モード検証ハーネス

`texts[]`（flat = troika-three-text SDF 平面文字）宣言の決定論・シーク安全・パリティ・
グリフ正当性ゴールデン・ネットワーク到達ゼロ・性能予算を実測する証跡一式。

## 構成

- `lib/fixtures.mjs`: 共通ヘルパー（puppeteer-core 解決・Chrome 検出・projectRoot 生成・
  preview ページ生成・静的サーバ・PNG 読み取り/合成）
- `lib/scenes.mjs`: 副作用のないシーン定義（`cylinderScene` / `roProScene`）
- `determinism-seek.mjs`: 決定論（同一入力 2 回書き出し）+ シーク安全（昇順 vs シャッフル順）
- `golden.mjs`: グリフ正当性ゴールデン（筒シーンの裏面鏡文字 / 「ロ」「プ」を含む静止フレーム）
- `parity.mjs`: プレビュー（`overlay-runtime.js` の mount→tick を直接ブート）と書き出し
  （`rasterize.mjs` の `captureWithPuppeteer`）の同時刻コンタクトシート + 画素差分
- `network-zero.mjs`: 絵文字（欠落グリフ）を含む texts[] を書き出しても外部リクエストが
  0 件であることの実測（`page.on('request')` 観測）
- `perf-fps.mjs`: 20 文字 flat + carousel の fps 実測（契約 §4-7 の 60fps 予算）
- `presets-smoke.mjs`: 5 プリセット（`none`/`carousel`/`char-chaos`/`flip-wave`/`tumble`）が
  それぞれ動く証跡（各 1 フレーム・非透明ピクセル数を実測）
- `artifacts/`: 各スクリプトが生成した実測結果 JSON と PNG（`-viewable.png` は不透明背景に
  合成した目視用コピー。判定には使っていない — 判定は透過 PNG の SHA-256 / 画素差分そのもの）

puppeteer-core はこの worktree の devDependency ではないため、`test-harness/projection-knobs.test.mjs`
と同じ流儀でメイン checkout（`/Users/ryoma/_edit/30_products/akari-video`）の
`apps/shell/node_modules/puppeteer-core` を読み取り専用で借りる（メイン checkout は無改変）。

## 実測結果サマリ（実行コマンド: `node evidence/3d-text-flat/<script>.mjs`、cwd は `packages/render-cut/`）

| 項目 | 結果 | 証跡 |
|---|---|---|
| 決定論 | 24 フレーム全て SHA-256 完全一致（2 回書き出し） | `artifacts/determinism-seek-result.json` |
| シーク安全 | 24 時刻全て 昇順/シャッフル順で画素ハッシュ一致 | 同上 |
| パリティ | 画素差分 mean/max とも 0（透過 PNG 同士） | `artifacts/parity-result.json` / `artifacts/parity-contact-sheet.png` |
| ゴールデン（裏面鏡文字） | SHA-256 記録済み、目視で鏡文字を確認 | `artifacts/golden-cylinder-mirror-back-viewable.png` |
| ゴールデン（ロ/プ） | SHA-256 記録済み、ロの穴・プの半濁点リングとも正しく描画 | `artifacts/golden-ro-pu-glyphs-viewable.png` |
| ネットワーク到達ゼロ | 外部リクエスト 0 件・CDN フォールバック 0 件（絵文字ケース込み） | `artifacts/network-zero-result.json` |
| 性能（20 文字 flat + carousel） | 実測 fps は report.md 参照（本開発機は他セッションと共有中で `top` 実測 load average 80〜118 の重負荷環境。§性能予算の節に詳細） | `artifacts/perf-fps-result.json` |
| 5 プリセットそれぞれの動作 | 全 5 プリセットで非透明ピクセル実測（none=3015px, carousel=2490px, char-chaos=2619px, flip-wave=2932px, tumble=2354px） | `artifacts/presets-smoke-result.json` / `artifacts/preset-*-viewable.png` |

数値の一次ソースは `artifacts/*.json`。report.md はこれらの実測値を転記したもの。

## 実装上の発見（three-runtime.js への波及）

証跡収集の過程で 2 点、`packages/overlay-runtime/src/three-runtime.js` 側の実装が必要になった
（ソースコードのコメントにも同じ経緯を残している）:

1. **`vendor-3d-text-bundle.js` の読み込み配線漏れ**: `packages/render-cut/src/rasterize.mjs` は
   T1 時点で `texts[]` 宣言を検知して `vendor-3d-text-bundle.js` を読み込む配線を持っていなかった
   （3D シーンがあれば `three-bundle.js` と `three-runtime.js` だけを埋め込んでいた）。
   `hasThreeDimensionalTextOverlay` 判定を追加し、`texts[]` を含むシートだけ
   `three-bundle.js` → `vendor-3d-text-bundle.js` → `three-runtime.js` の順で埋め込むよう拡張した。
2. **troika の unicode フォールバックは Worker 内で fetch する**: `window.fetch` を差し替えるだけ
   では防げない（実測: troika-worker-utils が `Pt.useWorker` 既定 true で typesetting 全体を
   Blob 経由の Worker へ委譲しており、Worker は独立した `self.fetch` を持つ）。`window.Blob` を
   差し替え、`type:"application/javascript"` の Worker ソース Blob の先頭へ `self.fetch` ガードを
   注入する方式に切り替えた（`disableTroikaUnicodeFontFallback` / `network-zero.mjs` で実証）。
   さらに troika の `sync()` は fetch reject を `.catch` せず完了コールバックが二度と呼ばれない
   （無限ハング）ため、`waitForTextSync` で `sync()` 自体にタイムアウトを設けた
   （`TEXT_SYNC_TIMEOUT_MS`。値の選定経緯は report.md 参照）。

## 既知の限界

- 実測環境: 本タスクの証跡はすべて他セッションと共有中の開発機で取得した
  （`top` 実測 load average 80〜120 台の重負荷が持続）。fps 実測はこの負荷の影響を直接受ける
  （§ perf-fps.mjs の note・report.md 参照）。決定論・シーク安全・パリティ・ゴールデン・
  ネットワークゼロは値そのもの（SHA-256 一致・画素差分 0 等）で判定しているため負荷の影響を
  受けないが、取得の過程で 1 browser を使い回す方式（`presets-smoke.mjs` の初期実装）が
  この負荷下で空描画（WebGL context 不調と推定）を起こす実測不具合を確認し、
  `captureWithPuppeteer` と同じ「起動→1枚→終了」を毎回独立させる方式に修正した
- `network-zero.mjs` は `page.setRequestInterception(true)` を使わず、`page.on('request')` の
  素通し観測に頼っている。大きな `file://` 主ドキュメント（本シートは埋め込みフォントで数 MB）で
  `setRequestInterception` を有効化すると `request.continue()` 後も `load` イベントが来ない
  puppeteer-core 側の実測不具合があったため（本タスクの境界外・puppeteer-core 自体の挙動）。
  観測のみで「継続するかどうか」を制御しないため、判定の正確性そのものには影響しない
  （実際に発生したリクエストを漏れなく数えられている）。
