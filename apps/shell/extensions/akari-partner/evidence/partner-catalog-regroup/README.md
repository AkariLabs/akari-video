---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-08-09
---

# partner-catalog-regroup L1 検証手法・証跡

タスク: `2026-08-09-partner-catalog-regroup`（接続ボタンのカタログをエージェント単位に再編し
opencode を追加する）の実機検証記録。ラッパー（codex ラッパーレーン、契約
`harness/wrapper-codex.md`）自身が実測。編集は codex に委譲し、本ディレクトリの検証スクリプト・
スクリーンショット・ログはラッパー自身が Write した（fixture 例外の範囲内）。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。依存追加なし（Node 22+ 組み込みの
`fetch`/`WebSocket` のみ）。`cdp-lib.mjs` は `catalog-account-first-ux`（同リポ・別タスク）と
同じ共有ヘルパー（様式踏襲・中身無改変）。`widget-lib.mjs` は本タスク専用の DOM フック集
（`akari-partner-catalog-widget.tsx` / `akari-partner-widget.tsx` の現行実装を実際に確認して
書いた）。

### 実機起動・隔離

1. `apps/shell` を `PYTHON=/usr/bin/python3 npm install --no-workspaces` → `npm run build`
   （`build:ext` → `theia build --mode production`）でビルド（electron は
   `~/Library/Caches/electron/` の既存キャッシュから `ditto` で展開）
2. `templates/project-default/` を隔離ワークスペース（リポ外 scratchpad）へコピーし
   `.akari/intake.json`（`status: "submitted"`）でホーム v2 の home-flow ゲートを解放
3. `THEIA_CONFIG_DIR` 環境変数による User スコープ設定の完全隔離（`catalog-root-fix` で
   確立済みの手法をそのまま踏襲）+ `--user-data-dir` + 隔離ワークスペース
4. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離ワークスペース絶対パス> --remote-debugging-port=<port> --user-data-dir=<隔離dir>
   --no-sandbox` で直接起動
5. **opencode 実行ファイルの有無は起動時の `PATH` 環境変数で制御**した:
   - Run A（missing シナリオ）: 素の `PATH`。この実行機に opencode は実際にインストール
     されていないことを `which opencode` / `ls ~/.local/bin/opencode` で事前に実測確認済み
     （両方とも not found）— 追加の隔離操作なしで「PATH に無い隔離環境」が成立する
   - Run B（present シナリオ）: `#!/bin/sh` + `echo` のダミー実行ファイル
     （`opencode dummy started with args: ...` / `PWD: ...` を出力後 `sleep 300`）を置いた
     scratchpad ディレクトリを `PATH` の先頭に追加して起動。**実物の opencode はこの実行機に
     無いため、task.md の指示どおりダミーで代替した（未確認事項）**

### ポート衝突の事故と回避（透明性のため記録）

Run B の最初の起動試行はポート 9334 を使ったが、これは**別タスク**（`heavy-media-open`
worktree、無関係な並行検証セッション）が既に使用中のポートで、Electron 側の
`--remote-debugging-port` バインドが `Address already in use` で失敗していた。検証スクリプトは
（同じポート番号のまま動いていた）別プロセスに誤って接続し、古い/無関係な DOM
（グループ化前のカタログ構造）を読んでしまい、当初 `FAIL` と誤判定した。electron
起動ログの `ERROR:net/socket/socket_posix.cc: bind() failed` / `Cannot start http server for
devtools` を突き合わせて原因を特定し、空きポート（9335）を確認してから再起動して解消した。
`heavy-media-open` 側のプロセスは（無関係な並行タスクのため）一切操作していない —
`kill` はすべて `partner-catalog-regroup` パスを含む自分の起動した PID のみを個別指定して実行した。

### CDP 合成クリックが効かない要素・実測の注意点（回避策込み）

- **`Input.dispatchMouseEvent` はビューポート外の要素に対して無反応**（クリック自体は
  「送信成功」扱いで返るが、ページ内の実際のイベントには結びつかない）。opencode カード
  （左パネル最下部、137px 幅の細いサイドバーに3枚縦積み）の「セットアップ」ボタンは
  初期スクロール位置ではビューポート外（実測 `y=1294.8`、ビューポート高さ `668`）にあり、
  素朴な座標クリックが空振りしていた。`widget-lib.mjs` の `clickSetupButtonFor()` は
  クリック前に対象ボタンへ `scrollIntoView({ block: 'center' })` を実行し、その後
  再度座標を取り直してビューポート内であることを確認してからクリックする
- **Lumino のタブラベルクラス名は `lm-TabBar-tabLabel`**（旧 `p-TabBar-tabLabel` ではない —
  このバージョンで実測確認）
