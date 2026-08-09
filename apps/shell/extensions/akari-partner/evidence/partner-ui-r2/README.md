---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-08-09
---

# partner-ui-r2 L1 検証手法・証跡

タスク: `2026-08-09-partner-ui-r2`（右「パートナーを追加」パネルのエージェント単位再編・
左カタログの狭幅縦積みフォールバック・launcher の opencode 案内文修正）の実機検証記録。
ラッパー（codex ラッパーレーン、契約 `harness/wrapper-codex.md`）自身が実測。編集は codex に
委譲し、本ディレクトリの検証スクリプト・スクリーンショット・ログはラッパー自身が Write した
（fixture 例外の範囲内）。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。依存追加なし（Node 22+ 組み込みの
`fetch`/`WebSocket` のみ）。`cdp-lib.mjs` は `partner-catalog-regroup`（前段タスク・同リポ）と
同じ共有ヘルパー（様式踏襲・中身無改変）。`widget-lib.mjs` は本タスク専用の DOM フック集
（`akari-partner-widget.tsx` / `akari-partner-catalog-widget.tsx` の現行実装を実際に確認して
書いた）。

### 実機起動・隔離

1. `apps/shell` を `PYTHON=/usr/bin/python3 npm install --no-workspaces` → `npm run build`
   （`build:ext` → `theia build --mode production`）でビルド（electron は
   `~/Library/Caches/electron/` の既存キャッシュから `ditto` で展開）
2. `templates/project-default/` を隔離ワークスペース（リポ外 scratchpad）へコピーし
   `.akari/intake.json`（`{"status":"submitted"}`）でホーム v2 の home-flow ゲートを解放
3. `THEIA_CONFIG_DIR` 環境変数による User スコープ設定の完全隔離 + `--user-data-dir` +
   隔離ワークスペース（`partner-catalog-regroup` で確立済みの手法をそのまま踏襲）
4. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離ワークスペース絶対パス> --remote-debugging-port=<port> --user-data-dir=<隔離dir>
   --no-sandbox` で直接起動
5. opencode は本タスクの実行機に実際にインストールされていない（`which opencode` 実測で
   確認済み）ため、素の起動がそのまま「PATH に無い」シナリオになる（L1 受け入れ 4）

### 左カタログの狭幅リサイズ — 実測で判明した地雷（重要）

当初、左カタログの実コンテナ要素（`data-akari-catalog-count` を持つ div）へ直接
`el.style.width = '250px'` を inline style で上書きする方法を試みた。
`getBoundingClientRect()` は上書き後の値（250px）を正しく返すため一見機能しているように
見えたが、**スクリーンショットは上書き前後で完全にバイト同一（SHA1 一致）だった**。

原因を DOM 祖先チェーンを実測して特定: Theia の左パネルは Lumino の `SplitPanel` /
`BoxPanel` が管理しており、各祖先要素（`lm-DockPanel-widget`・`lm-BoxPanel-child`・
`lm-SplitPanel-child` 等）は `position: absolute` + inline の `width`/`left` px 値を
**レイアウトパスのたびに Lumino 自身が再計算して上書きする**。対象 div より内側の
inline style 上書きは `getBoundingClientRect()` には反映されるが、その外側の
`overflow-x: hidden` な祖先（実測 165px 固定）にクリップされて画面には一切現れない
（描画上は無変化）。

対処: 実ユーザーと同じ操作 — `.lm-SplitPanel-handle`（左パネルと中央パネルを分ける
スプリッタ）への**実マウスドラッグ**（`Input.dispatchMouseEvent` の
mouseMoved→mousePressed→mouseMoved×8→mouseReleased 系列）に切り替えたところ、
Lumino 自身の内部状態（`relativeSizes`）が正しく更新され、スクリーンショットにも
反映されることを確認した（`widget-lib.mjs` の `dragSplitHandle()`/`findLeftSplitHandle()`
参照）。ドラッグ後に同じ手順で元の位置へ戻し、後続の regression クリックへの影響を避けた。

### CDP 合成クリックが効かない要素・実測の注意点（前段タスクからの既知の地雷、再確認）

- **Lumino のタブラベルクラス名は `lm-TabBar-tabLabel`**（旧 `p-TabBar-tabLabel` ではない）
- **この xterm.js バージョンはキャンバス描画**（`.xterm-rows` のような DOM テキスト行は
  存在しない）— 本タスクでは PTY 出力の実測は不要だった（受け入れ条件が状態カードの
  `data-akari-flow-state` 遷移までのため）
- **冷起動の所要時間**: 本番ビルド後の初回 Electron 起動はフロントエンドの初期化
  （既存プロジェクト一覧の列挙・ワークスペース走査等）に 45 秒以上かかることがある。
  最初の実行では `[data-partner-entry]` のポーリング（20 秒タイムアウト）が間に合わず
  `rows: []` で FAIL した。`[data-partner-entry]` の個数が 5 以上になるまで別途待って
  から本スクリプトを実行することで解消した

## 実測結果

| # | L1 受け入れ条件（task.md） | 結果 |
|---|---|---|
| 1 | 「パートナーを追加」パネル: エージェント単位3行。Claude Code / Codex は左CLI・右拡張の2ボタン、opencode はCLIボタンが行全幅。推奨バッジは Claude CLI のみ | 実測 `rows.length===3`、配列順どおり `claude→codex→opencode`。claude/codex は各2ボタン（`anthropic/claude-code-cli` 182px + `anthropic/claude-code-extension` 184px、`openai/codex-cli` 183px + `openai/codex-extension` 183px）、opencode は1ボタン（`sst/opencode-cli` 388px）のみ。全幅判定: opencodeボタン幅388px vs claudeボタン幅182px（比率2.13倍）。推奨バッジは`anthropic/claude-code-cli`のみtrue、他4ボタンは全てfalse。idle状態でdisabledなボタンは0件（既存属性・挙動が不変であることの傍証）。`01-add-partner-panel-grouped-rows.png` |
| 2 | 左サイドバーのカタログ（幅 ~250px）: スロットが縦積みになり、説明文が1行2〜3文字の縦落ちになっていない | 実測: 実ドラッグでカタログ実効幅を165px→250px（誤差0px）へリサイズ。claudeカードの2スロット（CLI/拡張機能）は `cliSlot.top=171,height=152` → `extSlot.top=333` で縦積みを確認（横並びなら top はほぼ同じになるところ、下に積まれている）。スロット幅196px・説明文幅174pxはいずれも1〜2文字縦落ちが起きる閾値（100px/80px、実測で設定した安全側の下限）を大きく上回る。`02-catalog-narrow-stacked.png` |
| 3 | 回帰: opencode ボタン押下 → 未導入案内（文言に `opencode-ai` を含む）が出る、アプリは壊れない | 実測: 状態カードが `state="failed"` に遷移。本文「opencode CLI のセットアップに失敗しました opencode が見つかりません。npm install -g opencode-ai でインストールしてください 再試行」で `opencode-ai` を含むことを文字列一致で確認。クリック前後の `window.__errCount` 増分はハンドル済みの `console.error`（onboarding failed のキャッチブロック）1件のみで、`1+1` の trivial eval が引き続き成功しアプリが応答可能であることも直接確認した。`03-opencode-missing-guidance.png` |
| 4 | 回帰: 新 UI の Claude Code CLI ボタンから接続フローが従来どおり開始する（flow state が working へ遷移するところまで） | 実測: 状態カードが `state="working"`（「CLI を確認しています…同梱ランタイムで実行中」）へ正常遷移。新しいエージェント単位グルーピング UI からでも `begin()` → `beginCli()` → bootstrap の接続フローが従来どおり開始することを確認した（実ログイン完了までは検証範囲外）。`04-claude-connect-regression.png` |

## L0（静的検査、ラッパー自身が実測）

```
cd apps/shell
PYTHON=/usr/bin/python3 npm install --no-workspaces   # 1391 packages, exit 0
npm run build:ext   # exit 0
npm run lint          # exit 0（既存の無関係な警告5件のみ [akari-preview]。akari-partner配下0件）
npm run build          # exit 0（build:ext + theia build --mode production、browser/node/electron
                          いずれも 0 errors。electron dist は ~/Library/Caches/electron の
                          既存キャッシュから ditto 展開して用意）

