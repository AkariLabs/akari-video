# ライブラリの「テキスト」タイルをタイムラインへドラッグして置く — L1 証跡（task 2026-09-23-text-tile-drag）

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動（`scripts/launch.mjs`）。
  `AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は本票専用の一時ディレクトリ、CDP ポート 9469（`CDP_PORT=9469`）。起動の cwd はリポ直下
- fixture: `scripts/gen-fixture.mjs` の `spoken`（12 秒の映像 + 話した言葉 4 行 c-0001〜c-0004・字幕トラック）を git 管理。
  macOS では一時ディレクトリの実パス（シンボリックリンクを解いたパス）で開く（別名のパスで開くと、置いたときにプレビューのタブがもう 1 枚開く）。
  Cmd+Z の判定は captions.json / edit.json が fixture の git HEAD と byte 一致かどうか（`scripts/undo.mjs`）
- ライブラリは `akari.catalog.open` でホームを出し、右パネルを畳んでから採った（library-home-3x3-tiles と同じ段取り）
- ドラッグは `Input.setInterceptDrags` で本物の dragstart の DragData を横取りし、`Input.dispatchDragEvent` の dragEnter → dragOver ×3 → drop で運ぶ
  （タイル = `scripts/tiledrag.mjs`、テキストスタイルのカード = `scripts/tsdrag.mjs`）。`atDragStart` = 掴んだ直後、`duringDrag` = タイムラインの上、`afterDrop` = 落とした後
- 落とす横位置は、話した言葉 c-0004（9〜11.5 秒）のチップの矩形から秒 → 画面 x を換算した（`TIME_X`）
- 受け口だけの確認は `scripts/injdrop.mjs`（任意のペイロードを MIME `application/x-akari-library-item` で直接タイムラインへ落とす）

## BEFORE（基点 `baa05e2a` のビルド）

| 観測 | 記録 | 結果 |
|---|---|---|
| 「テキスト」タイルを掴んでタイムラインの 6 秒へ | `before-text-tile-drag-6s.json` / `before-text-tile-drag-6s.png` | タイルは `draggable` なし（title「テキスト — 押すとプレイヘッド位置に文字を置く」）。ドラッグが始まらない（`dragIntercepted: false`）。captions.json / edit.json 不変 |
| 受け口に `{ kind: 'text' }` を直接落とす（6 秒） | `before-receiver-text-payload-6s.json` | 受け皿の帯・ゴーストとも出ず、落としても何も起きない（captions.json / edit.json 不変）。受け口が `id` の無いペイロードを捨てている |

## AFTER（最終ビルド）

| 観測 | 記録 | 結果 |
|---|---|---|
| ホーム | `after-home.json` / `after-home.png` | 3 列 × 3 行・9 タイルは従来どおり。「テキスト」タイルだけ `draggable=true`、hint「押すかドラッグで置く」 |
| 掴んだ時点 | `after-text-tile-drag-6s.json`（`atDragStart`）/ `after-text-tile-drag-start-band.png` | ペイロード `{ kind: 'text' }`（MIME `application/x-akari-library-item` のみ）。タイムラインへ入る前から「字幕」行の直上の帯（622×24・点線枠 + 薄い塗り）が出る = テキストスタイルと同じ受け皿 |
| タイムラインの 6 秒の上 | 同（`duringDrag`）/ `after-text-tile-drag-hover-6s.png` | 帯に加えて 6〜9 秒のゴースト（x 709・幅 142px = 3 秒） |
| 6 秒へドロップ | `after-text-tile-drag-6s.json` / `after-text-tile-drop-6s.png` | `c-0005` start **6.0073** / end 9.0073・文言「テキストを入力」・`time_domain: "output"`・**`style_preset` なし**・`text_style.position.y` 0.4625。チップは lane `t-placed-text-display`（「文字」行）。帯・ゴーストは消える。edit.json 不変 |
| プレビュー | `after-text-tile-drag-6s-preview.json`（落とした直後・00:00:06.007）/ `after-text-tile-drag-6s-preview-7s.json` / `.png`（7 秒へシーク） | 7 秒でプレート `caption-plate-c-0005`「テキストを入力」（`stylePreset: null`・白 700）。落とした直後の 6.007 秒では c-0003 のプレートだけ（下の「既知の挙動」） |
| 同 Cmd+Z 1 回 | `after-text-tile-drag-6s-undo.json` | captions.json / edit.json とも HEAD と byte 一致、`git status` 空 |

### 回帰（最終ビルド）

| 経路 | 記録 | 結果 |
|---|---|---|
| 「テキスト」タイルのクリック（プレイヘッド 5 秒） | `regression-text-tile-click-5s.json` / `-undo.json` | 押すと即置く: `c-0005` 5〜8 秒・`style_preset` なし・「文字」行で選択中・ホームのまま。Cmd+Z で byte 一致 |
| テキストスタイル `subtitle-news` のカードを 10 秒へドラッグ（詳細 → テキストスタイル） | `regression-textstyle-drag-10s.json` / `regression-textstyle-drag-hover-10s.png` / `-undo.json` | ペイロード `{ kind: 'textstyle', id: 'subtitle-news' }`。同じ帯 + 10〜12 秒のゴースト（幅 95px）。`c-0005` start 9.9845 / end 12・`style_preset: "subtitle-news"`・「文字」行。Cmd+Z で byte 一致 |

## 既知の挙動（本票の変更ではない）

- 落とした位置の秒はフレームに丸めずに置かれる（6.0073 秒）。プレビューは落とした直後にその秒へシークするが、表示は 30fps のフレーム（6.000 秒）に丸められるため、
  開始がそのフレームよりわずかに後ろの置いた文字はシーク直後の 1 フレームには映らない（7 秒では映る）。テキストスタイルのドラッグでも同じ置き方（`textStyleDropStart`）で、配置側の丸めは本票の範囲外
- fixture を開くと「このフォルダを AKARI Video プロジェクトとして使いますか？」の通知が出る（応答せずに採取。captions.json / edit.json の判定には影響しない）

## スクリプト

`scripts/` — `tiledrag.mjs`（タイルのドラッグ）/ `injdrop.mjs`（受け口だけの確認）は本票で追加。
それ以外（`launch.mjs` / `open.mjs` / `opencat.mjs` / `home.mjs` / `tile.mjs` / `tsdrag.mjs` / `undo.mjs` / `plates.mjs` / `cdp-lib.mjs` / `l1-lib.mjs` / `l1-common.mjs` / `common.mjs` / `gen-fixture.mjs` ほか）は library-home-3x3-tiles の写し。
