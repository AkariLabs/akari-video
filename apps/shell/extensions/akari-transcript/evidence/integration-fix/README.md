---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-07-17
---

# analysis-integration-fix L1 検証手法・証跡

タスク: `2026-07-17-analysis-integration-fix`（F23/F24/F25 根治 + ビルドゲート恒久化）の実機検証記録。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP/Playwright）に従った。

1. `apps/shell` を `PYTHON=/usr/bin/python3 npm run build`（`prebuild` → `build:ext` →
   `theia build --mode production`）でビルド
2. 隔離ワークスペースを用意する代わりに、`akari-project` 拡張の
   `AkariProjectServiceImpl.createProject()`（コンパイル済み `lib/node/akari-project-service.js`
   を Node から直接 `require` して呼び出す）を実際に実行し、**実装コードそのもの**でプロジェクトを
   新規作成した。これにより `installProjectSkills()`（F23 のスキーマ機械コピー）・
   `writeFallbackTemplate()` 相当の `.claude/settings.json`（F24 の権限アンカー修正）を含む、
   オーナー実機と同じ生成経路を検証できる
3. 生成されたプロジェクトの `assets/` に ffmpeg (`testsrc` + `sine`) 生成の合成 mp4 を 2 本配置し、
   分析スキルの出力形に合わせた `analysis.json` フィクスチャ（1 本目 6 segment・2 本目 2 segment）を
   正典位置 `.akari/sidecars/assets/<name>.analysis/analysis.json` に直接設置した
   （「実スキル出力の実配置」= オーナー実機と同じ配置を、スキル実行そのものは代替せず場所だけ
   忠実に再現する方式。whisper.cpp/ffmpeg 全工程の実行は本タスクのスコープ外）
4. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離プロジェクト絶対パス> --remote-debugging-port=<port> --user-data-dir=<隔離dir> --no-sandbox`
   で直接起動
5. `playwright-core`（検証用スクラッチディレクトリにのみ `npm install`。リポジトリ本体には追加せず）を
   使い `chromium.connectOverCDP` でメインページ（`/lib/frontend/index.html` を含む URL の
   ページ。webview 系 iframe ターゲットは除外）へ接続し、実 UI 操作のみで検証した:
   - コマンドパレット（**Cmd+Shift+P** — Theia 既定の F1 は本アプリでは Claude Code
     パートナーパネルの入力欄にフォーカスが残ったままになり効かなかった。実機操作では先に
     メイン編集領域をクリックしてからパレットを開くこと）→「文字起こしを開く」→ Enter
   - 「文字起こしから字幕を作成」ボタンのクリック
   - 複数候補時の QuickPick 選択（本検証では Escape でキャンセルし表示のみ確認）
6. 観測はスクリーンショット（本ディレクトリの png）と、実ファイル（`captions.json` /
   `.akari/sidecars/**/analysis.json`）の実読み取りで行った
7. 権限（F24）は隔離プロジェクトのディレクトリを対象に、実 claude CLI（`claude -p` ヘッドレス）で
   実際に Edit ツール呼び出しを行い、許可/拒否の実挙動を確認した
8. 後片付け: 起動した Electron は実 PID を指定して `kill`。隔離ワークスペース・生成素材・
   `playwright-core` の scratch install はすべて検証後に完全削除しコミットしていない

## 実測結果の要旨（詳細は `run-log.json`）

| 項目 | 結果 |
|---|---|
| F24 権限アンカー実測（修正前） | `Edit(./assets/**)` は `.akari/sidecars/assets/<name>.meta.json` にも誤マッチし拒否（`File is in a directory that is denied by your permission settings.`）。合成フィクスチャと実プロジェクトの両方で再現 |
| F24 権限アンカー実測（修正後） | `Edit(/assets/**)` はプロジェクト直下 `assets/**` のみを拒否。`.akari/sidecars/**`（`assets/` セグメントを含むパスも含む）と、ワークスペース root 直下ファイルへの Edit は許可。実プロジェクトの `assets/IMG_4606.MOV`・`.akari/sidecars/assets/IMG_4606.MOV.analysis/analysis.json`・`captions.json` の 3 点で確認 |
| F23 スキーマ同梱 | `createProject()` 実行後、`.claude/skills/analyze-footage/references/analysis.schema.json` が生成され、内容は `packages/schemas/analysis.schema.json` と `$comment`（由来注記の追記）以外一致することを確認 |
| F25 パネル探索（単一候補） | 正典位置 `.akari/sidecars/assets/IMG_4606.MOV.analysis/analysis.json` のみが存在する状態で「文字起こしを開く」→ 回避策なし・QuickPick なしで直接開く |
| F25 パネル探索（複数候補） | 2 素材目のフィクスチャを追加後、同コマンドで QuickPick が「文字起こしを開く素材を選んでください。」の日本語プレースホルダ付きで表示され、`assets/IMG_4606.MOV` / `assets/IMG_4607.MOV` の 2 候補が並ぶことを確認（`03-quickpick-multiple-candidates.png`） |
| 生成→6行表示 | 「文字起こしから字幕を作成」クリック後、Monaco エディタに 6 行（フィクスチャの 6 segment と一致するテキスト）が表示（`02-generated-6-lines.png`） |
| captions.json 正典位置 | ワークスペース内に `edit.json` が存在しないフィクスチャで、`captions.json` がワークスペース root 直下に生成される（`project/` サブディレクトリなし）ことを確認 |
| 空状態 UX | 字幕未生成時、エディタ領域中央に「「文字起こしから字幕を作成」を押すと編集を始められます」のガイドが表示される（`01-open-empty-state.png`） |
| L0（`build:ext` / `lint`） | いずれも exit 0 |
| ビルドゲート GREEN | `npm run package` → `postpackage` が全 7 拡張・`/lib/skills/analyze-footage/SKILL.md`・`/lib/schemas/analysis.schema.json`・`/lib/templates/project-default`・サイズ（457MB ≤ 500MB）を確認して exit 0 |
| ビルドゲート RED | `node_modules/akari-transcript` の symlink を故意に削除 → `npx theia build` を直接実行（`npm run build` の `prebuild` フックを迂回）→ ビルド自体は exit 0 のまま拡張がバンドルから silent に外れることを再現 → `npm run package` → `postpackage` が `❌ MISSING in asar: 拡張 akari-transcript` を検出して exit 1（`npm error command failed`） |
| prebuild 自動修復 | RED 再現後、通常どおり `npm run build` を実行すると `prebuild`（`ensure-file-deps-linked.mjs`）が symlink を自動再作成し、以後のビルドが正常化することを確認 |

## 補足

- 実プロジェクト生成には native な「新規プロジェクト作成」コマンドの OS ネイティブファイル選択
  ダイアログ（`showOpenDialog`）を使っていない（CDP/Playwright から自動操作できないため）。
  代わりにコンパイル済み `AkariProjectServiceImpl` を Node から直接呼び出しており、
  `createProject()` の実装コードそのものを経由している点で「合成フィクスチャの自作」とは異なる
  （UI 経路だけを迂回し、バックエンド実装は実物を使用）
- Claude Code パートナーパネルへ検証スクリプトの誤操作でメッセージが一度送信されたが
  （コマンドパレットの起動キーの当たりを確認する過程での事故）、パネルは「進みたい場合は声を
  かけてください」と応答しただけで自律的な操作は発生しなかった（実害なし）
