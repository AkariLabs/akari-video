# project-consent-startup-deadlock — 検証記録

対象: `apps/shell/extensions/akari-project/src/browser/akari-project-contribution.ts`
（`.akari/` の無いフォルダを開くと起動が永久スピナーになるデッドロックの根治）。

## 結論

- **L0: PASS**（`build:ext` / `lint` / `build` すべて exit 0・実測）
- **L1: PASS**（Electron 実機 + CDP。受け入れ条件の 5 シナリオすべてを実測、スクショ 8 枚 + 実測値ログ）

## 根因（修正前）

`onStart()` が `watchOpenRoots()` → `handleRoot()` を `await` しており、その中の
`await this.messages.info(PROJECT_CONSENT_MESSAGE, ...)` がユーザー回答を待つ。
しかし通知 UI は `FrontendApplication.start()` がシェルを `attachShell()` する**前**に
`startContributions()`（= 全 `FrontendApplicationContribution#onStart()` の await）が
完了しないと呼ばれないため、`.akari/` の無いワークスペースを開くと `startContributions()`
が永遠に完了せず、シェルが一度も描画されない（起動プローブでの実測で確認済み。
`node_modules/@theia/core/lib/browser/frontend-application.js` の `start()` を参照）。

## 修正内容

1. `onStart()` から `watchOpenRoots()` の `await` を外し、`FrontendApplicationStateService`
   を `@inject` して `this.stateService.reachedState('ready').then(() => { void this.watchOpenRoots(); })`
   の形にした。`onStart()` 自体は `watchOpenRoots()` の完了を待たず同期的に完了する。
   `await this.workflow.load()` は残した（`FileService.readFile()` の backend RPC のみで
   ダイアログを含まないことを実装を読んで確認済み）
2. `onWorkspaceChanged` ハンドラは変更なし（`ready` 到達後にしか発火しないため元々安全）
3. `handleRoot()` の `messages.info()` 呼び出し直前に回帰防止コメントを追加
   （「messages.info はシェル描画前に await してはならない（起動デッドロック F35）」）

## L0 — 静的・機械的（PASS）

worktree で以下を実測（すべて exit 0）:

```
cd apps/shell
npm run build:ext   # tsc -b 8 拡張
npm run lint        # eslint extensions/*/src/**/*.{ts,tsx}
npm run build       # production: [build/browser]/[build/node]/[build/electron] とも 0 errors
```

## L1 — 実機観測（PASS・全項目実測値付き）

検証ドライバ: 本ディレクトリの `probe-consent-startup.mjs`（依存追加なし、Node 22+ 組み込みの
`fetch`/`WebSocket` のみ）。実際に Electron を起動し、CDP で `#theia-app-shell` の描画・
`.theia-preload` スピナーの消滅・Theia の実通知トースト（`.theia-notification-list-item-container`）
への実クリックまでを一気通貫で自動観測する。

**重要な地雷（開発中に踏んで直した）**: `#theia-app-shell` の存在だけをチェックすると、
`attachShell()` がスピナー要素の**手前**にシェルを挿入する実装（`frontend-application.js`
`attachShell()`）のせいで、スピナーがまだ画面に出ている段階で「描画完了」と誤判定してしまう
（実際にスクショで確認：スピナーが写っていた）。正しい判定は
`#theia-app-shell` 存在 **かつ** `.theia-preload` 要素が DOM から除去済み
（`revealShell()` 完了 = `ready` 状態到達）。本スクリプトはこの両方を条件にしている。

