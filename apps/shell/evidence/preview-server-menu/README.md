# preview-server-menu（メニュー「ひらく」→ ブラウザプレビュー）L1 検証手法・証跡

task: 2026-09-02-shell-preview-server-menu（Windows 実機）。
メニュー（activity bar 5 番目）の「ひらく」節に「ブラウザプレビュー」を追加し、
`packages/preview-server`（`akari.sh --preview` と同じサーバー）をシェルのバックエンドから
子プロセス起動して URL を表示、最新版（frame-engine・既定）と従来版（`?frameEngine=0`）を
外部ブラウザで開き分け、「停止」とシェル終了でサーバーを確実に止める（孤児プロセスを残さない）。

## 実装の要旨

- UI（`akari-menu-widget.tsx`）: 「ひらく」節 5 番目に `akari.menu.browserPreview`
  （`codicon-globe`）。ゲートは書き出しボタンと同じ `editJsonExists`（GUI から edit.json は
  作らない）。押下は idle / failed なら start → running で最新版 URL を外部ブラウザへ、
  running なら開くだけ（二重起動しない）。starting 中は disabled + ラベル「起動中…」。
  節直下の状態ブロック（`data-akari-preview-server-status`）に URL（`<code
  data-akari-preview-server-url>`・クリックでコピー）と「最新版で開く」「従来版で開く
  （frameEngine=0）」「停止」。開くボタン 2 つは `title` 属性に開く URL そのものを持つ。
  ポーリングは starting / running の間だけ 1,000 ms。widget dispose では止めない
  （メニューを閉じてもサーバーは生かす）。`onWorkspaceChanged` で stop。
- バックエンド（`AkariPreviewServerService`・JSON-RPC `/services/akari-preview-server`）:
  `packagedPackageEntryCandidates('preview-server', 'src/server.mjs', …)` で入口を解決し、
  `process.execPath` + `ELECTRON_RUN_AS_NODE=1` + ffmpeg/ffprobe 明示 env（quick-export の
  `childEnvironment` と同一・`child-node-process.ts` へ抽出して共有）で spawn。ポートは
  4567〜4576 を `net` プローブで順に試す。stdout に `http://127.0.0.1:<port>` が現れたら
  running（10 秒でタイムアウト）。EADDRINUSE / stderr 末尾 / exit code を日本語 failureSummary に
  整形。stop は SIGTERM → 2 秒で SIGKILL（win32 は TerminateProcess）。シェル終了は
  `BackendApplicationContribution.onStop` + `process.once('exit')` の同期 kill の二段防御。
- 同梱: `build.extraResources` に `packages/preview-server`（package.json + src/** + public/**）を
  追加（相対 import 先の edit-store/lib・media-bin/src・render-cut/src・overlay-runtime・
  assets/font は既に同型配置済み・npm 依存ゼロ）。`verify-asar-contents.mjs` の必須一覧に 4 本、
  `check-packaged-imports.mjs` の `defaultEntries` に server.mjs を追加。

## 手法

`verify` スキルの L1 節（Electron 直起動 + CDP）の Windows 版。`npm run build`（theia build）で
`lib/` を作り直し、Electron 直起動（隔離ワークスペース = test-project のコピー・隔離
user-data-dir・`--remote-debugging-port` + `--no-sandbox`）→ CDP WebSocket で
`#akari-menu-widget` の出現と `.theia-preload` の消失を待ち、DOM 直接クリック・属性読み取り・
`Page.captureScreenshot`（メニュー widget 周辺を clip）で観測した。終了は CDP `Browser.close`
（graceful・バックエンドの onStop が走る）。検証スクリプト・模擬 Resources・ログは
リポジトリ外に置き、コミットしていない。

## 検証したシナリオと実測

| # | シナリオ | 実測 |
|---|---|---|
| 1 | 起動 → 描画完了 | Frontend startup 5,181 ms（backend プロセス起点 8.1 s）。メニュー widget にボタン 7 個（既存 4 + ブラウザプレビュー + 書き出し 2） |
| 2 | 「ブラウザプレビュー」クリック | **798 ms** で `[data-akari-preview-server-status="running"]` + `[data-akari-preview-server-url]` = `http://127.0.0.1:4567`（3 秒以内の条件を満たす）。スクショ `01-preview-running.png`（「ひらく」既存 4 項目の順序・ラベル・アイコン不変も本スクショで確認） |
| 3 | HTTP 実測 | `GET /` = **200**・`GET /?frameEngine=0` = **200**・`GET /api/summary` = 編集サマリー JSON（version/output/sources/tracks） |
| 4 | 開くボタンの `title` 属性 | 最新版 = `http://127.0.0.1:4567/`・従来版 = `http://127.0.0.1:4567/?frameEngine=0`（DOM から読取・完全一致） |
| 5 | 「最新版で開く」「従来版で開く」クリック | 例外 0 件（`Runtime.exceptionThrown` をクリック後 3 秒監視）。既定ブラウザが実際に開くことの目視は未確認（本 task の合意事項） |
| 6 | 「停止」クリック | 1 秒後 `curl` が接続失敗（exit 7）・`*preview-server*server.mjs*` のプロセス **0 件**・状態ブロック消滅。スクショ `02-preview-stopped.png` |
| 7 | 再度「ブラウザプレビュー」→ CDP `Browser.close` | **672 ms** で running 復帰 → graceful quit の 3 秒後、preview-server プロセス **0 件**・この worktree の electron.exe **0 件**（孤児なし = onStop / exit フックが効いている） |
| 8 | 模擬 Resources（パッケージ配置の代替検証） | `build.extraResources` を filter どおりコピーして模擬 Resources を構成（354 ファイル・生成物 3 エントリはローカル未生成のため skip）。`cwd = C:\` から `ELECTRON_RUN_AS_NODE=1 electron.exe <Resources>/packages/preview-server/src/server.mjs <隔離ws> --port 4599` → `GET /api/summary` = **200**・`GET /` = **200**（Resources 配下で相対 import が全部解決）。子は PID 指定で停止 |

補記: CDP アタッチ直後に毎回 1 件だけ `Error: view container is disposed`（Theia の
plugin view container 機構・`updateViewVisibility` 経路）が観測されるが、何もクリックしない
対照観測（9 秒）でも同一スタックで 1 件出ることを確認済み — 本機能のクリックとは無関係の
既存事象（クリック起因の例外は 0 件）。

## 単体テスト（L0）

`build:ext` / `lint` / `check:docs-sync` すべて exit 0。strip テストは 97 件中 96 pass・
fail 1 件は既存の Windows FAIL（`packagedCliCandidates: 開発配置ではリポルート直下の
packages/ に当たる`・`/repo` 前提のパス比較）のみで新規 fail 0。新規テストは
`preview-server-cli.test.mjs`（9 件: 裁定 3 の純関数）+ `preview-server-service.test.mjs`
（11 件: spawn 差し替えで start / EADDRINUSE / 予期しない close / stop / root 差し替え /
再入 / 入口不在 / 空きポート探索 / タイムアウト）+ `packaged-cli-candidates.test.mjs` 追記
（3 件: 一般形の解決 + 委譲後のバイト同一）= 23 件全 pass。

## 未確認

- Mac（darwin）での実機確認（本ラウンドは Windows 実機のみ）
- 既定ブラウザが実際に開くことの目視（クリックで例外が出ないことまでを確認）
- 実パッケージ（electron-builder 出力）での確認 — 本機では `npm run package` 不可のため
  模擬 Resources（#8）と CI の packaged-imports 静的検査で代替
