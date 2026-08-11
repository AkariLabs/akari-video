---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-08-09
---

# partner-cli-phase2 L1 検証手法・証跡

タスク: `2026-08-09-partner-cli-phase2`（opencode 自動インストール昇格 + Copilot / Cursor /
Antigravity CLI 追加）の実機検証記録。ラッパー（codex ラッパーレーン、契約
`harness/wrapper-codex.md`）自身が実測。編集は codex に委譲し、本ディレクトリの検証スクリプト・
スクリーンショット・ログはラッパー自身が Write した（fixture 例外の範囲内）。

## 事前調査（委譲前、ラッパー自身が実施）

`research/2026-08-09-agent-cli-extension-landscape.md` の追記表を裏取りし、2点の訂正・確定を
codex への委譲プロンプトに反映した:

1. **opencode の実インストール先が research の記載と食い違っていた**。research は「既定
   `~/.local/bin`」としていたが、`https://opencode.ai/install` の実スクリプトを直接取得して
   確認したところ `INSTALL_DIR=$HOME/.opencode/bin`（68行目）であり、実際は
   `~/.opencode/bin/opencode` に設置される。この訂正なしでは L1-3（opencode 実インストール
   一周）が「スクリプト自体は成功するが再検出に失敗する」形で壊れるため、
   `bootstrap-runner.ts` の opencode 候補パスに `~/.opencode/bin/opencode` を追加させた
   （実装は「codex がやったこと」節参照）
2. **copilot の公式インストールスクリプト URL を確定した**: `https://gh.io/copilot-install`
   （GitHub Docs の install-copilot-cli ページに明記。`curl -fsSL https://gh.io/copilot-install
   | bash`）。降格は不要と判断し、他3エージェントと同じ「script URL + 候補パス再探索」流儀で
   実装させた

## curl -sIL 応答記録（2026-08-09、ラッパー自身が実測）

| CLI | URL | 応答 |
|---|---|---|
| opencode | `https://opencode.ai/install` | `HTTP/2 307` → `https://raw.githubusercontent.com/anomalyco/opencode/refs/heads/dev/install` → `HTTP/2 200`（`content-type: text/plain`） |
| Copilot CLI | `https://gh.io/copilot-install` | `HTTP/1.1 301` → `https://raw.githubusercontent.com/github/copilot-cli/refs/heads/main/install.sh` → `HTTP/2 200`（`content-type: text/plain`） |
| Cursor CLI | `https://cursor.com/install` | `HTTP/2 200`（`content-disposition: attachment; filename=cursor-agent-installer.sh`） |
| Antigravity CLI | `https://antigravity.google/cli/install.sh` | `HTTP/2 200`（`content-type: application/x-sh`） |
| Antigravity CLI（win32） | `https://antigravity.google/cli/install.ps1` | `HTTP/2 200`（`content-type: application/octet-stream`） |

いずれも到達可能。4エージェントとも script 実行後の既定インストール先を実スクリプト取得で
確認済み: opencode → `~/.opencode/bin/opencode`（上記の訂正）、copilot → `$PREFIX/bin/copilot`
（非 root 既定 `$PREFIX=$HOME/.local` = `~/.local/bin/copilot`）、cursor →
`~/.local/bin/cursor-agent`（+ `~/.local/bin/agent` 別名シンボリックリンク）、antigravity →
`$HOME/.local/bin/agy`。opencode 以外は既存の `~/.local/bin/<name>` 規約のままで検出できる。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。依存追加なし（Node 22+ 組み込みの
`fetch`/`WebSocket` のみ）。`cdp-lib.mjs` は `partner-ui-r2` / `partner-catalog-regroup`（同リポ・
前段タスク）と同じ共有ヘルパー（様式踏襲・中身無改変）。`widget-lib.mjs` は本タスク専用の DOM
フック集（6エージェント化後の `akari-partner-widget.tsx` / `akari-partner-catalog-widget.tsx` の
現行実装を実際に確認して書いた）。

### 実機起動・隔離

1. `apps/shell` を `PYTHON=/usr/bin/python3 npm install --no-workspaces` → `npm run build`
   （`build:ext` → `theia build --mode production`）でビルド（electron は
   `~/Library/Caches/electron/` の既存キャッシュ（`electron-v39.8.7-darwin-arm64.zip`）から
   `ditto` で展開）
