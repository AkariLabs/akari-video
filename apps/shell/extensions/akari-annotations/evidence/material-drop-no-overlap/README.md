# 素材を重なる位置へ落としたら新しいトラックへ置く — L1 証跡

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動。`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は
  一時ディレクトリ（`/tmp/mdno-l1/`）。CDP ポート 9391。ウィンドウ 1120×668（CSS px）。プレビューとタイムラインの境をドラッグしてタイムラインを広げた
- fixture は git 管理のプロジェクト（`templates/project-default` の複製 + 6 秒の `base.mp4` + 取り込み済み素材）。edit.json は 2 通り:
  - **A**（`fixture-a-edit.json`、sha256 `8c75f5b4…`）: `v2`（空）/ `v1`（`cut-1` base 0〜180 フレーム）/ `a1`（空）。画面では上から V2（base）/ V1（空）/ A1
  - **B**（`fixture-b-edit.json`、sha256 `d8411d05…`）: `v1`（`cut-1` 0〜60、`cut-2` 180〜240）/ `a1`（`bell-1` 60〜136）
- ドラッグは `Input.setInterceptDrags` で本物の dragstart の DragData を横取りし、`Input.dispatchDragEvent` の dragEnter → 各点で dragOver ×3 → 最後の点で drop（`scripts/mdrop.mjs`）。
  各点で「ゴースト（`insertionPreview` = 挿入ゴースト）」「緑の挿入線（`insertLine`）」「フッター文言」を記録。
  drop 後に `packages/edit-lint/bin/edit-lint.mjs --json` を保存済み edit.json に当て、`overlap` を含む所見を記録
- Cmd+Z は実キーイベント 1 回（`UNDO=1`）。前後の edit.json の sha256 を比べ `byteIdentical` を記録
- `tracks[]` は画面の下から上の順（配列で後ろ = 画面で上）。トラック名ラベルは表示位置で振り直される

## 実測値

| 観測 | 記録 | 結果 |
|---|---|---|
| プロジェクト面の動画（raw-clip 4 秒）を base のある行の 3 秒へ（A） | `c1-proj-video-overlap.json` / `drag-video-overlap-insert-line.png` / `drag-video-no-overlap-row-ghost.png` / `after-drop-video-overlap-new-track.png` | 3 秒位置: 挿入線 + 挿入ゴースト、フッター「重なるので新しいトラックに置きます」。6.9 秒位置（重ならない）へ動かすと行のゴースト（点線）に戻り文言が消える。戻して drop → 新トラック `v3`（`v1` の直後 = 画面ですぐ上）に `clip-1@92+120`。`cut-1@0+180` 不変。lint `pass`・overlap 所見 0。Cmd+Z 1 回で byte 一致 |
| ライブラリ B-roll `talkinghead-desk-ja-01` を同じ位置へ（A） | `c2-lib-broll-overlap.json` | 同じ表示の切り替え。新トラック `v3` に `clip-1@92+1128`。lint overlap 0。Cmd+Z 1 回で byte 一致 |
| プロジェクト面の SFX（bottlecap）を `bell-1` と重なる A1 の 3 秒へ（B） | `c3-proj-sfx-audio-overlap.json` / `drag-sfx-overlap-insert-line-below.png` / `after-drop-sfx-overlap-new-track-below.png` | 挿入線は A1 の下端、挿入ゴーストはその下。6 秒位置では行ゴーストに戻る。drop → 新トラック `a2`（`a1` の直前 = 画面ですぐ下）に `audio-1@93+54`。`bell-1@60+76` 不変。lint overlap 0。Cmd+Z 1 回で byte 一致 |
| ライブラリ SFX `sfx-pop-bubble-big` を同じ位置へ（B） | `c5-lib-sfx-audio-overlap.json` | 挿入表示 → `a2` に `audio-1@93+54`。lint overlap 0。Cmd+Z 1 回で byte 一致 |
| ライブラリ B-roll（37.6 秒）を V1 の隙間 2.5 秒へ（B。仮尺 3 秒では `cut-2` の 180 に届かない） | `c4-lib-broll-gap-real-length-overlap.json` / `drag-broll-gap-row-ghost.png` / `after-drop-broll-gap-real-length-new-track.png` | ドラッグ中は行ゴースト（挿入線なし）。drop 後、実尺 1128 フレームで `cut-2` と重なるため新トラック `v2` に `clip-1@77+1128`。lint overlap 0。Cmd+Z 1 回で byte 一致 |
| OS ファイル（2 秒 mp4）を `cut-1` と重なる V1 の 1 秒へ（B） | `c6-os-file-drop-overlap.json` / `c6-undo.json` | 取り込み後 `v2` に `clip-1@34+60`、フッター「…重なりを避けて新しいトラックに置きました。」。Cmd+Z 1 回で tracks 3 → 2、sha256 が fixture B と一致 |
| 右クリック「タイムラインに追加」、プレイヘッド 34 フレーム（`cut-1` の中）（B） | `m3-menu-add-video-playhead-inside-clip.json` | `v2` に `clip-1@34+120`。Cmd+Z 1 回で byte 一致 |
| 同、プレイヘッド 170（`cut-2` 180 と重なる）（B） | `m2-menu-add-video-at-playhead-overlap.json` | `v2` に `clip-1@170+120`。Cmd+Z 1 回で byte 一致 |
| 同、プレイヘッド 0（A。追加先は空の `v2`） | `m1-menu-add-video-overlap.json` | 空行なので従来どおり `v2` に `clip-1@0+120`（トラックは増えない） |

### 回帰（従来どおり）

| 観測 | 記録 | 結果 |
|---|---|---|
| 重ならない位置（A、6.9 秒） | `r1-proj-video-no-overlap.json` | 行ゴースト → 同じ行 `v1` に `clip-1@200+120`、トラック数不変。Cmd+Z で byte 一致 |
| 行と行のあいだ（A） | `r2-proj-video-between-rows.json` | 挿入線 + 挿入ゴースト → `v2` と `v1` のあいだに `v3`。Cmd+Z で byte 一致 |
| 映像を A1 へ | `r3-proj-video-on-audio-rejected.json` | ゴーストなし・「音のレーンには映像を置けません。」、edit.json 不変 |
| ロックした base の行へ重なる位置で | `r4-proj-video-on-locked-row-rejected.json` | 新トラックへ切り替わらず、ゴーストなし・「「V2」はロック中です（鍵を外すと編集できます）」、edit.json 不変 |

## スクリプト

`scripts/` — `mdrop.mjs`（本票用。プロジェクト面・ライブラリ面のドラッグ / 右クリック追加、各点の表示記録、lint、Cmd+Z と byte 比較）/ `osdrop.mjs` / `undo.mjs` / `opencat.mjs` / `click.mjs` / `mdrag.mjs` / `ev.mjs`。
`library-direct-place` の証跡スクリプトと `cdp-lib.mjs` をパス・ポートだけ変えて複製した。
