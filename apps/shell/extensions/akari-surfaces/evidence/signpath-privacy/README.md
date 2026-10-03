# 自動の通信を 1 つの設定で止める・初回の通信説明 — 実機の証跡

開発 Electron（`apps/shell` を build したもの）を隔離して起動し、CDP で操作して測る手順と、測った結果の要約。

ここに置くのは再現スクリプトとこの README だけ。スクリーンショットと `results.json` は記録物なのでリポには入れない
（`skills/verify/SKILL.md` の L1「観測・記録」）。`--out` で指定した場所に出る。

## 再現

```sh
cd apps/shell && npm run build      # Electron 実体とネイティブ依存が要る
node apps/shell/extensions/akari-surfaces/evidence/signpath-privacy/scripts/l1-privacy.mjs --out=<出力先> --path=full
node apps/shell/extensions/akari-surfaces/evidence/signpath-privacy/scripts/l1-privacy.mjs --out=<出力先> --path=minimal
```

- 隔離: `HOME` / `AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` をすべて `$TMPDIR` 以下の新規ディレクトリへ向ける。実環境の `~/.akari`・`~/Akari`・`~/.theia`・インストール済みアプリには触れない。終了させるのは自分が起動した Electron とその子孫だけ
- 走行は 3 回: **A** 初回起動（説明 → スイッチを OFF → 続ける）/ **B** OFF のまま再起動して、起動 → ホーム表示 → 設定を開く（本測定）/ **C** ON に戻して同じ手順（対照）

## 通信の観測（3 層 + 手元サーバー）

| 層 | 拾うもの | 仕組み |
|---|---|---|
| Chromium netlog | レンダラの fetch・Electron の net | `--log-net-log` |
| Node の接続フック | Theia バックエンド・子プロセス（素材カタログの取得・Open VSX）の http / https / fetch | `scripts/net-hook.cjs` を `NODE_OPTIONS=--require` で差し込み、`net.Socket.prototype.connect` を記録 |
| nettop | 外部インターフェースのソケット（起動した PID の子孫だけ） | `nettop -n -x -L 0 -t external` |
| 手元の検証用サーバー | ホームの `latest.json` 取得 | 開発ビルドは更新 UI が無効でホームが取りに行かないため、`AKARI_UPDATE_FEED_URL` を 127.0.0.1 のサーバーへ向けて受信数を数える |

C（ON）で同じ観測が接続を拾えることを確かめたうえで、B（OFF）の 0 件を読む。

## 結果（2026-10-04）

| 走行 | 判定 | B（OFF）: AKARI 自身のプロセスの外部接続 | B: `latest.json` 受信 | C（ON・対照）で拾えた外部接続 | C: `latest.json` 受信 |
|---|---|---|---|---|---|
| `--path=full`（実行環境の PATH のまま） | PASS 12/12 | 0 件（netlog 0・Node 0・nettop 0） | 0 回 | `open-vsx.org` `openvsx.eclipsecontent.org` `akari.video`（nettop 3 フロー） | 1 回 |
| `--path=minimal`（PATH を OS 既定に絞る = 外部パートナー CLI が無いマシン相当） | PASS 13/13 | 0 件。起動した全プロセスを合わせても 0 件 | 0 回 | 同上 | 1 回 |

観測の規模（B の走行）: full = 69 秒・追跡 PID 34・フックを読み込んだプロセス 10・netlog 695,822 B / minimal = 82 秒・追跡 PID 23・フック 9・netlog 700,787 B。
詳細は出力先の `results.json`（観測秒数・追跡した PID 数・フックを読み込んだプロセス数を含む）。

### 読むときの注意

- **`--path=full` の B に出る `agy -> …` は AKARI の通信ではない**。設定を開くと、導入済みの外部パートナー CLI を
  `--version` で実行して版を表示する（既存の挙動）。そのとき CLI 自身が自分のサーバーへつなぐものがある
  （このマシンでは `agy`、試走では `command-code` と、そこから呼ばれた `npm view`）。`results.json` では
  `thirdPartyCliConnects` に分けて記録し、合否には数えていない。`--path=minimal` はこの CLI が見つからない条件での測定
- **A（初回）の外部接続は合否に使わない**。説明を閉じるまでは既定（ON）のまま動くため、素材カタログと Open VSX への接続が出る。
  `registry.npmjs.org` は開発 Electron だけの経路（同梱 CLI が無いと npm から CLI を取る。配布版は同梱を使うので出ない）で、
  1 回取れば B・C では出ない
- **electron-updater の起動時確認は開発ビルドでは走らない**（未パッケージでは electron-updater 自身が確認を飛ばす）。
  この経路の停止は既存の実装のままで、ここでは測っていない
- `b-*-settings-about.png` / `c-*-settings-about.png` は、ウィンドウ全体を覆う初回ガイドを撮影のあいだだけ隠して撮っている
  （`*-home.png` は隠さずに撮ったもの = 初回説明のあとに既存のガイドがそのまま出ている）

## 出力されるスクリーンショット

| ファイル | 内容 |
|---|---|
| `a-01-first-run-notice.png` / `a-01-first-run-notice-dialog.png` | 初回起動で出る通信の説明（ガイドより前に単独で出る） |
| `a-02-first-run-notice-switch-off-dialog.png` | その場でスイッチを OFF にしたところ |
| `a-03-after-notice.png` | 「続ける」のあと、既存のガイドへ進んだところ |
| `b-auto-check-off-settings-about.png` | 設定「このアプリについて」の「更新と素材の自動確認」（OFF） |
| `c-auto-check-on-settings-about.png` | 同（ON） |