| # | 期待値 | 実測 |
|---|---|---|
| 1 | `.akari/` の無いフォルダ + 新規 user-data-dir で起動 → 60 秒以内に `#theia-app-shell` が描画される | **6.77 秒**で描画完了（スピナー消滅・`#theia-app-shell` 存在を確認）。`01-boot-no-akari-shell-ready.png` |
| 2 | 起動完了後に同意通知が表示され、「使う」を選ぶと `.akari/` が生成される | 通知文言を実測（`このフォルダを AKARI Video プロジェクトとして使いますか？...`）。`02-consent-prompt-shown.png`。実クリックで「使う」→ `.akari/` 生成を実ファイルシステムで確認。`03-consent-use-akari-created.png`（クリック後、俯瞰パネルがプロジェクトモード表示に切り替わっていることも確認） |
| 3 | 「開くだけ」を選ぶと `.akari/` が生成されず、以後の再起動で正常起動する | 別フィクスチャで「開くだけ」クリック → `.akari/` 未生成を確認（`04-consent-prompt-before-open-only.png` / `05-consent-open-only-no-akari.png`）。同一ワークスペース + 同一 user-data-dir で**再起動** → **7.07 秒**で描画完了・通知は再表示されず（記憶された同意設定が効いている）・`.akari/` は引き続き未生成。`06-restart-open-only-remembered-no-prompt.png` |
| 4 | `.akari/` のあるフォルダで従来どおり起動・プロジェクト watch が機能する（回帰） | **6.34 秒**で描画完了・同意通知は表示されない。`07-existing-akari-no-prompt.png`。`watchProject()` が実際に発火していることを、`.akari/events/` 生成・`git init` 実行・`.akari/events/` に gate イベント JSON（`edit-completed`）を実際に置いて `git log` に `編集を完了` コミットが生成されることまで実測して確認（`08-existing-akari-watch-commit.png`、`git log --oneline` = `ebf1ca1 編集を完了` / `dddc78c プロジェクトを開始`） |
| 5 | 証跡保存 | 本 README + スクショ 8 枚 + `run-log.json`（各ステップの実測タイムスタンプ）+ `results.json`（シナリオ別 pass/elapsedMs） |

## 実測ログ・結果ファイル

| ファイル | 内容 |
|---|---|
| `01-boot-no-akari-shell-ready.png` | `.akari/` 無しフォルダを新規 user-data-dir で起動、シェル描画完了直後（同意通知も既に表示済み） |
| `02-consent-prompt-shown.png` | 同意通知のクローズアップ |
| `03-consent-use-akari-created.png` | 「使う」クリック後、`.akari/` 生成・プロジェクトモード切り替わり |
| `04-consent-prompt-before-open-only.png` | 別フィクスチャでの同意通知（「開くだけ」検証用） |
| `05-consent-open-only-no-akari.png` | 「開くだけ」クリック後、`.akari/` 未生成 |
| `06-restart-open-only-remembered-no-prompt.png` | 同一ワークスペース再起動、通知が再表示されないことを確認 |
| `07-existing-akari-no-prompt.png` | `.akari/` 既存フォルダでの起動、通知なし・プロジェクトモード |
| `08-existing-akari-watch-commit.png` | gate イベント JSON 投入後、watch 発火でコミットが作られた直後 |
| `run-log.json` | 各シナリオの実測タイムスタンプ・観測値 |
| `results.json` | シナリオ別 pass/elapsedMs のサマリ |
| `probe-consent-startup.mjs` | 検証ドライバ本体（再実行可能） |

## 再現手順（次回の L1 用）

```sh
cd apps/shell
# node_modules が無ければ: PYTHON=/usr/bin/python3 npm install --no-workspaces
npm run build
node extensions/akari-project/evidence/consent-deadlock/probe-consent-startup.mjs \
  "$(pwd)" <SCRATCH ディレクトリの絶対パス>
```

`<SCRATCH>` は動画フィクスチャ（`<SCRATCH>/fixture-sample.mp4`、ffmpeg 等で生成した
数秒の mp4 で可）を 1 本置いておくだけでよい。ワークスペース・user-data-dir・config-dir は
スクリプトが `<SCRATCH>` 配下に自動生成する（コミット不要・検証後に削除してよい）。
