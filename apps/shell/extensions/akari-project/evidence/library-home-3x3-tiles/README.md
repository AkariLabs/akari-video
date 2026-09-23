# ライブラリのホームを 3×3 の主要タイル + 畳んだ詳細にする — L1 証跡（task 2026-09-23-library-home-3x3-tiles）

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動（`scripts/launch.mjs` = library-textstyle-place の `l1-lib.mjs` の launch）。
  `AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は本票専用の一時ディレクトリ、CDP ポート 9467。起動の cwd はリポ直下
- fixture: `scripts/gen-fixture.mjs` の `spoken`（12 秒の映像 + 話した言葉 4 行・字幕トラック）に空の `A1` を足して git 管理。
  Cmd+Z の判定は captions.json / edit.json が fixture の git HEAD と byte 一致かどうか（`scripts/undo.mjs`）
- ホームの構成は `scripts/home.mjs`（`[data-akari-library-home]` 配下のセクション見出し・`data-akari-library-category` の DOM 順・soon / 件数・
  `[data-akari-library-primary-tiles]` 内のタイルの矩形から列 / 行を数える）。タイルのクリックは `scripts/tile.mjs`（実マウス）
- 詳細の開閉の記憶は `scripts/relaunch.mjs`（同じ user-data-dir のまま Electron を起動し直す）
- 右パネルを畳み、タイムラインを縦に広げてから採った（library-textstyle-place と同じ段取り）

## BEFORE（基点 `d8dd9858` のビルド）

| 観測 | 記録 | 結果 |
|---|---|---|
| ホームの構成 | `before-home.json` / `before-home.png` | 5 グループ = マイ（3・3 列タイル・すべて近日）/ 音・映像・画像（BGM 121・SFX 96・B-roll 2・画像 161・オーバーレイ 7・3D・アバター 6・パック 2）/ 文字・飾り（テキストスタイル 12・テキストアニメ 47・フォント 31・図形 近日・スタンプ 近日）/ 仕上げ（LUT 10・トランジション 29・エフェクト 近日・モーション 近日）/ 雛形（テンプレート 近日）。計 20 カテゴリ。テキストを置くタイルは無い |

## AFTER（最終ビルド）

| 観測 | 記録 | 結果 |
|---|---|---|
| ホーム（既定 = 詳細は畳む） | `after-home-collapsed.json` / `.png` | 最上段「よく使う」に 9 タイル・**3 列 × 3 行**（DOM 順 = text / shapes / stamps / image / broll / bgm / sfx / overlay / scene3d = テキスト / 図形 / スタンプ / 画像 / B-roll / BGM / SFX / オーバーレイ / 3D・アバター）。種別 make ×3・pick ×6。各タイル = アイコン + ラベル + 1 行の hint、枠は四辺とも 1px（左だけの線・影なし）。その下に「▸ 詳細（文字の見た目・仕上げ・パック・マイ）」（`aria-expanded=false`）、詳細の中身は描かれない |
| 詳細を開く | `after-home-details-open.json` / `.png` | 文字の見た目（テキストスタイル・テキストアニメ・フォント）/ 仕上げ（LUT・トランジション・エフェクト・モーション）/ まとめて（パック・テンプレート）/ マイ（お気に入り・ブランドキット・保存したプリセット）の 12 カテゴリ。3×3 に出したカテゴリとの重複 0（`duplicates: []`）。3×3 の 8 カテゴリ + 詳細 12 = BEFORE の 20 カテゴリと同じ集合 |
| テキストのタイル（プレイヘッド 5 秒） | `after-text-tile-5s.json` / `.png` / `after-text-tile-5s-preview.json` | `c-0005` 5〜8 秒・文言「テキストを入力」・`time_domain: "output"`・`style_preset` なし・位置 y 0.4625（中央）。チップは lane `t-placed-text-display`（「文字」行）。プレビューにプレート `caption-plate-c-0005`「テキストを入力」。edit.json 不変 |
| 同 Cmd+Z 1 回 | `after-text-tile-5s-undo.json` | captions.json / edit.json とも HEAD と byte 一致、`git status` 空 |
| 画像 / B-roll / BGM / SFX / オーバーレイ / 3D のタイル | `after-tile-<key>.json`（画像・BGM は `.png` も） | それぞれ今までどおりのカテゴリ一覧が開く（カード 161 / 2 / 121 / 96 / 7 / 6 枚）。captions.json / edit.json 不変 |
| 図形 / スタンプのタイル | `after-tile-shapes.json` / `after-tile-stamps.json` | `disabled`・hint「近日」。押してもホームのまま・captions.json / edit.json 不変 |
| 外部からカテゴリを開く | `after-external-open.json` | `akari.catalog.open` の category = textstyle / bgm / transition はそのページが開く（戻り値 true）。shapes（近日）/ text（作るもの専用タイル）/ 未知のキーはホームへ（false）。`akari.catalog.listCategories` は 20 カテゴリを従来の順・件数で返す |
| 詳細の開閉の記憶 | `after-details-memory-restart.json` | 開いたまま終了 → 起動し直すと開いている。畳んで終了 → 起動し直すと畳まれている |

### 回帰（最終ビルド）

| 経路 | 記録 | 結果 |
|---|---|---|
| BGM `bgm-jazzhop-piano-086` → A1 の 3 秒（D&D 1 回） | `regression-bgm-a1.json` / `.png` | ペイロード `kind: 'asset'`。`a1` に `audio-1` at 90・4631 フレーム、`bgm-jazzhop-piano-086.mp3` を取り込み（library-textstyle-place の回帰と同値）。Cmd+Z で byte 一致（`regression-bgm-a1-undo.json`） |
| テキストスタイル `emphasis-red` の ＋（プレイヘッド 5 秒・詳細から開いた一覧） | `regression-textstyle-plus-5s.json` | `c-0005` 5〜8 秒・`style_preset: "emphasis-red"`・「文字」行で選択中。Cmd+Z で byte 一致（`regression-textstyle-plus-5s-undo.json`） |

## 既知の挙動・申し送り

- テキストのタイルはドラッグできない（押して置くだけ）。タイムライン側の受け口（`akari-annotations` の `parseLibraryDragPayload`）が `kind: 'textstyle'` に空でない `id` を必須とし、落とすと `stylePreset: id` で置くため、プリセットなしのドラッグには受け口の変更が要る（本票の編集範囲外）
- パネル幅 260px 前後ではテキストのタイルの hint「押すとプレイヘッド位置に文字を置く」が 1 行に収まらず省略記号で切れる（全文は title に出る）

## スクリプト

`scripts/` — `home.mjs`（ホームの構成）/ `tile.mjs`（タイルのクリック）/ `relaunch.mjs`（記憶の確認用の再起動）は本票で追加。
それ以外（`launch.mjs` / `open.mjs` / `opencat.mjs` / `libdrag.mjs` / `tsplus.mjs` / `undo.mjs` / `plates.mjs` / `cdp-lib.mjs` / `l1-lib.mjs` / `l1-common.mjs` / `gen-fixture.mjs` ほか）は library-textstyle-place の写し。
