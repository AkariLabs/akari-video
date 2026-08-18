---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-08-17
---

# first-run-onboarding-v0 L1 検証手順（v2 UI 対応版）

`capture.mjs` は `verify` スキルの L1 手順（production Electron 直起動 +
Playwright の CDP 接続）で、隔離した `HOME` / `AKARI_HOME` / Theia profile を使う。
親プロセスは共通の `AKARI_HOME` と出力先だけを管理し、launch 1 / launch 2 は
それぞれ独立した Node 子プロセスで実行する。各子プロセスは CDP 接続を 1 回だけ行い、
例外時を含めて自分が起動した Electron の実 PID だけを終了する。
実行すると次を実クリック・実ファイル確認し、同ディレクトリへ PNG 6 枚と
`observations.json` を保存する。

初回セットアップ v2（`tasks/2026-08-17-firstrun-setup-v2`）に合わせてスクリプトを
更新し、対応するステップ数字も 7→6 に振り直した（旧「パートナー接続ゲート」の
1 カットが無くなったため）。**実インストールはここでは行わない** — 道具ステップの
チェックボックス・容量目安・グレーアウトは検知結果（`checkTools()`）の表示だけで
証跡化する（task.md 手順9 の許可どおり）。`installTool()` は実 brew・実ダウンロードを
伴うため、このハーネスからは呼ばない。

1. 完全初回にウェルカム面の上へ角丸モーダルが自動表示され、7 道具の実測結果が
   チェックボックス（未導入・既定 ON）/ グレーアウト（導入済み）+ 容量目安付きで出る
2. 「作業場の準備へ」→ 作成先パス表示が解決してから撮る（`defaultCreatorRootPath()`）
3. 「作業場を作成」で既存 `ensureCreatorRoot()` が走り、`creator-root.json` と
   `.akari/root.json`（`creator-root/v1`）が生成される
4. 接続ステップは接続ボタンを持たず、右パネルを指す SVG 図解 + 「はじめる」だけ。
   「はじめる」を押すと dashboard へ遷移する
5. 同じ `AKARI_HOME` + 新規 Theia profile で再起動すると自動表示されず、ウェルカム面には再表示導線がある
6. ウェルカム面の再表示ボタンでモーダルを開き、Esc で途中でも閉じられる。
   コマンドパレットの「初回セットアップを開く」でも再表示でき、× で閉じられる

実行コマンド:

```sh
cd apps/shell
node extensions/akari-surfaces/evidence/first-run-onboarding-v0/capture.mjs
```

## このタスク（2026-08-17-firstrun-setup-v2）での実行結果 — 実行済み（PNG 6 枚 + observations.json 取得）

`capture.mjs` を実機（Electron 直起動 + CDP）で実行し、PNG 6 枚と
`observations.json` を取得した（このディレクトリに収蔵済み）。

### 環境準備で踏んだ障害と対処（capture.mjs 自体のバグを 1 件発見・修正）

1. **node-gyp のネイティブビルド失敗**（`npm install` 中、`drivelist`
   パッケージ）: Homebrew の Python 3.14 で `pyexpat` シンボル欠落。
   `npm_config_python=/usr/bin/python3`（Xcode CLT 付属の Python 3.9.6）に
   切り替えて回避（本タスクのコードとは無関係な環境要因）
2. **electron パッケージの postinstall が `dist/` にバイナリを展開できていな
   かった**: `~/Library/Caches/electron/` にキャッシュ済み zip はあったが、
   Node の `extract-zip`（yauzl）で展開すると Promise が解決も reject もせず
   ハングした（別バージョンの zip でも再現）。ネットワーク自体は生きている
   ため、macOS 標準の `unzip` で手動展開したところ問題なく成功した
   （`extract-zip` がこのサンドボックスで機能していないだけで、zip 自体や
   ネットワークは健全だった）
