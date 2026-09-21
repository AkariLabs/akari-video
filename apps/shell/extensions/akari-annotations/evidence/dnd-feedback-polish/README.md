# 置けない行では赤い枠と理由を出す — L1 証跡（(1)）

## 採取方法

- 最終ビルド（`apps/shell` で `npm run build`）の Electron を直接起動。`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は `/tmp/dfp-l1/`、CDP ポート 9423。ウィンドウ 1120×668（CSS px）
- fixture A（`v2` 空 / `v1` base.mp4 0〜180 フレーム / `a1` 空。画面では上から V2 = base / V1（空）/ A1（空））。プレビューとタイムラインの境
  （Lumino の SplitPanel ハンドル）はページ内で PointerEvent を送って上へ動かした（CDP のマウスドラッグでは動かなかった）
- 画面の行: V2 y≈383 / V1 y≈434 / A1 y≈475、行と行のあいだ y≈409。x=480 ≈ 3.7 秒、x=570 ≈ 6.7 秒（30 px/秒）
- `scripts/ghostdrop.mjs`（`material-drop-no-overlap` の `mdrop.mjs` を流用）: 本物の DragData を `Input.setInterceptDrags` で横取りし、各点で dragOver ×3 → 記録 →
  最後の点で drop。素材ゴースト要素に印を付け、各点で「矩形・`akari-annotations-ghost-rejected` クラス・border・outline・background・文言」、
  挿入線、フッター、dragover の `defaultPrevented` と `dropEffect`（ページ内 capture リスナー）を記録。drop 後は edit-lint、`UNDO=1` で Cmd+Z 1 回と byte 比較。
  `GRIP=img` はカードのサムネイル `<img>` の上から掴む
- 途中のラウンド（r2 ビルド）で採った c1〜c6 は、文言の折り返し修正（r3/r4）の前だったので消し、最終ビルドで f1〜f11 を採り直した

## 実測値（最終ビルド）

| 観測 | 記録 | 結果 |
|---|---|---|
| プロジェクト面の SFX（bell-tree）: V1 → A1 → V1 で離す | `f1-proj-sfx-video-row-rejected.json` / `f1-proj-sfx-{1,2,3,after}.png` | V1: 赤い枠（border `2px solid rgb(241,76,76)`・outline 同色・塗り `rgba(241,76,76,.25)`・クラス rejected）が V1 の行（y 407・高さ 50）に出て、枠内に「映像のレーンには音を置けません。」。A1: 通常（`1px dashed rgb(77,208,200)` + オレンジ outline `rgb(249,115,22)`・文言なし）。V1 で離す → **edit.json 不変**、フッター「映像のレーンには音を置けません。」。ドラッグ後のゴーストは非表示・rejected クラスなし・通常スタイル・文言空 |
| プロジェクト面の動画（raw-clip）: A1 → V1 → A1 で離す | `f3-proj-video-audio-row-rejected.json` / `f3-proj-video-*.png` | A1: 赤い枠（高さ 28）+「音のレーンには映像を置けません。」（枠内で 2 行に折り返し、2 行目の下端が少し切れる）→ V1: 通常 → A1 で離す → 不変 |
| プロジェクト面の画像（bg-aurora-mesh）: A1 | `f4-proj-image-audio-row-rejected.json` | 赤い枠 + 理由、不変 |
| ロックした V1 へ動画: V1 → V2（重なる位置）→ V1 で離す | `f5-proj-video-locked-row-rejected.json` / `f5-proj-video-locked-*.png` | V1: 赤い枠 +「「V1」はロック中です（鍵を外すと編集できます）」。V2 の 3.7 秒: 挿入線 + 挿入ゴースト（`2px solid #f97316`）+「重なるので新しいトラックに置きます」。V1 で離す → 不変 |
| 次のドラッグの最初の枠（f5 は赤で終了 → 次の f6） | `f6-proj-video-empty-row-accepted.json` / `f6-proj-video-v1-*.png` | 最初の点から通常の点線 + オレンジ outline。V1 に `clip-1@111+120`、Cmd+Z 1 回で byte 一致 |
| 重なりの挿入線（回帰） | `f7-proj-video-overlap-insert.json` / `f7-proj-video-overlap-*.png` | 3.7 秒: 挿入線 + 挿入ゴースト、6.7 秒: 通常の行ゴースト、戻して離す → 新トラック `v3` に `clip-1@111+120`、フッター「…重なりを避けて新しいトラックに置きました。」。Cmd+Z で byte 一致 |
| 行と行のあいだ（回帰） | `f8-proj-video-between-rows.json` / `f8-proj-video-between-*.png` | 挿入線 + 挿入ゴースト → `v2` と `v1` のあいだに `v3`。Cmd+Z で byte 一致 |
| SFX を A1 へ（受理・回帰） | `f9-proj-sfx-a1-accepted.json` | 通常の枠 → `audio-1@111+76`。Cmd+Z で byte 一致 |
| ライブラリ BGM（jazzhop-piano-086、未取得）: V1 → A1 → V1 で離す | `f2-lib-bgm-video-row-rejected.json` / `f2-lib-bgm-*.png` | 赤い枠 + 理由 → 通常 → 赤、離しても edit.json 不変・**取り込みなし**（`assets/audio/` に増えない） |
| ライブラリ画像（still/br-3d-printer）: A1 → V1 → A1 | `f10-lib-image-audio-row-rejected.json` / `f10-lib-image-*.png` | 赤い枠 +「音のレーンには映像を置けません。」→ 通常 → 赤、不変 |
| ライブラリ BGM をサムネイルから掴んで V1 → A1 で離す（(2) の AFTER 兼用） | `f11-lib-bgm-thumb-grip-drop-a1.json` / `f11-lib-bgm-thumb-grip-*.png` | V1 で赤、A1 で通常。A1 に `audio-1@111+4631`（取り込み込み）。Cmd+Z 1 回で byte 一致 |

### カーソル（手順 5 の観測）

dragover はどの行でも `defaultPrevented = true`（タイムラインが受けている）で、置けない行では `dropEffect = 'none'`、置ける行では `'copy'`。
ブラウザは `dropEffect: none` を「置けない」カーソル（赤いバツ / 禁止マーク）で出すので、**カーソルは従来どおり置けない行でバツのまま**
（今回は変えていない）。CDP の合成ドラッグではスクリーンショットに OS のカーソルが写らないため、見た目は値からの判断。

## スクリプト

`scripts/` — `ghostdrop.mjs`（本票用。`mdrop.mjs` 由来）/ `sum.py`（記録の要約表示）/ `cdp-lib.mjs`・`ev.mjs`・`click.mjs`・`mdrag.mjs`・`undo.mjs`（ポート 9423・`/tmp/dfp-l1` に変えて複製）。
