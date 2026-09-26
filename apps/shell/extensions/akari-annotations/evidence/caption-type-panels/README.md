# 文字のフォント・スタイルの専用パネル + ライブラリのテキストスタイルのカード — 実機 L1 の証跡

タスク: `task/2026-09-27-caption-type-panels`。

実機: 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動。専用の CDP ポート 9631・一時ディレクトリの
`--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`・一時 workspace（名前に `caption-type-panels` を含む）。
**起動の cwd はリポ直下**（テキストスタイルの索引の探索が cwd 基準）。ウィンドウ 1440×900（`window.resizeTo`。Electron は CDP の
`Browser.setWindowBounds` を持たない）・devicePixelRatio 2 で撮って 1440 幅へ縮小。操作は CDP の実マウス・実キーボード。

## ファイル

| ファイル | 内容 |
|---|---|
| `scripts/gen-fixture.mjs` | fixture（話した言葉 5 行・15 秒。c-0001 だけ色・縁取り・座布団・影を変えてある）+ ライブラリにマイスタイル 1 件（akari-project の `createMyStyle` で作る）。映像は ffmpeg（L1 専用） |
| `scripts/before.mjs` | 手順 0（BEFORE）の記録（判定なし）。基点 `08c006c86` のビルドで実行 |
| `scripts/after.mjs` | AFTER の受け入れ条件（15 項目・判定つき）。最終ビルドで 1 回通しで実行（132 秒） |
| `scripts/common.mjs` / `winsize.mjs` | 起動・ウィンドウの大きさ・プロジェクトを開く・ライブラリの棚を開く（`akari.catalog.open {category:'textstyle'}`）・カードの見本の computed style |
| `scripts/cdp-lib.mjs` / `l1-lib.mjs` / `l1-common.mjs` / `view.mjs` / `library-home.mjs` | 既存の L1 証跡（mystyle-look-v0）の写し。既定ポートを 9631 に、起動 env から `ELECTRON_RUN_AS_NODE` を外す |
| `scripts/launch.mjs` / `ev.mjs` | 調査用の小道具（起動したままにする・式を評価 / 撮影） |
| `results-before.json` / `results-after.json` | 実測値 |
| `before-*.png` / `after-*.png` | スクリーンショット |

## BEFORE（基点 `08c006c86`）— 手順 0

| 観測 | 記録 | 結果 |
|---|---|---|
| インスペクターの「文字」欄 | `before-01-inspector-text-section.png` | 色・大きさ・折り返し幅・太さ（普通 / 太字 / 極太）・行間・字間。**書体を選ぶ欄は無い** |
| 上のメニューのフォントの窓 | `before-02-font-window.png` | 書体名の文字ボタン 9 個（`AKARI Noto Sans JP` + 同梱 8）。**どのボタンも computed `font-family` は `-apple-system, system-ui, sans-serif`**（その書体で描かれていない） |
| 上のメニューのスタイルの窓 | `before-03-style-window.png` | 見本なしの名前ボタン 6 個（`CAPTION_PRESETS`）。色は全部 `rgb(204,204,204)`・背景透明 |
| Theia 側 document の書体 | `results-before.json` `theiaDocumentFonts` | `document.fonts` は 8 面（codicon / FontAwesome 等のアイコン書体だけ）。**字幕の書体は 1 つも `@font-face` 登録されていない**（`document.fonts.check` は未宣言の書体に true を返すので判定に使えない） |
| ライブラリのテキストスタイルのカード | `before-04-library-textstyle-cards.png` / `libraryCards` | 同梱 12 枚は **`sampleText` を `rgb(229,229,229)`・太さ 800・縁 0・影なし・背景 `rgb(10,10,10)` で描くだけ**（スタイルの色が出ない原因）。マイスタイルのカードだけは保存した見た目（黄色・紫の縁・影・緑の座布団）が出ていた |

## AFTER（最終ビルド）— 15/15 pass