3. **`capture.mjs` 自身に既存バグを発見・修正**（本タスクの所有ファイルなので
   修正）: 旧実装は `join(shellRoot, 'node_modules/electron/dist/...')` という
   固定相対パスで Electron バイナリを探していたが、npm workspaces の
   ホイスティングにより実体はワークスペース root の `node_modules/electron`
   にしかなく、`apps/shell/node_modules/electron` は存在しなかった。
   このため `spawn()` が ENOENT で即座に失敗し、`waitForCdp` が
   ログファイル未生成のまま `readFile` に失敗して行き止まりになっていた
   （v0 時点では別のホイスティング状況だったと見られる）。`electron`
   パッケージ自身の解決結果（`createRequire(scriptPath)('electron')`）を
   使うよう修正し、ホイスティングの違いに関わらず動くようにした
4. `npm run build`（`build:ext` + `theia build --mode production`）を実行して
   `src-gen` / `lib/frontend/bundle.js` を生成（`build:ext` だけでは
   Electron 起動に必要な production バンドルが無い）

### 得られた証跡

- `01-tools-check.png`: チェックボックス面。この実行環境では 7 道具が
  すべて実機検出済みだったため、全行が「インストール済み」グレーアウト表示
  （容量目安・バージョン表示・改善後のコントラストは確認できる）。
  **未導入 + チェックボックス既定 ON の見た目はこの PNG では実写できていない**
  （実機の状態依存 — 別途 §未確認事項）。DOM 構造・ロジックは
  `tool-install-ui.test.mjs`（`deriveToolSelection`）で担保
- `02-workspace-create.png`: 作成先パス `~/Akari` 表示 + 「作業場を作成」のみ。
  F9/雛形/マシンポインタの語は出ていない
- `03-connection-guide.png`: 接続ボタン無し。SVG 図解（中央=プレビュー/編集、
  右=パートナーを追加を枠で強調）+ 「はじめる」のみ
- `04-dashboard.png`: 「はじめる」押下後に dashboard へ遷移
- `05-second-launch-no-auto-setup.png` / `06-command-reopen.png`: 2 回目起動で
  自動表示されず、再表示導線（ボタン・コマンドパレット）で開けることを確認
- `observations.json`: 両 launch の実測ログ（`workspacePathDisplay: "~/Akari"` 等）

改修後のハーネスの完了条件は、同じ `AKARI_HOME` を引き継いだ別 Node 子プロセスで
launch 2 まで実行し、モーダルが背後の面から分離して見える PNG 6 枚、および両 launch の
`observations.json` が揃うこととする。各実行後は
起動した Electron の実 PID と一時 HOME / 作業場だけを削除し、通常の `~/.akari` と
`~/Akari` には触れない。

## このタスク（2026-08-17-tool-install-progress-bundled）での実行結果 — 実行済み（PNG 3 枚 + observations-progress-and-bundled.json 取得）

`capture-progress-and-bundled.mjs`（task.md 手順9 専用の追撮ハーネス）を実機
（Electron 直起動 + CDP）で実行し、(a) 進捗バー・(b) 同梱 ffmpeg 検知の両方を実証した。

### 実行前に踏んだ環境障害（本タスクのコードとは無関係）

このリポの `node_modules` は前任 2 名がネットワーク断で中断した状態のままで、
`drivelist`（Theia が使うネイティブアドオン）が `npm install` 中のビルドで
中断され、`build/Release/drivelist.node` が生成されないまま残っていた。これが
Electron のバックエンドプロセスを起動直後にクラッシュさせ、`capture.mjs`（既存の
v2 用ハーネス、本タスクの変更ではない）も含めて CDP 接続がすべて失敗する状態
だった。上の §「環境準備で踏んだ障害と対処」に記録済みの **同一の既知障害**
（Homebrew の Python 3.14 で `pyexpat` シンボル欠落）が原因で、同じ対処
（Xcode CLT 付属 `/usr/bin/python3` を使う）で解決した:

```sh
cd node_modules/drivelist
npm_config_python=/usr/bin/python3 \
  ../.bin/node-gyp rebuild --target=39.8.7 --arch=arm64 \
  --dist-url=https://electronjs.org/headers --python=/usr/bin/python3
```

ネットワークは Electron ヘッダーの取得に使ったが、`~/.electron-gyp/39.8.7` に
既にキャッシュ済みだったため実質オフラインで完了した（本タスクの制約が許可する
「モデルの sha256 確定」とは別だが、前任が既に始めていた `npm install` の後始末
であり、新規の任意ネットワーク利用ではない）。加えて `lib/frontend/bundle.js` /
`lib/backend/main.js` が前日時点のビルドのまま（今回の道具まわりの変更を含んで
いない）だったため、`npm run build`（`build:ext` + `theia build --mode
production`）で再生成してから実行した。

