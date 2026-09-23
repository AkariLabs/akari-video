# ライブラリのテキストスタイルをドラッグ / ＋ で「置いた文字」として配置する — L1 証跡（task 2026-09-23-library-textstyle-place）

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動（`scripts/launch.mjs` = `place-text-button` 系の `l1-lib.mjs` の launch）。
  `AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は本票専用の一時ディレクトリ、CDP ポート 9465。ウィンドウ 1120×668（CSS px）。
  **起動の cwd はリポ直下**（テキストスタイルの索引 `presets/textstyle/index.jsonl` の探索が cwd 基準。別の場所から起動すると一覧が 0 件になる）
- fixture: `scripts/gen-fixture.mjs` の `spoken`（12 秒の映像 + 話した言葉 4 行 c-0001〜c-0004・字幕トラック）に空の `A1` を足して git 管理。
  Cmd+Z の判定は captions.json / edit.json が fixture の git HEAD と **byte 一致**かどうか（`scripts/undo.mjs`）
- 右パネルを畳み、プレビューとタイムラインのあいだのスプリッターを上げてタイムラインを縦に広げてから採った（狭いままだとタイムラインが縦スクロールし、受け皿の帯が見える範囲の外に出る）
- ドラッグは `Input.setInterceptDrags` で本物の dragstart の DragData を横取りし、`Input.dispatchDragEvent` の dragEnter → dragOver ×3 → drop（または dragCancel）で運ぶ（`scripts/tsdrag.mjs` / 回帰は `scripts/libdrag.mjs`）。
  `atDragStart` = 掴んだ直後（タイムラインへ入る前）、`duringDrag` = タイムラインの上、`afterDrop` = 落とした後の見た目。受け皿の帯は `[data-akari-textstyle-drop-target]`、ゴーストは点線枠の要素の矩形
- 落とす横位置は、話した言葉 c-0004（9〜11.5 秒）のチップの矩形から秒 → 画面 x を換算した（`TIME_X`）。＋ の前のプレイヘッドはルーラーの実クリックで置いた
- プレビューの見た目は webview 内の `.caption-row-plate` の computed style（`scripts/plates.mjs`）
- AFTER 一式は `scripts/run-after.sh`（最終ビルドで 1 回通しで実行したもの）

## BEFORE（基点 `dbd104c0` のビルド）

| 観測 | 記録 | 結果 |
|---|---|---|
| テキストスタイルのカード | `before-textstyle-cards.json` / `before-textstyle-cards.png` | 12 枚すべて `draggable` なし・＋ なし |
| hint | 同上 | ホームのカテゴリ行・一覧の見出しとも「プレビューへドラッグ、＋でプレイヘッド位置に追加」（＋ も プレビューへのドロップも実在しない） |
| カードを掴んでタイムラインの 10 秒へ | `before-textstyle-drag-timeline-10s.json` | ドラッグが始まらない（`dragIntercepted: false`）。captions.json / edit.json 不変 |

## r1（codex 初回）で見つけた差分

| 観測 | 記録 | 結果 |
|---|---|---|
| 10 秒へのドラッグ中の見た目 | `r1-hover-timeline-10s-ghost-past-end.json` / `.png` | タイムラインの上に来たときだけゴーストが出て、**掴んだ時点では何も出ない**。12 秒の案件でゴーストが 10〜13 秒に描かれるが、実際に置かれるのは 10〜12 秒 → r2 で「掴んだ時点で受け皿の帯」「ゴーストの終端を出力の尺で切る」を直させた |
| 一覧の最後のカード（12 枚目 `title-impact`）の ＋ | （r2 のビルドで観測） | 一覧を最後までスクロールすると、ライブラリ面右下の丸い「ライブラリに追加」ボタンが ＋ の上に重なり、押すとそのメニューが開く → r3 でテキストスタイルの一覧だけ下余白 110px を足させた |

## AFTER（最終ビルド）

| 観測 | 記録 | 結果 |
|---|---|---|
| カード（grid / list） | `after-cards-grid.json` / `after-cards-grid.png` / `after-cards-list.json` | 12 枚すべて `draggable=true`・＋ 1 つ（aria-label「<名前> をプレイヘッド位置に置く」）・サムネイル内の要素は `draggable=false`。list 表示でも同じ |
| hint | 同上 | 「タイムラインへドラッグ、＋でプレイヘッド位置に置く」（ホームのカテゴリ行・一覧の見出しとも） |
| 掴んだ時点の受け皿 | `after-drag-10s.json`（`atDragStart`）/ `after-drag-start-band.png` | ペイロード `{ kind: 'textstyle', id: 'subtitle-news' }`（MIME `application/x-akari-library-item`）。タイムラインへ入る前から「字幕」行の直上の帯（622×24・点線枠 + 薄い塗り）が出る |
| タイムラインの 10 秒付近の上 | `after-drag-10s.json`（`duringDrag`）/ `after-drag-hover-10s.png` | 帯に加えて落とす位置に 10〜12 秒のゴースト（幅 95px = 2 秒。出力 12 秒で切れる） |
| 10 秒へドロップ | `after-drag-10s.json` / `after-drop-10s.png` / `after-drop-10s-preview.json` | `c-0005` start **9.9838** / end 12・`style_preset: "subtitle-news"`・`time_domain: "output"`・文言「テキストを入力」。チップは lane `t-placed-text-display`（「文字」行）で選択中。プレビューは 00:00:09.985 へシークし、プレート `caption-plate-c-0005` の背景 `rgb(198, 40, 40)`（= プリセットの `#c62828`）。帯・ゴーストは消える |
| 同 Cmd+Z 1 回 | `after-drop-10s-undo.json` | captions.json / edit.json とも HEAD と byte 一致、`git status` 空 |
| list 表示の行から 2 秒へ | `after-list-drag-2s.json` / `after-list-drag-2s-undo.json` | `c-0005` start 2.0088・`narration-caption`・「文字」行。Cmd+Z で byte 一致 |
| ＋（プレイヘッド 00:00:05.013） | `after-plus-5s.json` / `after-plus-5s.png` / `after-plus-5s-preview.json` | `c-0005` 5〜8 秒・`style_preset: "emphasis-red"`・「文字」行で選択中。プレビューの文字色 `rgb(255, 23, 68)`（= `#ff1744`）。Cmd+Z で byte 一致（`after-plus-5s-undo.json`） |
| 一覧の最後のカードの ＋ | `after-plus-last-card.json` / `after-plus-last-card.png` | `title-impact` が 7〜10 秒に入る（右下の丸いボタンに隠れない）。Cmd+Z で byte 一致 |
| 「文字」行があるときの受け皿 | `after-row-band-setup.json` → `after-row-band-cancel.json` / `after-row-band-start.png` | 置いた文字が 1 本あると、帯は「文字」行そのもの（y 466。字幕の直上の帯 y 444 から 1 行下）に出る。取り消すと帯・ゴーストとも消え、captions.json 不変 |
| ライブラリ面に落とす | `after-drop-on-library.json` | 何も起きない（captions.json / edit.json 不変・通知なし）。帯は落とした後に消える |
| プレビューに落とす（本票の対象外） | `after-drop-on-preview.json` | 何も起きない（不変）。帯は消える |