2. `templates/project-default/` を隔離ワークスペース（リポ外の一時作業ディレクトリ）へコピーし
   `.akari/intake.json`（`{"status":"submitted"}`）でホーム v2 の home-flow ゲートを解放
3. `THEIA_CONFIG_DIR` による User スコープ設定の完全隔離 + `--user-data-dir` + 隔離ワークスペース
4. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離ワークスペース絶対パス> --remote-debugging-port=<port> --user-data-dir=<隔離dir>
   --no-sandbox` で直接起動
5. **未導入 / インストール失敗 / 検出済みの3シナリオを Electron 起動時の環境変数で作り分けた**
   （dummy 実行ファイルを実機の `~/.local/bin` に置く代わりに、契約が正規に定義した差し替え
   経路を使うことでホームディレクトリを汚さずに済ませた）:
   - **Run A**（素の PATH。copilot/cursor/antigravity はこの実行機に未導入 — 事前に
     `ls ~/.local/bin` で確認済み）: `AKARI_PARTNER_COPILOT_INSTALL_URL` /
     `AKARI_PARTNER_CURSOR_INSTALL_URL` / `AKARI_PARTNER_ANTIGRAVITY_INSTALL_URL` を
     到達不能な `http://127.0.0.1:1` へオーバーライドして起動。3エージェントとも実際は
     到達可能な公式 URL を持つため、オーバーライドなしではクリック時に本物のインストールへ
     倒れてしまい「インストール失敗時の手動コマンド案内」（L1-4 の必須項目）を再現できない
     ため。opencode の URL は素の既定値のまま（本丸の実インストールを実際に走らせるため）
   - **Run B**（PATH の先頭に `#!/bin/sh` + `echo` のダミー実行ファイル
     （`copilot`/`cursor-agent`/`agy`）を置いたディレクトリを追加）: detection-first（F46）で
     検出され PTY が起動することを確認する（task.md 指示「ダミー実行ファイルによる検出→PTY起動」）

### 実機の地雷（本タスクで新たに実測したもの）

- **右パネルはタブ付き DockPanel**: 「パートナーを追加」パネルと開いた PTY タブは同じ
  DockPanel を共有しており、PTY タブを開くとタブが自動的にアクティブへ切り替わり
  「パートナーを追加」タブの中身が `display:none`（`lm-mod-hidden`）になる。opencode の
  実インストール成功で PTY タブが開いた直後、次のボタンクリックが `{x:0,y:0}` の非表示要素へ
  空振りして発覚。`widget-lib.mjs` の `clickPartnerEntry()` は、対象ボタンが既に見えている
  ときは何もせず、見えていないときだけ `.lm-TabBar-tab` から「パートナーを追加」ラベルを
  検索してクリックし直す（**常時タブを叩く実装は逆効果だった** — 既に見えている状態でも
  別のタブ実体を誤って掴みパネルを隠す退行が実測で発覚し、条件付きに直した）
- **左カタログは縦スクロールする**: 6カードになると1画面に収まらず、スクロール位置によって
  スクリーンショットに写るカードが変わる。`02-catalog-6-cards.png`（先頭 = Claude Code）に加え
  `02b-catalog-scrolled-new-agents.png`（末尾までスクロール = Cursor / Antigravity CLI カード）
  を追加取得し、新規3エージェントのカードも視覚的に確認した（崩れ判定そのものは
  `catalogGroups()` の DOM 実測 — 各カード・スロットの width/height が collapse していないこと
  — で担保。スクリーンショットは補助証跡）
- **冷起動**: 前段タスクの申し送りどおり、本番ビルド後の初回起動はフロントエンド初期化に
  時間がかかる。`right-panel-rows` が6件そろうまで最大90秒ポーリングしてから操作を開始する
  よう Run A・Run B とも統一した（Run B は当初これを省いて `flow.present: false` で1回 FAIL
  した — 冷起動中にボタン座標を先読みして実クリックした際、クリック到達までの間にレイアウトが
  再計算されクリックが空振りしたとみられる。ポーリング追加で解消）

## 実測結果（Run A・Run B）

