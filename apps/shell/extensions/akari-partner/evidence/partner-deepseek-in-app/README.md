# partner-deepseek-in-app — DeepSeek Harness を右パネルに埋め込む検証手順（2026-10-07）

対象: 接続カタログの **DeepSeek Harness**（form `web`）を「始める」だけで、右パネルに作業画面が出て、作業対象が
開いているプロジェクトになり、鍵の設定なしで最初の会話ができること。記録物（スクリーンショット・ログ）は
このリポには置かない（governance の evidence-growth 規約）。ここには手順と再現スクリプトだけを置く。

## 仕組み（dsh 0.2.0-rc.2 で確認した事実）

- 対話 UI は `dsh web` だけ。作業フォルダを渡す引数は無い → 依存ゼロのプラグイン（`src/node/dsh-cwd-workspace-plugin.ts` の
  ソース文字列）を `--patch` の `insert` で差し込み、起動ディレクトリを `workspaceRegistry` に登録して先頭へ置く
- 認証クッキーは `SameSite=Strict` → renderer 内の iframe では通らない。`WebContentsView`（専用 partition）を widget の矩形に重ねる
- 接続先は起動のたびに判定: `DEEPSEEK_API_KEY` → 公式 / opencode の `auth.json` に OpenCode Go の鍵 → OpenCode Go / どちらも無ければ案内文。
  鍵は dsh のプロセス環境にだけ渡し、パッチ・ログには書かない
- プラグインは backend の PID を見張り、親が消えたら自分で終了する（アプリの強制終了で dsh が残らない）

## L0

```sh
cd apps/shell
npm run build:ext && npm run lint
node --test extensions/akari-partner/src/node/*.test.mjs extensions/akari-partner/test/*.test.mjs
node --test extensions/akari-surfaces/src/common/*.test.mjs extensions/akari-surfaces/src/node/*.test.mjs
```

Windows（開発者モード無し）では symlink の EPERM と `/bin/sh` 不在で基点から落ちるテストがある（akari-partner 28 件・akari-surfaces 26 件）。
本変更で追加・更新したテスト（dsh-patch / dsh-web-launcher / プラグイン / カタログ件数）はすべて通る。
ホームと一時フォルダは隔離して回すこと（ホームに導入済みの dsh があると「未導入」前提のテストが検出してしまう）。

## L1（dev shell を CDP で操作）

1. ホーム・`AKARI_HOME`・`THEIA_CONFIG_DIR`・一時フォルダを隔離し、`AKARI_PARTNER_WEB_TEST=1` を付けて
   `npx theia start --plugins=local-dir:plugins --remote-debugging-port=<port> --user-data-dir=<dir> <project>` を起動する
   （`AKARI_PARTNER_WEB_TEST=1` は埋め込み view の矩形を読む `inspect` を開発時だけ有効にする）
2. `AKARI_SHELL_DIR=<apps/shell> AKARI_OUT=<dir> AKARI_CDP_PORT=<port> node cdp-start.cjs` — 「始める」→ 完了まで待ち、
   widget の矩形と view の矩形を記録する
3. `node cdp-chat.cjs chat` — 埋め込み側のページに入り、1 往復の会話を送る

結果（2026-10-07・Windows 11・隔離ホームに dsh 導入済み + opencode の auth.json・`DEEPSEEK_API_KEY` 無し）:

| 項目 | 実測 |
|---|---|
| 右パネルの埋め込み | widget の矩形 = view の矩形（x 725 / y 98 / 507 × 596）。別タブへ切り替えると 0 × 0、戻すと復帰 |
| 作業対象 | 埋め込み画面のワークスペースが開いているプロジェクトのフォルダ名。dsh の登録簿でも先頭 |
| 接続先 | 帯の表示「接続先: OpenCode Go」・画面のモデル「DeepSeek V4 Pro (OpenCode Go)」 |
| 会話 | 指定した文字列を 7 秒で返答（1 turn・保存されたセッションは provider `opencode-go`） |
| 閉じる | widget を閉じると dsh のプロセス 2 → 0・埋め込みの target 0 |
| 強制終了 | アプリ本体を強制終了して 4 秒以内に dsh のプロセス 0（親の見張り） |
| 回帰 | opencode CLI の「始める」は従来どおり PTY タブが開く |
| 初回起動 | dsh のホームが空の状態で URL 行まで 3.8 秒（2 回目 2.6 秒） |

## 既知の制約・申し送り

- 埋め込み view は renderer の上に重なる別レイヤー。アプリのダイアログやメニューが矩形に重なると view の下に隠れる（素材サイトの埋め込みと同じ制約）
- `x-opencode-session` は dsh の設定が静的なため「プロジェクトごとに安定した id」。会話ごとではない
- dsh は developer preview。`workspaceRegistry` の形が変わるとワークスペースの自動登録だけが効かなくなる（起動は止めない作り）
- `.cmd` シムやパッチのパスに空白があると `cmd /s` の引用剥がしで起動できない（npm 経路の他エージェントと共通の既存制約）
- 起動待ちは 60 秒。開発中に 1 度だけ出力なしでタイムアウトしたが再現していない（失敗時は「再試行」で開く）