### 回帰（最終ビルド）

| 経路 | 記録 | 結果 |
|---|---|---|
| BGM `bgm-jazzhop-piano-086` → A1 の 3 秒 | `regression-bgm-a1.json` / `regression-bgm-a1.png` | ペイロード `kind: 'asset'`。ゴーストは A1 のみ（テキストスタイルの帯は出ない）。`a1` に `audio-1` at 90・4631 フレーム、`bgm-jazzhop-piano-086.mp3` を取り込み。Cmd+Z で byte 一致 |
| SFX `sfx-bell-tree` → A1 の 3 秒 | `regression-sfx-a1.json` | `audio-1` at 90・76 フレーム、`sfx-bell-tree.mp3`。Cmd+Z で byte 一致 |
| B-roll `talkinghead-desk-ja-01` → 映像行の 3 秒 | `regression-broll-video.json` / `regression-broll-video.png` | 3 秒には base.mp4 があるので、既存の規則どおり「重なるので新しいトラックに置きます」で新しいトラック `v1` に `clip-1` at 90・1128 フレーム。Cmd+Z で byte 一致 |

## 既知の挙動（本票の変更ではない）

- A1 を足した fixture では、タイムラインを開いた直後（ドラッグ前）に縦スクロールが 41.5px 下がった状態になることがあった（r1・最終とも、テキストスタイルを触る前から）。
  狭いタイムラインでは「字幕」行の直上の帯がスクロールの外に出て見えない。証跡はスプリッターでタイムラインを広げて採った。基点ビルドは A1 なしの fixture で採ったので、同じ条件での基点の比較はしていない
- CDP の `dragCancel` のあと、タイムラインの縦スクロールがネイティブに（JS の scrollTop setter / scrollBy / scrollTo / scrollIntoView を経由せず）下端まで動き続けることがあった。
  これらの API をフックしても呼び出しは 0 件で、Electron を起動し直した後の通し（`run-after.sh`）では出ていない。CDP でドラッグを取り消したとき特有の挙動と見ている（実マウスでは未確認）

## スクリプト

`scripts/` — `launch.mjs`（起動）/ `open.mjs`（タイムライン・プレビューを開く）/ `opencat.mjs`（カテゴリを開く）/ `cards.mjs`（カードの状態）/
`tsdrag.mjs`（テキストスタイルのドラッグ）/ `tsplus.mjs`（＋）/ `libdrag.mjs`（回帰のドラッグ）/ `undo.mjs`（Cmd+Z と byte 判定）/ `plates.mjs`（プレビュー）/
`tlscroll.mjs` / `click.mjs` / `mdrag.mjs` / `key.mjs` / `ev.mjs` / `shot.mjs` / `run-after.sh`（AFTER 一式）。
`cdp-lib.mjs` / `l1-lib.mjs` / `l1-common.mjs` / `gen-fixture.mjs` は akari-annotations の `placed-text-own-row` / `place-text-button` の写し。共通部品は `common.mjs`。