| # | task.md の L1 受け入れ条件 | 結果 |
|---|---|---|
| 1 | 右パネル: エージェント単位6行、claude/codex は左CLI/右拡張の2ボタン、opencode/copilot/cursor/antigravity は CLI ボタンが全幅、推奨バッジは claude CLI のみ | 実測 `rows.length===6`、配列順どおり `claude→codex→opencode→copilot→cursor→antigravity`。claude/codex は各2ボタン、他4エージェントは各1ボタン（全幅判定: 4エージェントとも幅44pxでclaude CLIボタン幅18pxの2.44倍、閾値1.6倍を明確に上回る）。推奨バッジは`anthropic/claude-code-cli`のみ1件。idle状態でdisabledなボタンは0件。`01-add-partner-panel-6-rows.png` |
| 2 | 左カタログ: 6カード表示で崩れなし | 実測 `groups.length===6`。全カードの全スロットで width/height ≥ 30px（collapse なし）を確認。`02-catalog-6-cards.png`（先頭）+ `02b-catalog-scrolled-new-agents.png`（Cursor/Antigravity カードまでスクロール、説明文の折り返し・「セットアップ」ボタンとも正常描画を目視確認） |
| 3 | **opencode の実インストール一周（本丸）** | **実測**: 初回実行（実装検証中の1回目の Run A 試行、`03-opencode-real-install-pty.png` 撮影時点）で opencode 未導入の状態から公式スクリプトが実際にネットワーク経由で走り、`~/.opencode/bin/opencode`（143MB, Mach-O 64-bit arm64）が新規生成されたことを独立に確認した（`stat` の `ctime`（inode 変更時刻）がスクリーンショット撮影と同じ分単位 = 18:52 であるのに対し `mtime`（アーカイブに埋め込まれたビルド時刻）は8月7日 — 実ダウンロードの証拠として ctime を採用）。状態カードは `state="complete"`、PTY タブに `opencode CLI` が出現。最終版 Run A（`03-opencode-real-install-pty.png` を再撮影した2回目の実行）では既にインストール済みのため detection-first（`reused:true`）経路を通り、これも正常に `complete` へ到達・PTY起動を確認 — 新規インストール・再利用検出の両方を実測した |
| 4 | copilot/cursor/antigravity: curl -sIL応答記録 + ダミー実行ファイルによる検出→PTY起動 + インストール失敗時の手動コマンド案内表示 | curl 記録は本ファイル冒頭の表を参照。**手動コマンド案内**（Run A）: 3エージェントとも URL オーバーライドでインストーラー取得を意図的に失敗させ、`state="failed"` + 本文に確認済みの手動コマンド全文（`npm install -g @github/copilot` / `curl https://cursor.com/install -fsS \| bash` / `curl -fsSL https://antigravity.google/cli/install.sh \| bash`）を含むことを実測（`04`/`05`/`06`）。**ダミー検出→PTY起動**（Run B）: PATH 先頭にダミー実行ファイルを置いた状態で3エージェントとも `state="complete"`・PTYタブ出現（`Copilot CLI`/`Cursor CLI`/`Antigravity CLI`）・スクリーンショットでダミースクリプトの実出力を目視確認（`08`/`09`/`10`）。実インストールは opencode 以外は任意のためダミーで代替（report.md の未確認事項に明記） |
| 5 | 回帰スモーク: claude のセットアップが従来どおり working 遷移する | 実測: 状態カードが `state="working"`（「CLIを確認しています…同梱ランタイムで実行中」）へ正常遷移。副次的に実際の Claude Code CLI PTY セッションが起動し、ワークスペース信頼確認プロンプトが表示されるところまで確認できた（`07-claude-connect-regression.png`）。既存挙動が6エージェント化後も不変であることの傍証 |

## L0（静的検査、ラッパー自身が実測）

```
cd apps/shell
PYTHON=/usr/bin/python3 npm install --no-workspaces   # 1391 packages, exit 0
npm run build:ext   # exit 0
npm run lint          # exit 0（既存の無関係な警告5件のみ [akari-preview]。akari-partner配下0件、エラー0）
npm run build          # exit 0（build:ext + theia build --mode production、browser/node/electron いずれも0 errors）
```

