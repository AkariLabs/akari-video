---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-08-09
---

# project-display-title L1 検証手法・証跡

タスク: `2026-08-09-project-display-title`（`.akari/intake.json` に `title` を持たせ、
シェルが人間向けの名前で出す）の実機検証記録。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。

1. `apps/shell` を `PYTHON=/usr/bin/python3 npm install --no-workspaces` → `npm run build`
   （`build:ext` → `theia build --mode production`）でビルド。electron 39.8.7 は
   `~/Library/Caches/electron/` に既にキャッシュ済みの zip を `ditto` で展開して用意した
   （postinstall は npm 11 の allow-scripts ゲートでスキップされるため）
2. リポ外の隔離ディレクトリに検証用の creator-root 一式を作成（元ファイルは無改変）:
   - `<verify>/creator-root/.akari/root.json`（`schema: "creator-root/v1"`）
   - `<verify>/creator-root/channels/default/videos/2026-08-09-natsu-matsuri/` —
     `project-scaffold` の `createProject()` で `templates/project-default/` から実生成した
     プロジェクト。`.akari/intake.json` の `title` を手で `"夏祭りレポート"` に書き換え、
     `status: "submitted"` にした
   - `<verify>/akari-home/creator-root.json`（`lastRoot` で上記 creator-root を指す）
3. Electron を直接起動（`AKARI_HOME=<verify>/akari-home` でマシンポインタの向き先を隔離）:
   ```sh
   AKARI_HOME=<verify>/akari-home THEIA_CONFIG_DIR=<verify>/user-data \
     node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
     <apps/shell 絶対パス> <検証用プロジェクトの絶対パス> \
     --remote-debugging-port=9333 --user-data-dir=<verify>/user-data --no-sandbox
   ```
4. `playwright-core` を検証用スクラッチディレクトリにのみ `npm install`（リポジトリ本体には
   追加していない）し、`chromium.connectOverCDP('http://127.0.0.1:9333')` でアタッチ。
   `page.title()`（= `document.title`）を読み、`.theia-preload` スピナーが消えるまで待って
   からスクリーンショットを撮った

## 実測結果

- ウィンドウ/タブタイトル（`document.title`）: 起動直後は `"AKARI Video"` → intake.json 読み込み
  完了後に `"夏祭りレポート"` → アプリ本体が読み込み終わった時点で
  `"ホーム - 夏祭りレポート"` に安定（フォルダ名 `2026-08-09-natsu-matsuri` は一切出ない）
- ホームのプロジェクト一覧（`01-home-and-tab-title-show-japanese-title.png`）: 「プロジェクト」
  セクションに **2 行とも** `夏祭りレポート` で表示された —
  - creator-root 由来の過去プロジェクト行（フォルダアイコン + `default` チャンネル表示）
  - 現在開いているプロジェクト行（「開いています」「単体」バッジ付き）
  どちらも `title ?? フォルダ名` の解決を通っており、フォルダ名 `2026-08-09-natsu-matsuri` は
  画面のどこにも表示されていない

## 未確認（正直な申告）

- **title 無し（既存プロジェクト）がフォルダ名のまま出ることの実機確認は行っていない** — この
  逆ケースは `packages/akari-launcher` と `apps/shell/extensions/akari-surfaces/src/common/`
  の単体テスト（`resolveProjectDisplayName`/`parseIntakeTitle` の3ケース: title あり/null/
  キー無し）で機械的に確認済みだが、実機スクショは今回の 1 枚（title ありのケース）のみ
- 進め方フォーム（intake フォーム UI）から実際に送信して title が保持されることの実機確認は
  行っていない（本タスクのスコープ外 — フォームに title の入力欄自体が無い設計のため。
  `submitIntake()` が `intakeSnapshot.title` を読み込んで書き戻すことのコードレベルの修正は
  行ったが、これを実機のフォーム送信操作で検証してはいない）
- Electron ネイティブウィンドウの OS タイトルバー自体の見た目（macOS のウィンドウタイトルバー
  装飾）はスクリーンショットに写らない（CDP の `Page.captureScreenshot` は Web コンテンツの
  ビューポートのみを撮る）。かわりに `document.title`（Theia の `WindowTitleService` が
  最終的に書き込む値）を CDP 経由で直接読んで確認した — ブラウザタブ/OS ウィンドウ一覧に
  実際に出る文字列と同一のソース

## 後片付け

隔離ディレクトリ（`/tmp/akari-l1-verify-*`）・起動した Electron プロセス（実 PID で kill）・
`apps/shell/node_modules` 配下でこの検証のために展開した electron バイナリは、検証後に
削除／そのまま（`.gitignore` 済みで元々リポジトリに入らない）。このスクリーンショットのみ
証跡として残す。
