# reveal-in-finder（task 2026-08-09-reveal-in-finder）L1 検証手法・証跡

タスク: シェルから実物のフォルダへ出る導線が無い（取り込みは Finder からできるのに、
出ていく口が無い）非対称の解消。3 箇所（ホームのプロジェクトカード / 左パネル
「できたもの」各項目 / File メニューの現在のプロジェクトルート）に「Finder で表示」
（macOS）/「フォルダを開く」（他 OS・ラベルのみ分岐）を追加した。

## 実装の要旨

- Electron ネイティブ呼び出しは `akari-preview` 拡張の既存の流儀
  （`electron-main` / `electron-common` / `electron-browser/preload` の三点セット
  + `theiaExtensions` への `electronMain`/`preload` 登録）をそのまま踏襲し、
  `akari-project` 拡張に新設した（`shell.showItemInFolder` を呼ぶだけの薄い IPC）
- 対象の実在確認はフロントエンドの `FileService#exists` で先に行い（既存パターン踏襲）、
  無ければ `MessageService.error` で必ずエラーを出す（「黙って何も起きない」を禁止する
  受け入れ条件どおり）。electron-main 側は Node の `fs` を使わず `shell.showItemInFolder`
  を呼ぶだけに留めた
- 3 箇所の呼び出し口は 1 個の内部コマンド `akari.project.revealInFileManager`
  （URI 引数必須・ラベル無し = パレット非表示）に集約。`akari-project` 拡張の
  `akari-project-contribution.ts` が実装を持ち、他拡張（`akari-surfaces` のホーム）は
  ID 文字列のミラーで呼ぶ — 既存の `akari-partner` コマンドミラー流儀
  （`akari-project-contribution.ts` 冒頭コメント参照）をそのまま適用し、
  拡張間の npm 依存は増やしていない
- File メニュー（現在のプロジェクトルート）は別コマンド
  `akari.project.revealProjectRoot`（ラベル `プロジェクトフォルダを Finder で表示`）
  として `CommonMenus.FILE` に登録。ラベルがあるためコマンドパレットにも同じ項目が並ぶ
  （後述の検証で利用）

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。今回は実ディスプレイに
アクセスできる環境だったため、`screencapture` による実 Finder ウィンドウのスクリーン
ショットも試みた。

1. `PYTHON=/usr/bin/python3 npm install --no-workspaces` → `npm run build`
   （`build:ext` → `theia build --mode production`）でビルド（0 errors）
2. `templates/project-default/` を隔離ワークスペースへコピー（元ファイルは無改変）。
   `<AKARI_HOME>/creator-root.json` → `<root>/.akari/root.json`
   （`schema: "creator-root/v1"`）→ `<root>/channels/demo/videos/<project>/` という
   creator-root 一式を隔離ディレクトリ配下にゼロから作成し、ホームの「プロジェクト」
   一覧に実データが乗る状態を用意した。`exports/sample-cut.mp4`（ダミーバイト列）と
   `README.md` を置き、「できたもの」パネルにカードが並ぶようにした
3. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離ワークスペース絶対パス> --remote-debugging-port=9333
   --user-data-dir=<隔離dir> --no-sandbox` で直接起動。`AKARI_HOME`/`THEIA_CONFIG_DIR`
   を隔離ディレクトリに向けた
4. `playwright-core`（検証用スクラッチディレクトリにのみ `npm install`。本体には
   追加していない）で `chromium.connectOverCDP('http://127.0.0.1:9333')` にアタッチし、
   3 箇所のボタン（`data-akari-project-reveal` / `data-akari-output-reveal`）を実際に
   クリックするスクリプトを書いて実行
5. Finder が実際に開いた対象は `osascript` で Finder 自身のスクリプティング辞書
   （`target of window` / `selection`）を直接問い合わせて確認した（画面キャプチャより
   確実 — 後述「見つけた問題」参照）。あわせて `screencapture -R<x,y,w,h>`（Finder の
   ウィンドウ位置・サイズを `System Events` から取得してクロップ）で視覚証跡も取得した
6. 後片付け: 起動した Electron は実 PID を指定して kill。隔離ワークスペース・
   ユーザーデータディレクトリ・検証スクリプトは検証後に削除（コミットしていない）

## 検証したシナリオと実測

| # | シナリオ | 実測 |
|---|---|---|
| A | ホームのプロジェクトカード横の「Finder で表示」ボタンをクリック | Finder が新規ウィンドウで `.../root/channels/demo/videos/` を開き、`2026-08-09-demo-project` フォルダが選択状態（青ハイライト）。`target of window` = 期待値と完全一致 |
| B | 左パネル「できたもの」の書き出しカード（`sample-cut.mp4`）の「Finder で表示」ボタンをクリック | Finder が新規ウィンドウで `.../exports/` を開き、`sample-cut.mp4` が選択状態。`target of window` = 期待値と完全一致 |
| C | File メニュー相当のコマンド `akari.project.revealProjectRoot`（ラベル「プロジェクトフォルダを Finder で表示」）をコマンドパレット（F1）経由で実行 | Finder が `.../videos/` を開く（プロジェクトルート自身の親）。`target of window` = 期待値と完全一致。パレット上に登録どおりのラベルで表示されることも screenshot で確認済み |
| D | `sample-cut.mp4` を実ファイルシステムから削除した状態で同じ「Finder で表示」ボタンを再クリック | アプリ内エラートースト「見つかりませんでした: /private/tmp/reveal-in-finder-l1/root/channels/demo/videos/2026-08-09-demo-project/exports/sample-cut.mp4」が表示（「黙って何も起きない」の禁止を満たす） |

全シナリオの `target of window` 実測ログ:

```json
{
  "A": { "match": "/private/tmp/reveal-in-finder-l1/root/channels/demo/videos/" },
  "B": { "match": "/private/tmp/reveal-in-finder-l1/root/channels/demo/videos/2026-08-09-demo-project/exports/" },
  "C": { "match": "/private/tmp/reveal-in-finder-l1/root/channels/demo/videos/" },
  "D": { "errorShown": true }
}
```

## スクリーンショット

| ファイル | 内容 |
|---|---|
| `01-home-project-card-finder-selection.png` | A: Finder ウィンドウのみをクロップ。`videos` フォルダ内で `2026-08-09-demo-project` が選択状態 |
| `02-outputs-card-finder-selection.png` | B: Finder ウィンドウのみをクロップ。`exports` フォルダ内で `sample-cut.mp4` が選択状態 |
| `03-project-root-command-palette.png` | C: アプリ内コマンドパレットに「プロジェクトフォルダを Finder で表示」が表示され選択されている状態（Finder 側の開き先は上表の実測ログで確認） |
| `04-nonexistent-path-error-toast.png` | D: 存在しないパスに対するエラートースト |

## 見つけた問題（検証手法側。実装側の不具合ではない）

この macOS 環境はディスプレイが 1 枚だが、実行時に他のエージェントレーン
（別 worktree の Electron プロセスや、ユーザーの他セッションのウィンドウ）が
同時に動いていた。`screencapture -x`（全画面）や、`System Events` の
`frontmost` 判定を経由した全画面リージョンキャプチャは、キャプチャの一瞬前後で
別プロセスがフォーカスを奪うレースにより、**無関係な他ウィンドウの内容を
誤って撮影する**ことが複数回再現した（意図しない情報が写り込むため、該当画像は
確認直後に削除し、このリポジトリには一切含めていない）。この問題を検出した後は、
全画面キャプチャに頼らず (a) Finder 自身のスクリプティング辞書への直接問い合わせ
（`target of window` / `selection` — 上表の実測ログ）を一次証拠とし、
(b) 視覚証跡は Finder ウィンドウの位置・サイズで厳密にクロップしたキャプチャ、
または Electron アプリ自身の CDP `page.screenshot()`（他ウィンドウを一切含まない）
のみを採用する方針に切り替えた。A・B の視覚証跡はこの安全な方式で撮り直して
確認済み。

## 未確認事項

- **File メニュー（ネイティブメニューバー）そのもののクリックは未確認。**
  macOS ではネイティブの System メニューバーは Electron の `BrowserWindow` 外側
  （OS 側）にあり、`System Events` 経由でクリックする方式は同時に動いていた
  複数の `Electron` プロセス（他レーンの worktree）とプロセス名が衝突し、誤った
  ウィンドウを操作するリスクがあったため見送った。代わりに、同一コマンド
  （`akari.project.revealProjectRoot` — メニューに登録したものと同じ ID・同じ
  ラベル）をアプリ内コマンドパレット経由で実行して検証した（Theia の標準機能で
  ラベル付きコマンドは自動的にパレットにも並ぶため、メニュー登録の実体が
  正しく動くことの確認にはなるが、ネイティブメニューのクリックそのものの
  UI 動作は未確認）
- Windows/Linux での実機確認は未実施（v0 は macOS 実装。ラベル分岐点
  （`isOSX` 判定）のみ用意し、実体は Electron の `shell.showItemInFolder`
  に委ねている）
- 素材ドラッグ由来の検証（本タスクとは無関係）は対象外
