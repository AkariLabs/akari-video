# 図形の棚からプレビューへドラッグして置く — L1 証跡（task 2026-09-25-libcanvas-fx2-shape-preview-drop）

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動（`scripts/setup.sh` → `scripts/launch.mjs`）。`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は本票専用の一時ディレクトリ、CDP ポート 9566。スクリプトは P-3（`../p3-canvas-aware-drop/scripts/`）の写しで、ポートと下記の追加だけが違う
- fixture: `scripts/gen-fixture.mjs`（P-3 と同じ）— 1280×720・30 秒の単色映像 + 話した言葉 4 行・字幕トラック + 0:10〜0:15 の空のキャンバス `g-1`（「キャンバス 1」）。`setup.sh` が空の音声トラック `A1` を足して git 管理にする。Cmd+Z の判定は edit.json が fixture の HEAD と byte 一致かどうか（`scripts/undo.mjs`）
- ドラッグは実マウスで図形の棚のタイル（`[data-akari-shape-tile=…]`）を掴み、`Input.setInterceptDrags` で本物の DragData を横取りして `Input.dispatchDragEvent` で出力プレビューの上へ運ぶ（`scripts/pvdrag.mjs`）。落とす点は出力の枠の割合（`stage:0.75,0.25` = 右上）。期待値 = 落とした点を出力 px に換算した値（`drop.outputPx`）
- 図形の要約（`scripts/sumshape.cjs`）: 置かれた item の中心 = `transform` + `params.width/height` の半分、落とした点との差を `err` に出す
- 画面上の位置: 出力の枠だけを撮り（`scripts/stageshot.mjs`）、下地の色から外れた画素の外接矩形を取る（`scripts/bbox.mjs`）。選択の枠が写らないよう、出力の枠の左の空所を 1 回押して選択を本編のカットへ移してから撮る（枠は画面の縁に出て測る範囲の外）
- 書き出し: `render-cut <project> --engine osr` の MP4 から同じ時刻のフレームを取り出し、同じ `bbox.mjs` で測る
- AFTER の手順は `scripts/after.sh` にまとめてある。起動した Electron は `scripts/stop.sh` で PID を指定して止める
- 注意: 作業場所は実パスで渡すこと。macOS の `/tmp` は `/private/tmp` へのリンクで、起動したプロジェクトのパスとプレビューが持つ editUri の文字列が食い違うと、写真も図形も「プロジェクトを特定できません。」で置けない（1 回目の起動で当たった。基点からある挙動で本票の変更とは無関係）

## BEFORE（基点 `7deaa09a` のビルド）

| 観測 | 記録 | 結果 |
|---|---|---|
| 棚の星（`star-5`）のタイル | `before/before-drop-star-on-preview.json`（`card.draggable`・`payload`） | タイルは `draggable="true"`、payload `{"kind":"shape","preset":"star-5","name":"5 点の星","vb":[100,95]}` が送られる |
| プレビューの右上へドラッグ中 | 同上（`duringDrag`）/ `before/before-drag-star.png` | 仮枠は写真と同じ 16:9・出力幅 1/4 の「素材」の枠（縦横比は図形と無関係） |
| 落とす | 同上（`editChanged` / `newItems`） | **何も起きない**（edit.json 不変・通知なし） |

## AFTER（最終ビルド）

出力 1280×720 → 図形の既定寸 = 長い辺 240px（短辺 720 の 1/3）。

| 観測 | 記録 | 結果 |
|---|---|---|
| 0:03 で星をプレビューの右上へドラッグ中 | `after/f1-drop-star-at-3s.json`（`duringDrag`）/ `after/f1-drag-star.png` | 仮枠 89.7×85.1 CSS px（表示中の出力の枠 478.2px に対して 240×228 出力 px = 星の縦横比 100:95）に「5 点の星」、下に「0:03.0 → 0:08.0」 |
| 落とす | `after/f1-drop-star-at-3s.json` | `shape-1`（path・`preset: star-5`・240×228・`fill #a6a6a6`）・at 90（= プレイヘッド 3 秒）・尺 150。item の中心 (961.17, 179.63)・落とした点 (961.09, 179.33) → **誤差 (0.08, 0.30)px**。段はいちばん上の映像の段（空いていた `v-canvas`） |
| 選ばれた状態 | 同上の直後の DOM | タイムラインの `shape-1` に `akari-annotations-selected`。再生位置は 0:03 のまま |
| プレビューの描画（3.5 秒） | `after/f1-measure-3.5s.json` / `after/f1-stage-3.5s.png` | 外接矩形 (841.66, 66.28) 240.19×227.95・中心 (961.75, 180.25) → 落とした点との差 (0.66, 0.92)px（P-1 の写真の実測と同じ撮影の系統差） |
| Cmd+Z 1 回 | `after/f2-undo-star.json` | edit.json が HEAD と byte 一致 |
| ライン（実線・端なし）を 0:04 で左下へ | `after/f3-drop-line-at-4s.json` / `after/f3-drag-line.png` | 仮枠 89.7×20（ラインの vb の比）。`shape-1` = line・`stroke #000000`・4px・240×48・at 120。中心の誤差 **(0.05, 0.74)px**・選ばれた状態。Cmd+Z 1 回で HEAD（`after/f3-undo-line.json`） |
| キャンバスの区間（0:12）で星を右上へ | `after/f4-drop-star-at-12s-canvas.json` / `after/f4-drag-star-at-12s.png` | 仮枠の下に「0:12.0 → 0:15.0 · キャンバス 1 に入ります」。`shape-1` が **`g-1` の子**・相対 at 60（絶対 360）・尺 **90**（区間の終わりで切る）。中心の誤差 (0.08, 0.30)px |
| そのときの画面 | `after/f4-window-12s.png` / `after/f4-stage-12s-selected.png` | プレビューは「全体 › キャンバス 1」に入り、星に選択のつまみ。フッター「図形を置きました。」 |
| Cmd+Z 1 回 | `after/f4-undo-canvas.json` | edit.json が HEAD と byte 一致 |
| ⌥ を押して 0:12 で落とす | `after/f5-drop-star-at-12s-alt.json` / `after/f5-drag-star-at-12s-alt.png` | 仮枠の下は「0:12.0 → 0:17.0」だけ。新しい段 `v1` の段直下・at 360・尺 150（キャンバスに入らない）。Cmd+Z 1 回で HEAD（`after/f5-undo-alt.json`） |
| 書き出し（OSR）との一致 | `after/f6-*` | 0:03 に外（右上）・0:12 にキャンバスの中（左下）へ置いて `render-cut --engine osr`（PASS）。**3.5 秒**: 書き出しの星 (841, 66) 240×228・中心 (961, 180) / プレビュー (961.75, 180.25) / item の中心 (961.17, 179.63)。**12.5 秒（キャンバスの子）**: 書き出し (199, 318) 239×228・中心 (318.5, 432) / item の中心 (318.75, 431.57) / 落とした点 (318.70, 430.93) → 書き出しと落とした点の差 (-0.2, 1.07)px。プレビューの 12.5 秒は (318.75, 433.31)（撮影画像が 717 行で出力の 720 行より 3 行少なく、下へ行くほど y が 1〜2px 大きく出る測定側の系統差。書き出しのフレームは 1280×720 ちょうど） |
| 押して置く経路（回帰） | `after/f7-click-place-regression.json` | 棚のハートを押す → 出力の中央 (640, 360) に 5 秒で置かれる（S-1 の挙動のまま） |

- `after/f0-*`: 1 回目の星のドラッグ（undo 直後の再読込と seek が重なり、プレイヘッドが 0:01 のときに落とした記録。at 30 = 落とした時点のプレイヘッドで、中心の誤差は同じ (0.08, 0.30)px。Cmd+Z 1 回で HEAD）