## codex がやったこと と ラッパーが検証したこと の区別

- **codex がやったこと**（job-id `task-msljvv94-4s5rvx`、往復1回、所要 約16分17秒）:
  6ファイルの編集。`bootstrap-runner.ts` は `opencodeCandidates()` を汎用の
  `scriptInstallCandidates(executableName, extraCandidates)` へ一般化し、4エージェント分の
  パラメータ表（`scriptInstallAgentConfigs`）+ 共通ヘルパー `runScriptInstaller()` を実装（
  コピペ実装ではない）。ラッパーが指摘した opencode の `~/.opencode/bin/opencode` 追加候補パスも
  正しく反映され、Windows 側の拡張子バリアント対応まで一般化されていた（ラッパーの提示より
  丁寧な実装）。`main()` は6エージェント判定へ拡大し `wirePluginSkills` は claude 限定のまま
  不変。`akari-partner-protocol.ts`（型拡大）・`partner-catalog.json`（3エントリ追加）・
  `partner-catalog.ts`（ラベル・アイコンクラス追加）・`partner-terminal-style.ts`（3アイコン
  追加）・`akari-partner-widget.tsx`（`LEGACY_CLI_LABELS` 3キー追加）は契約の文面どおり
- **ラッパーが検証したこと**: 上記全ファイルの diff を目視で契約と1行ずつ突き合わせ（`self,
  string[]`/`import`追加なしの確認込み）、`npm run build:ext`/`lint`/`build` を自分の手で実行し
  exit code を確認、L1（Run A・Run B の実機2セッション・11スクリーンショット・DOM実測・
  独立ファイルシステム確認）を自分の手で実施。codex 自身は検証・commit・status.json・
  report.md を一切行っていない（委譲プロンプトで明示的に禁止した）
- **ラッパー自身が Write した fixture**（契約の fixture 例外の範囲内、src/ 無改変）: 本
  ディレクトリ配下の検証スクリプト一式（`cdp-lib.mjs`（無改変流用）/ `widget-lib.mjs` /
  `run-a.mjs` / `run-b.mjs`）・スクリーンショット11枚・`run-a-log.json` / `run-b-log.json`・
  本 README。一時作業ディレクトリ側のダミー実行ファイル・隔離ワークスペース・raw electron ログは検証後に
  完全削除した（前段タスクと同じ後片付け慣行）

## 隔離・後片付け

実 Electron プロセス（メイン + helper 群）は `ps aux` で確認した実 PID を個別指定して
`kill -9`（`pkill -f` のような広いパターンマッチは使わない — 同時に別タスクの Electron
プロセス（`paid-assets-one-view`、ポート9333）が動いていたため）。検証用ワークスペース・
隔離設定ディレクトリ・ダミー実行ファイル・raw electron stdout ログは検証後に完全削除し
コミットしていない（スクリーンショットと `run-*-log.json`・検証スクリプトのみ本ディレクトリに
残す）。**opencode の実インストール（`~/.opencode/bin/opencode`）は削除していない** —
これは本タスクの目的そのもの（オーナー実機での「セットアップに失敗しました」を解消する
自動インストール）であり、副作用ではなく意図した成果物のため。

## 未確認事項

- copilot / cursor / antigravity の実インストールは任意項目のため実施していない（ダミー実行
  ファイルによる検出→PTY起動の配線確認まで。3URLとも到達可能であることは curl で確認済みだが、
  実バイナリでのPTY起動・認証フローは未検証）
- Windows/Linux での再現性は未確認（macOS darwin-arm64 のみ。win32 の分岐（antigravity のみ
  ps1 実行、他3エージェントは detection-only + 案内フォールバック）はコードレビューでのみ確認
  し実機検証はしていない — 契約が明示的に実機検証を macOS のみと定めている）
- パッケージ版（`electron-builder` 出力）での再検証はしていない（開発ビルドでの検証のみ）
- claude 回帰は「接続フローが working へ遷移する」ところまでの確認であり、実ログイン完了・
  実際のパートナー接続成立までは検証範囲外（task.md の指示どおり）
- opencode の実ログイン・実際の対話動作までは検証していない（PTY起動と検出配線の確認まで）