- **この xterm.js バージョンはキャンバス描画**（`.xterm-rows` のような DOM
  テキスト行は存在しない実測— `document.querySelectorAll('.xterm-rows')` は 0 件）。
  PTY 出力の実測はテキスト抽出ではなくスクリーンショット目視で行った
  （`04-opencode-dummy-pty.png`）

## 実測結果

| # | L1 受け入れ条件（task.md） | 結果 |
|---|---|---|
| 1 | エージェント単位 3 カード。Claude Code / Codex は左CLI・右拡張の2分割、opencode は CLI 全幅表示 | 実測: `groups.length === 3`、配列順どおり `claude → codex → opencode`。claude/codex は各 2 スロット（`anthropic/claude-code-cli` + `-extension` / `openai/codex-cli` + `-extension`）、opencode は 1 スロット（`sst/opencode-cli`）のみ。全幅判定はスロット実測幅で確認（claude 単一スロット幅 51px に対し opencode 単一スロット幅 111px、比率 2.18 倍 — 2分割の片方より明確に広い）。推奨バッジは claude カードのみに表示（`anthropic/claude-code-cli` の `recommended: true` を正しく反映）。`01-catalog-grouped-cards.png` |
| 2 | opencode が PATH に無い隔離環境で [接続] を押すと導入コマンド入りの案内が表示され、アプリ・接続フローが壊れない | 実測: 右パネルの状態カードが `state="failed"` に遷移し、本文に確認済みの実パッケージ名を含む `npm install -g opencode-ai でインストールしてください` を表示。「再試行」ボタンも表示され UI は正常。クリック前後で `window.__errCount` の増分はハンドル済みの `console.error`（onboarding failed のキャッチブロック）のみで、`1+1` の trivial eval が引き続き成功しアプリが応答可能であることも直接確認した。`02-opencode-missing-guidance.png` |
| 3 | opencode 実行ファイルがある状態で [接続] すると PTY タブが開き opencode が起動する（実物が無い場合はダミー実行ファイルで代替可） | 実測: 状態カードが `state="complete"` に遷移（「opencode CLI を開始しました」）。タブバーに `opencode CLI` ラベルのタブが出現。スクリーンショットでダミースクリプトの実出力 `opencode dummy started with args:` / `PWD: <隔離ワークスペース>` が PTY 内に表示されていることを目視確認。**実物の opencode はこの実行機に無いため、task.md の指示どおりダミー実行ファイルで代替した（未確認事項）**。`04-opencode-dummy-pty.png` |
| 4 | 回帰スモーク: claude の [接続] がカタログから従来どおり開始できる | 実測: claude CLI カードの「セットアップ」クリック後、右パネルの状態カードが `state="working"`（「CLI を確認しています…同梱ランタイムで実行中」）へ正常に遷移。カタログの新しいグループ化 UI からでも `begin()` → `beginCli()` → bootstrap の接続フローが従来どおり開始できることを確認した（実ログイン完了までは検証範囲外）。`03-claude-connect-regression.png` |

`PARTNER_CLI_ICON_CLASSES` の 3 agent 網羅性（claude/codex/opencode 全キー）は L0
（`npm run build:ext` の tsc 型検査）で担保 — `Record<PartnerAgentId, string>` の網羅性
チェックにより、キー欠落があればビルドが失敗する。実測: exit 0。

## L0（静的検査、ラッパー自身が実測）

```
cd apps/shell
PYTHON=/usr/bin/python3 npm install --no-workspaces   # 初回のみ
npm run build:ext   # exit 0
npm run lint         # exit 0（既存の無関係な警告 5 件のみ。akari-partner 配下は 0 件。エラー 0）
npm run build         # exit 0（electron/theia production バンドルまで含む、より厳密な L0 として本タスクの L1 の前提に使用）
```

## 隔離・後片付け

各回、実 Electron プロセスは `ps aux` で確認した実 PID を個別指定して `kill -9`
（`pkill -f` のような広いパターンマッチは使わない — 同時に別タスクの Electron プロセス
（`heavy-media-open`）が動いていたため機械的パターンマッチは危険と判断した）。検証用
ワークスペース・隔離設定ディレクトリ・ダミー実行ファイル・raw electron stdout ログは検証後に
完全削除しリポジトリにはコミットしていない（スクリーンショットと `run-*-log.json`・検証
スクリプトのみ本ディレクトリに残す）。

## 未確認事項

- 実物の opencode 実行ファイルでの動作確認はしていない（この実行機に未インストール。ダミー
  `#!/bin/sh` + `echo` スクリプトで PATH 検出 → PTY 起動までの配線を代替確認した）
- Windows/Linux での再現性は未確認（macOS darwin-arm64 のみ）
- パッケージ版（`electron-builder` 出力）での再検証はしていない（開発ビルドでの検証）
- claude 回帰は「接続フローが正常に開始する」ところまでの確認であり、実ログイン完了・
  実際のパートナー接続成立までは検証範囲外（task.md の指示どおり）
