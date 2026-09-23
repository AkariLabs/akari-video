# マイスタイル v0（スタイルの入れ物 + 字幕の見た目の保存と当てる）— 実機 L1 の証跡

タスク: `task/2026-09-24-mystyle-look-v0`。契約文書: `docs/contract-2026-09-24-style-v0.md`（Japanese）。

実機: 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動。専用の CDP ポート 9485・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`・一時 workspace（名前に `mystyle-look-v0` を含む）。
**起動の cwd はリポ直下**（テキストスタイルの索引の探索が cwd 基準）。ウィンドウ 1440×900・右パネル幅 360。
操作はすべて CDP の実マウス・実キーボード（文字入力は `Input.insertText`、ドラッグは `Input.setInterceptDrags` で本物の DragData を横取りして `Input.dispatchDragEvent` で運ぶ）。

## ファイル

| ファイル | 内容 |
|---|---|
| `scripts/gen-fixture.mjs` | fixture（話した言葉 5 行・15 秒・空の A1）。c-0001 = 色・縁取り・座布団・影・位置を変えた保存元 / c-0002 = 位置（`bl` / `{x:0.1,y:0.9}`）だけ持つ / c-0005 = `style_preset: subtitle-variety` だけ持つ。映像は ffmpeg（L1 専用） |
| `scripts/before.mjs` | 手順 0（BEFORE）の記録（判定なし）。基点 `af19dd23` のビルドで実行 |
| `scripts/after.mjs` | AFTER の受け入れ条件（16 項目の判定つき・起動し直しを含む）。最終ビルドで 1 回通しで実行 |
| `scripts/library-home.mjs` | 隔離した `AKARI_HOME` に `library-location.json`（`state: done`・`root` = 一時の作業場の `library/`）を置く = 「作業場の library/」を既定の解決規則に乗せる |
| `scripts/view.mjs` / `scripts/previewsave.mjs` / `scripts/msdrag.mjs` / `scripts/type.mjs` / `scripts/winsize.mjs` | 出力プレビュー（webview の入れ子 iframe）への到達・座標換算、ミニパネルからの保存、マイスタイルのドラッグ、文字入力（調査用の小道具） |
| `scripts/cdp-lib.mjs` / `l1-lib.mjs` / `common.mjs` / `l1-common.mjs` ほか | 既存の L1 証跡（library-textstyle-place）の写し。`l1-lib.mjs` の `launch` に起動前の `prepare` を追記、既定ポートを 9485 に |
| `results-before.json` / `results-after.json` | 実測値 |
| `before-*.png` / `after-*.png` | スクリーンショット |

## BEFORE（基点 `af19dd23` のビルド）— 手順 0

| 観測 | 記録 | 結果 |
|---|---|---|
| ライブラリの置き場 | `results-before.json` `libraryRoots` | 既定の解決規則は `AKARI_LIBRARY_ROOT` → `$AKARI_HOME/library-location.json` の `root`（state `migrating` / `done`）→ `previousRoot` → `$AKARI_HOME/assets`。作業場を持たない隔離環境では書き込み root = `<iso>/akari-home/assets`。作業場があるとき（`library-location.json` の `root` = 作業場の `library/`）はそこ（AFTER はこの形で実測） |
| インスペクターの字幕の見出し帯 | `before-01-inspector-header.png` | 色見本 + 文言 + 時刻の 2 列（高さ 60px）。**ボタン 0 個**（⋯ なし） |
| プレビューのミニパネル | `before-03-preview-mini-panel.png` | 8 個（全字幕モード・吸着・はみ出し防止・太字・色・座布団・既定に戻す・インスペクターを開く） |
| ライブラリのテキストスタイルの棚 | `before-04-library-home.png` / `before-04b-library-details.png` / `before-05-library-textstyle-shelf.png` | ホーム →「詳細」を開く →「テキストスタイル」で同梱 12 枚。「マイスタイル」は無い（詳細の「保存したプリセット」は「近日」） |

## AFTER（最終ビルド・16/16 pass）

| 受け入れ条件 | 記録 | 実測 |
|---|---|---|
| 見出し帯の ⋯ | `after-01-inspector-header.png` | 見出しの右端（右端との差 10px）・高さ **60px のまま**・`title` なしで即時の説明「字幕のその他の操作」（80ms）・絵文字なし |
| ⋯ →「マイスタイルに保存…」→ ダイアログ | `after-02-inspector-menu.png` / `after-03-save-dialog.png` | 名前・使いどころ・部品（見た目 = 有効 / 動き・効果音・画面効果・装飾 = 「近日」で無効） |
| 保存（c-0001） | `results-after.json` | `styles/<id>/style.json`: `schema akari-style/v0`・`license private`・`version 1`・`parts = [look]`。見た目 = `color #FFD400`・`size_px 52`・`font_weight 900`・`stroke #D12B2B/5`・`background #1E3A8A/0.85/12/block`・`shadow`。**位置のキー（text_anchor / position / zone）なし・絶対パスなし** |
| 保存（`style_preset` だけの c-0005） | 同上 | 見た目にプリセット `subtitle-variety` の値（`#fff200`・80・縁取り `#1a1a1a`/9）が入る = 実効の見た目 |
| 棚 | `after-04-library-shelf.png` | テキストスタイルの棚の先頭に「マイスタイル」の節（同梱 12 枚はそのまま下に並ぶ）。カード 191×155.5px・札「マイスタイル」・チップ「見た目」・名前・使いどころ・操作 4 つ（当てる / ＋ / 名前の変更 / 削除）が **1 行**。見本は保存した見た目（縁取り・座布団・影は見本の大きさに縮めて描く） |
| 3 本に当てる（c-0002〜c-0004） | `after-05-applied-preview.png` | 3 本とも見た目 6 項目が保存元と一致。c-0002 の位置（`bl` / `{x:0.1,y:0.9}`）はそのまま、c-0003 / c-0004 は位置のキーを持たないまま。選んでいない c-0001 / c-0005 は不変 |
| 出力プレビュー | 同上 | 3 本の字幕の computed style（文字色 `rgb(255,212,0)`・52px・900・縁取り `rgb(209,43,43)`・影・座布団 `rgba(30,58,138,0.85)`・角丸 12px）が c-0001 と一致 |
| undo | `results-after.json` | Cmd+Z **1 回**で captions.json が fixture と byte 一致・`git status` 空 |
| ＋ | `after-06-plus-placed.png` | プレイヘッド 5 秒で ＋ → 置いた文字 `c-0006`（5〜8 秒・`time_domain: output`）に見た目。Cmd+Z **1 回**で byte 一致 |
| ドラッグ | `results-after.json` | カードをタイムラインの 10 秒へ（ペイロード `kind: mystyle`）→ `c-0006` 10.0〜13.0 秒に見た目。Cmd+Z **1 回**で byte 一致 |
| 名前の変更 | 同上 | ダイアログ「変更 / キャンセル」→ `name` が「強調テロップ（黄）」・`updated_at` 更新・カードにも反映 |
| 起動し直し | `after-07-shelf-after-restart.png` | 保存した 2 件 + 手で足した `hand-motion` の 3 件が棚に残る。起動で style.json は書き換わらない（byte 一致） |
| `motion` 入りを当てる | `after-08-motion-notice.png` | `parts` に `{"kind":"motion","animation":{…}}` を足した style.json を c-0002 に当てる → 見た目（`#00E5FF`・縁取り `#002233`/4）だけ書かれ、`animation` は書かない・位置は不変。通知 1 行「動き は v0 では当てません。見た目を当てました。」。カードのチップは「見た目」「動き（当てない）」。Cmd+Z 1 回で byte 一致 |
| ミニパネルからの保存 | `after-09-mini-panel-tooltip.png` | プレビューで c-0003 を実クリック → 「マイスタイルに保存」（SVG アイコン・即時の説明 1ms・絵文字なし）→ ダイアログの既定名 = c-0003 の文言（タイムラインで c-0001 を選んでいても、プレビューで選んだ字幕になる）。Escape で閉じる |
| 削除 | `after-10-delete-confirm.png` | 確認「キャンセル / 削除」→ `styles/hand-motion/` ごと消え、カードも消える |
| 絶対パス | `results-after.json` | 保存された style.json 全件に絶対パス・位置のキーなし |