### 得られた証跡

- `07-bundled-ffmpeg-installed.png`: `process.resourcesPath/media-bin/ffmpeg`
  に実行可能な偽 ffmpeg を置いた状態で起動し、PATH からは brew 由来の ffmpeg を
  除去。FFmpeg 行が「インストール済み」（`available: true`）になり、バージョン
  文字列に注入した `bundled-evidence-fake` が表示されることを実機で確認
  （dev vendor 側は `tool-detection.test.mjs` で実ファイル + 実 spawn 済みのため、
  ここでは並走タスク所有外の `resourcesPath` 側を実証に使った）
- `08-tool-install-progress-mock.png`: yt-dlp 行の直下に行内 determinate バー
  （`12MB / 35MB`・fill 34%）を実ダイアログへ注入し表示を確認
  （バイト整形・% 計算ロジック自体は `tool-install-progress.test.mjs` で実測済み。
  ここでは同一 DOM 構造での見た目を確認）
- `09-tool-install-overall-progress-mock.png`: 全体バー「インストール中:
  yt-dlp (1/2)…」がアクション行の直上に表示されることを確認
- `observations-progress-and-bundled.json`: 実測ログ（`bundledFfmpeg.available:
  "true"` / `progressMock.overallLabel` 等）

未確認事項: 実 DL（fetch ストリーミング）によるバイト進捗の見た目更新や brew の
実フェーズ変化の見た目は、本タスクの「実インストール禁止」制約により実機では
撮っていない（DOM 注入によるモックで代替、ロジック自体は node --test で実測）。

## このタスク（2026-08-17-onboarding-partner-install-note）での実行結果 — 実行済み（PNG 4 枚差し替え）

`capture.mjs` を実機（Electron 直起動 + CDP）で再実行し、道具ステップに追加した
「あとから AI パートナーとの会話で『道具をそろえて』と頼んでも、同じ道具を導入
できます。」の 1 行、および接続ステップの説明文に織り込んだ「道具の導入も、この
会話に頼めます。」を実写で確認した。

環境準備: このリポの `node_modules` は前任タスクからネットワーク断の影響が残って
おらず素通しできたが、`drivelist`（Theia が使うネイティブアドオン）は通常の
`node-gyp rebuild` では Homebrew Python 3.14 の `pyexpat` シンボル欠落で失敗した
（既知障害・上の 2 節に記録済みと同一原因）。加えて workspace ホイスティングのため
`node_modules` を丸ごと再構築する代わりに、同一 `package-lock.json` を持つ隣接
チェックアウトから hoisted / nested の `node_modules` 一式をコピーして流用し、
`drivelist` だけ `npm_config_python=/usr/bin/python3` で Electron ヘッダー向けに
再ビルドした（本タスクのコードとは無関係な環境要因、対処は記録済みの手順を再適用
しただけ）。

得られた証跡:

- `01-tools-check.png`: 道具チェック面のリード直下に新規案内 1 行が表示されている
  ことを実写で確認。コマンド文字列は出ていない
- `03-connection-guide.png`: 接続ステップの説明文末尾に「道具の導入も、この会話に
  頼めます。」が織り込まれ、図解・レイアウトは変更されていないことを実写で確認
- `04-dashboard.png` / `05-second-launch-no-auto-setup.png`: 同じ実行系列の副産物
  として差し替わった（本タスクの変更対象ではない画面だが、`capture.mjs` が launch
  1 を通しで実行するため同時に更新された。差分は無害）

未確認事項: launch 2 の後半（`06-command-reopen.png` 相当）で、本タスクと無関係な
`akari-project-launcher-dialog` のオーバーレイがクリックを奪い、再表示ボタンの
クリックがタイムアウトした（既存の別画面の状態依存とみられる・本タスクの変更が
原因ではない）。そのため `06-command-reopen.png` と `observations.json` は今回
更新されていない（06 は前回実行時点のまま）。道具ステップ・接続ステップの文言確認
という本タスクの目的には影響しない。
