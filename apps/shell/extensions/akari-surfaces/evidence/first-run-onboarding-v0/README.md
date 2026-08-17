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