## 調べた経緯（判定側の修正）

- 1 回目の通しで「出力プレビューで 3 本が同じ」が 1 本だけ不一致: 書き込み直後で、プレビューの再読込前の値を測っていた（captions.json は正しく、スクリーンショットでも当たっていた）。
  判定を「c-0001 と一致するまで最大 15 秒待つ・待った時間を記録」に変更（最終の待ち時間は最大 205ms）
- 2 回目でドラッグが置かれない: 起動直後の通知（プロジェクトとして使うかの確認・置き場の移動のお知らせ）がタイムラインの上に重なり、落とす点の要素が通知だった（同梱のテキストスタイルのドラッグも同じ状態では置けないことを確認）。
  判定の前に通知を閉じ（確認は「開くだけ」）、タイムラインを広げて上端にスクロールしてから落とすよう変更

## 実装の往復で直したもの（codex の初回 → ラッパーの実機確認で差し戻し）

- 初回: ⋯ が見出しのグリッドの 3 つ目の子として次の行に落ち、見出しが 60 → 93.5px に伸びた / 棚のカードが幅約 60px の 3 列に入り、操作が縦積み・「当てる」が 1 文字ずつ折り返した / ＋ が undo 2 回 / 通知が汎用文 / 名前の変更・削除のダイアログが英語（OK / Cancel）
- 2 回目: 見本が縁取りの太さを実寸のまま小さな文字に使い、太い縁取りの見た目（subtitle-variety 由来）が読めなかった → 3 回目で見本の大きさに比例して縮め、縁取りを塗りの下に描くよう修正
