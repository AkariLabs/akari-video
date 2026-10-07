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
- ネットワークの場所を UNC パスのまま直接開いたプロジェクトでは起動しない（cmd が UNC の作業フォルダを受け付けないため。ドライブ文字を割り当てて開く）
- 起動待ちは 120 秒。読み込みは打ち切らない（20 秒で案内と再試行を出す）

## 差し戻し r1 の補修と追加の実測（2026-10-08）

独立採点の指摘（再読込・同一ウィンドウでのプロジェクト切替で view と dsh が残る、ほか 10 項目）を解消した。あわせて L1 で次を見つけて直した。

- **隠れたまま読み込むと終わらないことがある**: view を 0×0 で作って読み込み完了を待っていたため、ウィンドウが他のウィンドウの裏にあると
  Chromium が埋め込みの renderer を背景優先度（Windows の Idle）に落とし、混んだ機械では読み込みが進まなかった。
  → 先に右パネルへ実寸で表示してから読み込む。60 秒での打ち切りをやめ、20 秒たつと「このウィンドウを前面に出すと読み込みが進みます」と
  再試行を出す。`backgroundThrottling: false` は表示後に別タブへ切り替えた間の背景化を防ぐ（作成時から隠れている renderer には効かない）
- **L1 の起動フラグ**: 検証用ウィンドウは裏に回りやすいので、`--disable-background-timer-throttling --disable-backgrounding-occluded-windows
  --disable-renderer-backgrounding` を付けて起動する（付けないと上の背景化で「たまたま通る / 固まる」が機械の混み具合で変わる）

| 項目 | 実測（上のフラグ付き・`cdp-wait-loaded.cjs`） |
|---|---|
| 開始 | 「始める」から 8〜40 秒で表示 + 読み込み完了（内訳の大半は CLI の確認。view が出てから読み込み完了まで約 3 秒） |
| 再読み込み | view 無し・空タブ無し。同じプロジェクトの dsh は 1 のまま残し、次の「始める」で再利用（同じポート・dsh 1） |
| 同一ウィンドウで別プロジェクトを開く | view 無し・空タブ無し・前のプロジェクトの dsh 0 |
| アプリを閉じて起動し直す | 終了後 dsh 0。起動後に空タブ無し |
| タブを閉じる | dsh 1 → 0 |
| 空白入りのパス | シムとパッチを空白入りの場所に置いて 3 秒で起動。`&` `%` を含むパスは起動前に拒否 |
| 全コアを埋めた負荷の下 | 再読み込み後の再開で 48 秒かかったが表示・再利用とも成立（打ち切らない） |
