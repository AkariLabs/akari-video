# partner-muse-code — Muse Code CLI（Meta）追加の検証手順（2026-10-13）

対象: 接続カタログに **Muse Code CLI**（実行体 `muse`）を公式インストールスクリプトの経路で追加し、
「始める」→ 同意 → 導入 → 検出 → PTY タブで `muse` が起動するまで通ること。
記録物（スクリーンショット・端末の文字列・ログ）はこのリポには置かない。ここには再現スクリプトと手順だけを置く。

## 事実の確認（2026-10-13 時点・Muse Code 1.4.7）

- 導入: `https://dev.meta.ai/install.sh`（bash 専用・`~/.local/bin/muse`）/ `https://dev.meta.ai/install.ps1`
  （`%LOCALAPPDATA%\Programs\muse\muse.cmd`。`.cmd` の shim が PowerShell のランチャーを呼び、ランチャーが本体 `muse-bin-<版>.exe` を起動する）
- 本体はサインイン無しで取得できる（Windows x64 は約 467MB）。ランチャーが起動のたびに更新を確かめる（自分で更新する CLI）
- `muse --version` は `Muse Code 1.4.7 (1.4.7-R6101.1)` を返す
- `muse --help` の権限まわり: `--approval-mode <MODE>` の説明は `untrusted|on-request|never` と縦棒区切り。`--yolo` は承認とサンドボックスを外す
- スキル: リポ直下の `.agents/skills` を読む。**作業フォルダを信頼するまでプロジェクトのスキルは読まれない**
  （`muse skills list` の診断に `project-skills-untrusted` と出る）。初回の画面の「Trust and continue」で信頼すると、以後は引数なしで一覧に出る
- 利用規約: 製品ページのフッターの「Terms of Service」= `https://www.facebook.com/policies_center/`
- アイコン: `https://dev.meta.ai/favicon.ico` の 32×32 を PNG にして単色マスクに使う（SHA-256 は `partner-brand-icons.test.mjs` が照合）

## L0

```sh
cd apps/shell
npm run build:ext -- --force
(cd extensions/akari-partner && node --test test/*.test.mjs src/node/*.test.mjs)
(cd extensions/akari-surfaces && node --test src/common/partner-settings-rows.test.mjs src/node/partner-settings-detection.test.mjs)
```

設定画面（akari-surfaces）の一覧はカタログから作るので、CLI を足すと件数を固定した 2 本のテストも変わる（10 → 11）。

Windows では `/bin/sh`・`/bin/bash` が無いため、基点でも akari-partner の導入テストなど 34 件が落ちる（343 件中）。
本変更後は 355 件で、基点に無かった失敗は 1 件。Devin の導入テストと同じ理由（`spawn /bin/bash ENOENT`）で落ちる
`Muse Code は bash の公式スクリプトから ~/.local/bin/muse を導入し再利用する`。akari-surfaces の
`partner-settings-detection.test.mjs` も `#!/bin/sh` の偽の実行体を使うため Windows では回せない。どちらも mac / Linux で確かめること。

権限の引数の判定（`partnerHelpSupportsArgs`）は、実物の `muse --help`・`claude --help`・`codex --help` の出力でも確かめた
（Muse の `on-request` は true・載っていない値は false。Claude の `--permission-mode auto` と Codex の値なしフラグは従来どおり true）。

## L1-0（実物の配信元に向けた導入処理）

```sh
node real-bootstrap.mjs <隔離フォルダ>
```

`LOCALAPPDATA` / `HOME` を隔離フォルダへ付け替え、`MUSE_NO_MODIFY_PATH=1` で利用者の PATH を変えずに
`bootstrapRunner` を 2 回動かす。結果（Windows 11）: 1 回目は `install.ps1` を取得して実行し 37 秒で
`…\Programs\muse\muse.cmd` を検出（`reused:false`）、2 回目は既存を検出（`reused:true`）。

## L1（dev shell を CDP で操作）

1. dev shell を production ビルドで起動する（`--remote-debugging-port=<port>`。`HOME` / `USERPROFILE` / `LOCALAPPDATA` /
   `AKARI_HOME` / `THEIA_CONFIG_DIR` を隔離し、`MUSE_NO_MODIFY_PATH=1` を付ける）。開くのは `createProject` で作ったプロジェクト
2. `node cdp-catalog.cjs` — `[data-partner-entry]` の一覧と `.akari-partner-muse-cli-icon` の computed style を記録する
3. `node cdp-install.cjs` — 右の「パートナー」→「Muse Code CLI」の「始める」→ 同意ダイアログ →「導入する」→ 完了まで
4. `node cdp-terminal.cjs` — 端末タブの題・アイコン・中身（xterm のバッファ）を読む

結果（2026-10-13・Windows 11）:

- 一覧の 13 番目（Grok Build の次）に `Muse Code CLI / 始める` が出る。アイコンは青（`rgb(0, 130, 251)`）の単色マスク
- 同意ダイアログ: ソフト名 Muse Code・提供元 Meta・取得元 `https://dev.meta.ai/install.ps1`・入れる場所 `%LOCALAPPDATA%\Programs\muse`。
  リンクは取得元と利用規約の 2 本
- 「導入する」から 37 秒で「Muse Code CLI を開始しました · 自動モードで起動」。右の列に Muse Code のタブ（青い∞）が出る
- 起動コマンドは `cmd.exe /d /s /c <…>\muse.cmd --approval-mode on-request`（タブの説明は「自動モードで起動」）
- スキル: 画面で信頼を選んだ後、`muse skills list --source project` に AKARI のスキル 26 個が `.agents/skills/…` として出る

## 申し送り

- **Windows の初回はサンドボックスの準備が要る**（`muse sandbox windows check` が `status=setup_required`）。
  Muse Code は起動時に管理者の確認（ユーザーアカウント制御）を出し、確認が出ている間は端末に何も描かない。
  確認に答えないと Muse Code は終了し、タブも閉じる。準備（`muse sandbox windows setup`）は Windows のユーザーと
  通信の規則を作る変更で、検証では行っていない。準備後の画面と、サインイン後のスキル実行は未確認
- `.cmd` の shim を `cmd.exe /d /s /c` で起動するため、導入先のパスに空白があると起動に失敗する
  （Pi / Command Code の `.cmd` 経路と同じ既存の制約。Windows のユーザー名に空白がある場合に当たる）
- 「毎回確認」は他のツールと同じく引数なしで起動する。Muse Code の既定は自動審査（`on-request` + 審査役）なので、
  毎回確認にしても自動と同じ動きになる
- 本体が 330〜470MB あるため、導入の時間制限は Muse Code だけ 30 分にした（ほかは 10 分）。
  時間切れのとき、裏で動いている提供元のインストーラまでは止めない（既存の仕組み）
