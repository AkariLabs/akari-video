# overlay-html-slots — スロット付き HTML テンプレートの L1 実測

task/2026-08-22-overlay-html-slots の検証記録（L1。実機 Electron + CDP・実 DOM 読み出し）。
1 本の HTML テンプレート（`data-akari-slot`）を 3 インスタンスが共有し、文字だけを
edit.json の `source.params` で持てることを実機で確認した。

## フィクスチャ

リポ同梱の `dev-fixtures/overlay-html-slots/`（スロット付きテンプレ 1 本
`overlays/chapter-tag.html` + それを共有する 3 アイテム slot-a/b/c）を
一時ワークスペースへ複製して使用。`<ws>` = 複製先プロジェクトroot。

## 実行手順

```sh
# apps/shell を build 済みの状態で、隔離 udd + CDP つきで起動
THEIA_CONFIG_DIR=<udd> node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  <apps/shell 絶対パス> <ws> --remote-debugging-port=<port> --user-data-dir=<udd> --no-sandbox \
  --disable-features=MacWebContentsOcclusion
# （ディスプレイスリープ対策に caffeinate -d -i -m -s -u を併走。writeback-v2 の README と同じ地雷）
node scripts/run-slots-l1.mjs <port> <ws> <outDir>
```

## 実測（l1-log.json が生ログ。パスは `<ws>` / `<out>` にサニタイズ済み）

| Phase | 内容 | 実測 |
|---|---|---|
| A | 同一テンプレ参照の 3 インスタンスがそれぞれ別の文字で表示 | slot-a `第1章 問題の本質` / slot-b `第2章 解決への道` / slot-c `<b>第3章 安全な文字列</b>`（**textContent のまま。`hasBoldChild:false`・`childElementCount:0` = タグとして解釈されない**）。既定文言「既定タイトル」は可視 DOM に出ない（webview ペイロードの display:none `<script>` 内にのみ存在） |
| B | テンプレ 1 箇所編集（`--font-size` 既定 38px → 61px）で 3 個全部が変わる | 3 個とも computed font-size `61px`、文字は params のまま。断片ファイル単体のライブ watch は無く、edit.json の外部 content 変更（または再読み込み）でモデル再読込されて反映（`live:false` + nudge） |
| C | slot-a をダブルクリック編集 → params だけが変わる | `contenteditable="true"` になり Enter で確定。edit.json は **slot-a の `source.params.title` のみ変化**（両版から該当 params を除去した残り全体が完全一致 = `onlySlotAParamsChanged:true`）。**テンプレ SHA-256 不変**。slot-b / slot-c の実 DOM 文字不変 |
| D | 書き出しパリティ | 同 fixture を render-cut（edit-lint pass → 実書き出し 1280x720/30fps/3s）し、t=1s のフレーム `render-frame-t1.png` に 3 個が params どおりの文字で焼けている（`<b>` もリテラルのまま）。プレビュー（l1-a）と同一の見た目 |

## ファイル

- `l1-a-three-instances.png` — プレビューで 3 インスタンスが別文字
- `l1-b-template-change.png` — テンプレ 1 箇所編集で 3 個全部 61px
- `l1-c-after-doubleclick-edit.png` — slot-a のみ「編集で差し替えた第1章」へ、他 2 個は不変
- `render-frame-t1.png` — 書き出し MP4 の t=1s フレーム（パリティ）
- `l1-log.json` — 全 Phase の実測ログ（A/B/C verdict すべて ok:true）
- `scripts/run-slots-l1.mjs` — CDP ドライバ（cdp-lib は preview-writeback-v2 のものを import）

## 既知の運用ノート

- Phase B の反映は「テンプレ保存だけでは自動反映されない」（断片ファイルの watcher は無い）。
  edit.json 側の content 変更 or ウィンドウ再読み込みで反映される。followup 候補として report に記載
- webview は外部ファイル変更でコンテキストが作り直されるため、ドライバは eval 失敗時に
  再接続する（`evSafe`）