cd ../../packages/akari-launcher
npm test               # exit 0（221/221 テスト green）
```

### `npm test` 初回失敗の原因調査と対処（透明性のため記録）

worktree で初めて `packages/akari-launcher` に触れるタスクだったため、事前に repo root の
`npm install` が一度も行われていなかった（`apps/shell` は verify SKILL.md の指示どおり
`--no-workspaces` で個別インストール済みだったが、これは root の hoisted 依存とは別物）。
初回の `npm test` は 221件中2件が失敗した:

1. `test/cut-candidate-distribution.test.mjs`: `ajv` パッケージが解決できず
   `ERR_MODULE_NOT_FOUND`。原因を追跡したところ、テストコードが
   `symlink(REPO_ROOT/node_modules, tmpdir/node_modules)` で repo root の
   node_modules をシンボリックリンクして使う設計になっており（`ajv` は
   `packages/schemas/package.json` の依存）、root install が無いと解決できない
2. `test/status-distribution.test.mjs`: hook overhead が 350ms 閾値を超過
   （タイミング系テスト。当時 apps/shell の `theia build --mode production` が
   同時進行中でマシン負荷が高かったための機械的フレーク）

対処: repo root で `PYTHON=/usr/bin/python3 npm install --no-audit --no-fund` を実行
（9分・1537 packages added / 1390 removed）。**この root install は `apps/shell/node_modules`
にも波及し、`--no-workspaces` で個別に展開していた electron の `dist/`（バイナリ本体）を
消してしまった** — root の workspaces 解決が `apps/shell` も対象に含むため。対処として
electron dist を再度 `ditto` で展開し直し（`node_modules/electron/dist/version` も再作成）、
`npm run build` を再実行して `build:ext`/`lint`（exit 0、警告数不変）を再確認した。
`status-distribution.test.mjs` は build 完了後（マシン負荷が下がった状態）に単体で再実行し
単独では pass することを確認、その後 `npm test` をフルスイートで再実行し 221/221 green
（exit 0）を得た。

**今後同種のタスク（`apps/shell` と `packages/*` の両方に触れる）への申し送り**: repo root の
`npm install` は `apps/shell` の個別 `--no-workspaces` install より**先に**行うほうが、
electron dist の再展開を二度手間にせずに済む。

## 隔離・後片付け

実 Electron プロセス（メイン + 4 helper）は `ps aux` で確認した実 PID を個別指定して
`kill`（`pkill -f` のような広いパターンマッチは使わない）。検証用ワークスペース・隔離設定
ディレクトリ・raw electron stdout ログは検証後に完全削除しコミットしていない（スクリーン
ショットと `run-a-log.json`・検証スクリプトのみ本ディレクトリに残す）。

初回の実機起動試行では、DOM 直接上書きによる狭幅テストが「見た目には無変化」という
誤った陽性結果を出したため、その回のスクリーンショット2枚（`01`/`02` が SHA1 一致）は
破棄し、Electron を一度完全終了・隔離ワークスペースを作り直したうえで、ドラッグ方式に
修正した最終版スクリプトで新規に4枚を撮り直した（現在コミットされている4枚は最終版）。

## 未確認事項

- Windows/Linux での再現性は未確認（macOS darwin-arm64 のみ）
- パッケージ版（`electron-builder` 出力）での再検証はしていない（開発ビルドでの検証のみ）
- claude 回帰は「接続フローが working へ遷移する」ところまでの確認であり、実ログイン完了・
  実際のパートナー接続成立までは検証範囲外（task.md の指示どおり）
- 左カタログの「広幅では従来どおり横2分割になる」（task.md 指示Bの「目的」節、受け入れ
  条件の必須4点には含まれない）は本タスクでは個別検証していない（前段タスク
  `partner-catalog-regroup` で `slotStyle: flex: '1 1 0'` 時の横2分割は確認済み。本タスクの
  変更は `flex: '1 1 150px'` + `flexWrap: 'wrap'` の追加のみで、広幅時に `flex-grow` が
  効いて2分割を維持する挙動はコードの構造上自明とラッパーは判断したが、実機未確認）
