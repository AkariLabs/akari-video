# プレビュー再生・シーク停止の検証証跡

## 根因

- `apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts:6123`（起点 d24071be 時点）の `frameEngineBootstrapScript()` のテンプレートリテラル内に TypeScript の型述語 `.filter((value): value is number => ...)` が残っていた
- webview へ inline 注入される JS なので tsc の検査を通らず、ブラウザで SyntaxError（`missing ) after argument list`）→ frame-engine bootstrap が丸ごと実行されない
- frame-engine は既定 ON（`akari.preview.frameEngine` default true）で、同ファイル:6667 の `frameEngineMediaIdle` が legacy の `<video>` 経路を休止させるため、clock も legacy 再生も無い＝再生・シークとも 0:00 で停止
- 混入コミット: 49c9bb9c（2026-08-31 00:50）

## 実測（実 Electron + CDP・libffmpeg は stock 版へ差し替え・viewport 1680x1000・左右パネルは畳んで計測）

| 対象 | 起点 d24071be | 修正後 |
|---|---|---|
| object-tree 案件 複製: 再生 2 秒での出力時刻の進み | 0.000 s（0:00 のまま） | 2.334 s |
| 同: シーク 1.0s / 4.5s の `#preview-stage` スクショ sha256 | e677593e…（2 点とも同一） | 0eeb8695… / 1babe247…（別） |
| 同: frame-engine 起動 | `stage[data-frame-engine-active]` 無し・`window.akari.frameEngineClock` 無し | active=true・clock あり |
| 同: bootstrap inline script の `new Function` パース | `missing ) after argument list` | ok |
| critique-cut-v2 複製（新語彙なし）: 再生 2 秒での進み | 0.000 s | 2.234 s |
| renderer 未処理例外 | 0 | 0 |

## 切り分け（起点ビルドで新語彙を 1 種ずつ抜いた 6 変種・全部同じ結果 = 新語彙は無関係）

| 変種 | 起点での再生 | bootstrap パース |
|---|---|---|
| v0 原本複製 | 0.000 s | SyntaxError |
| v1 captions 袋のみ除去 | 0.000 s | SyntaxError |
| v2 純グループのみ除去 | 0.000 s | SyntaxError |
| v3 HTML 袋のみ除去 | 0.000 s | SyntaxError |
| v4 keyframes のみ除去 | 0.000 s | SyntaxError |
| v5 telop のみ除去 | 0.000 s | SyntaxError |
| （参考）critique-cut-v2 = 新語彙ゼロ | 0.000 s | SyntaxError |

## fail-open の追加

- `preview-items.ts` の `collectItems`: 未知の `source.kind` は全バケットでスキップし、同じ読込で警告 1 回だけ（captions / group は既知の非バケット種別として明示）
- `frame-engine-layer-supply.ts`: `summary.layers` の不正エントリ（非オブジェクト）だけを警告 1 回で落とす。src 無しの layer は総尺に効くのでそのまま通す

## 既存の構文ガードは存在していたが CI で走っていなかった

- `apps/shell/extensions/akari-preview/test/` には 3 つの webview テンプレート（`hostAdapterScript` / `previewBootstrapScript` / `frameEngineBootstrapScript`）すべてに `vm.Script` による構文検査テストが既にある
- 起点 d24071be で akari-preview の `npm test` は 455 件中 4 件 fail、うち 2 件がこの構文ガード（`frameEngineBootstrapScript` / frame-engine 音声 glue）だった
- `.github/workflows/ci.yml` の apps/shell L0 ジョブは `build:ext` と `lint` だけで `npm test` を走らせていないため、この RED はマージを止められなかった
- 修正後は 459 件中 457 pass / fail 2（残り 2 件は起点にも存在する既存不良で内容も同一）

## ファイル構成と再現手順

### ファイル構成

- `scripts/run-l1.mjs` — 生 CDP で main window に接続 → 素材パネルの `edit.json` カードをダブルクリック → 出力プレビュー webview の active-frame へ接続 → 左右パネルを畳む → 再生ボタンを実クリックして 2 秒間の `#seek` 値の進みを測る → `#seek` を 1.0s / 4.5s の位置で実クリックし `#preview-stage` を clip してスクショ → inline script を `new Function` でパース検査 → console / `exceptionThrown` / `Log.entryAdded` を集計
- `scripts/launch-l1.sh` — Electron を CDP 付きで起動し READY を待って `run-l1.mjs` を回す
- `scripts/make-variants.mjs` — 切り分け用 6 変種の生成（原本は読み取りのみ）
- `before/` — 起点 d24071be ビルドでの objtree / critique の L1 ログ（`*-l1.json`）とシーク 2 点のスクショ、`variants-matrix.json`（6 変種の一覧）
- `after/` — 修正後ビルドでの同じ一式

### 再現手順

1. リポジトリルートで `npm install --ignore-scripts` し、`apps/shell` で `npm run build`
2. `node_modules/electron` の libffmpeg を stock 版へ戻して `apps/shell/scripts/resign-electron.mjs` を実行（build が非プロプライエタリ版へ差し替えるため）
3. `bash scripts/launch-l1.sh <案件ディレクトリ> <出力先> <ラベル> [ポート]`

### 注意

- 計測時はプレビューペインを広げること。ペイン幅が狭い（実測 413px）と `#time-label` が `#play-toggle` の上に重なって再生ボタンをクリックできない（`run-l1.mjs` は左右のサイドパネルを畳んで 1138px を確保している）。これはプレビュー transport の別件のレイアウト問題で本修正の対象外
- 証跡の絶対パスは `<WORKTREE>` / `<SCRATCH>` へ置換済み（governance の tracked-file leak scan 対応）