| 受け入れ条件 | 記録 | 実測 |
|---|---|---|
| 字幕が選ばれていないときの toggle | `results-after.json` | `false`・通知なし・パネルは開かない |
| (c) `akari.captionPanel.toggle {panel:'font'}` | `after-c1-font-panel.png` | 通知 `[{panel:'font'}]`。一覧 9 件（同梱 8 + 既定の Noto Sans JP = `CAPTION_FONT_FAMILY`）の **9 件すべてが Theia document で `status: loaded` の書体で描かれている** |
| (c) 同じ toggle をもう一度 | `after-c2-back-to-inspector.png` | 通知 `[{panel:null}]`・欄の並び（時間 / 内容 / 文字 / 縁取り / 座布団 / 効果 / 位置 / タイミング）が開く前と一致 |
| 切り替え・close | `results-after.json` | font → style → font → `akari.captionPanel.close` で通知 `[font, style, font, null]` |
| (d) フィルター | `after-d1-filter-open.png` / `after-d2-filter-chips-selected.png` | ボタンは検索欄の右。チップ 7 個（日本語・手書き・明朝・ゴシック・丸・見出し・ドット = 実データにあるタグだけ）・1 行・`overflow-x: auto`・角 3px・「すべて」無し。**AND**: なし 9 → ゴシック 6 → ゴシック + 丸 2。ボタンに「2」。外すと 9 に戻る |
| (e) 太さ | `after-e-font-weights.png` | M PLUS Rounded 1c で 500 / 800 / 900 を展開、各行の computed `font-weight` が一致。太さ 1 つの Dela Gothic One はシェブロン無し（disabled・空） |
| (f-1) ホバー | `after-f1-hover.png` | captions.json 不変（byte 一致）。通知 `akari-caption-panel-preview {captionId:'c-0001', textStyle:{fontFamily:'Dela Gothic One'}}`。**プレビューの字幕は変わらない**（`previewPlateChanged: false`。下の「契約逸脱」） |
| (f-2) Esc | `after-f2-escape.png` | 通知 `textStyle:null`・書き込みなし・パネルと選択はそのまま（フォーカスがタイムライン側にあっても Esc を横取りする） |
| (f-3) クリックで確定 | `after-f3-click-commit.png` | captions.json の c-0001 で変わったキーは **`font_family` だけ**（`Dela Gothic One`）・他の字幕は不変。プレビューの字幕の computed `font-family` が `Dela Gothic One` に |
| (f-4) undo | `after-f4-undo.png` | Cmd+Z **1 回**で captions.json が fixture と byte 一致・`git status` 空 |
| キーボード | `results-after.json` | BIZ UDGothic にフォーカス（仮の通知）→ ↓ で Dela Gothic One へ（仮の通知）→ Enter で確定（書き込み 1 回）→ Cmd+Z 1 回で byte 一致 |
| (g) スタイルパネル | `after-g-style-panel.png` | 段 = 最近使ったスタイル / マイスタイル / テキストスタイル・「＋ 今のスタイルをマイスタイルに保存」。カード 13 枚（マイスタイル 1 + 同梱 12）すべて「Abc あいう 漢字」・**見た目が 13 通り**（文字色 10 通り・座布団 2・縁取り 13・影 13） |
| (g) カードをクリック | `after-g2-style-applied.png` | 書き込み 1 回（ニュース風の見た目）→ Cmd+Z 1 回で byte 一致 |
| 選択の変化 | `after-selection-cleared-closed.png` | 別の字幕（c-0002）へ → パネルを保つ・通知なし / タイムラインで Esc（選択を外す）→ 閉じる・通知 `[{panel:null}]` |
| (h) ライブラリ | `after-h-library-textstyle-cards.png` | テキストスタイル 12 + マイスタイル 1 の 13 枚すべて「Abc あいう 漢字」・**見た目が 13 通り**（座布団 2・縁取り 9・影 8） |

## 判定側の注記

- (f-3) の所要 22 秒は判定スクリプトの待ち（webview の実行コンテキストを指定しない評価で 20 秒待ってから正しいコンテキストで読み直した）。
  字幕の書体は読み直しの時点で `Dela Gothic One` になっていた
- 映像のクリップをクリックして「字幕以外を選ぶ」操作はこの配置ではクリップが選ばれなかったため、「選択を外す」はタイムラインでの Esc で確かめた
  （字幕以外の選択で閉じる判定は単体テスト `caption-panels.test.mjs` 側）

## 契約逸脱

- ホバー・キーボードのフォーカスで **プレビューの字幕を仮に変える** ところまでは届いていない。既存のホスト → webview の経路は
  数値 4 項目（大きさ・行間・字間・縁の太さ）の `akari-preview-caption-style-live` と、数値だけの `akari-preview-live-transform`、
  ファイルから読み直す `akari-preview-captions-update` だけで、書体・色・スタイル全体を書き込まずに当てる受け口が無い。
  受け口は編集禁止の `akari-preview-open-handler.ts` / `preview-context-bar-page.ts` 側に要る。
  本票はパネル側の状態遷移（仮 → Esc / 離脱で解く → クリック / Enter で確定）と通知 `akari-caption-panel-preview`
  （`{ captionId, textStyle | null }`）までを実装した
