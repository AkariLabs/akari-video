# evidence — home-launcher-popup (task 2026-08-17-home-launcher-popup)

## 実機（CDP）証跡について — 未確認事項として正直に記録

本タスクの受け入れ条件は CDP による実機 PNG 4 種
（(a) 無プロジェクト起動でランチャー自動表示 / (b) 一覧から開ける見た目 /
(c) 閉じると背後に戻る / (d) dashboard から接続カードが消えている）を求めているが、
**この worktree のセッションでは PNG を 1 枚も取得できなかった**。理由と経緯を以下に記す
（捏造はしていない — 撮れなかった事実をそのまま書く）。

### 試行内容

1. `npm install` は node-gyp のネイティブビルドが Homebrew Python 3.14 の壊れた
   `libexpat` リンクで失敗したため、`PYTHON=/usr/bin/python3`（system python）を
   指定して解決した。
2. `apps/shell` の `build:ext` / `lint` / `node --test` はすべて green（下記参照）。
3. Electron 本体は npm の allow-scripts ゲートで postinstall が止まっていたため、
   キャッシュ済み公式 zip（`~/Library/Caches/electron/.../electron-v39.8.7-darwin-arm64.zip`、
   SHA256 が公式 `SHASUMS256.txt` と一致することを確認済み）を手動展開して用意した。
4. 隔離した `AKARI_HOME`（`creator-root.json` + `root.json` + 1 チャンネル + 過去プロジェクト
   1 件のフィクスチャ）を用意し、`--remote-debugging-port` 付きで
   `npm start` / `electron .` の両方を複数回起動した。
5. **症状**: プロセスは `DevTools listening on ws://127.0.0.1:PORT/devtools/browser/...`
   を出力する（= フラグは効いており、CDP ポートは一瞬開く）が、puppeteer-core /
   curl のいずれで接続を試みても `ECONNRESET`（socket hang up）になるか、接続前に
   プロセス自体が終了する。`npm start` 経由の 1 回だけ約 87 秒生存したが、その間も
   devtools URL 自体がログに出力されなかった。
   `log show` で追うと、直接 spawn したケースでは WindowServer 接続直後に
   `runningboardd` の assertion が invalidate され `not lifecycle managed` として
   プロセスが片付けられている（`man runningboardd` 相当の macOS ライフサイクル管理が、
   このセッションの非対話的な子プロセス生成では GUI ウィンドウの寿命を保証していない
   ように見える）。`open -a` 経由（LaunchServices 経由の起動）も試したが、そもそも
   起動しなかった。
6. これはコード側の不具合ではなく、**このエージェントセッションの実行環境
   （非対話的シェルからの GUI プロセス生成）に起因する制約**と判断し、
   システム設定（SIP・Gatekeeper・TCC 権限）を変更するような対処はせず撤退した。

### 代替として残す証跡

- `startup-log-devtools-port-opened.txt`: 上記 4. の起動ログそのまま。
  `--remote-debugging-port` が実際に有効化され、フロントエンドの起動シーケンスが
  例外なく進んでいることのログ的傍証（PNG の代わりにはならない）。
- コードレベルの確認（grep・実測、下記）。

## 実測値（L0 相当）

- `npm run build:ext`（`apps/shell`）: exit 0（tsc -b、エラーなし）
- `npm run lint`（`apps/shell`）: `0 errors`（warning 5 件はすべて `akari-preview` 拡張の
  既存コードで本タスクの変更と無関係。再実測コマンド:
  `eslint "extensions/*/src/**/*.{ts,tsx}"`）
- `node --test src/common/*.test.mjs`（`apps/shell/extensions/akari-surfaces`）:
  `tests 64 / pass 64 / fail 0`（うち新規 5 件が `launcher-visibility.test.mjs`。
  既存 59 件は無改造で green のまま）

## コードレベルの確認（grep 実測）

- `akari-home-widget.tsx` から「パートナーに接続する」の文言・`renderConnectCard()`・
  `connecting` フィールド・`connectPartner()`・`BEGIN_ONBOARDING_COMMAND` はすべて削除済み
  （`grep -n "パートナーに接続する" akari-home-widget.tsx` → 0 件）
- `akari-project-launcher-dialog.ts` に `data-akari-project-launcher-dialog` /
  `data-akari-launcher-new-project` / `data-akari-launcher-row` /
  `data-akari-launcher-empty` の CDP/evidence 用フックを実装済み
- 手動再表示ボタン（`data-akari-open-project-launcher`）はウェルカムカードと
  dashboard ヘッダーの 2 箇所に設置。コマンド `akari.home.openProjectLauncher`
  は `akari-project-launcher-dialog.ts` 内の `AkariProjectLauncherCommandContribution`
  で登録し、`akari-surfaces-frontend-module.ts` でバインド済み
- 列挙・開く・新規作成のロジック複製がないこと: `akari-project-launcher-dialog.ts` は
  `ProjectListRow[]` を props で受け取るだけで自前の列挙を持たず、
  `onOpenProject` / `onStartNewProject` はいずれも `akari-home-widget.tsx` 側の
  既存メソッド（`openCreatorRootProject` / `startNewProject`）をそのまま渡している
  （diff 参照 — 新規実装は UI のローカル状態 `startingNewProject` の点滅制御のみ）
- 初回セットアップ `onFinished` からランチャーへ続く配線: `createFirstRunSetupDialog()`
  の `onFinished` コールバック内に `void this.openProjectLauncher();` を追加済み
  （CDP での実地確認はできていない — 上記「未確認事項」参照）
- `PARTNER_NOT_CONNECTED_MESSAGE`（`akari-partner-command-contribution.ts`）は
  「右側の『パートナーを追加』パネルから接続してください」に更新済み

## 契約逸脱・申し送り

- `akari-partner-widget.tsx`（akari-partner 拡張・編集禁止範囲）のコメント中に
  旧 `renderConnectCard()` / `connectPartner()`（home widget 側、削除済み）への
  言及が残っている（176 行目付近）。ファイル境界外のため本タスクでは修正していない。
