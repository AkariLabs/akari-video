# キャンバスの区間では置いたものがキャンバスへ入る — L1 証跡（task 2026-09-25-libcanvas-p3-canvas-aware-drop）

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動（`scripts/setup.sh` → `scripts/launch.mjs`）。`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は本票専用の一時ディレクトリ、CDP ポート 9558。スクリプトは P-1（`../p1-preview-drop/scripts/`）の写しで、ポートと下記の追加だけが違う
- fixture: `scripts/gen-fixture.mjs` — 1280×720・30 秒の単色映像 + 話した言葉 4 行・字幕トラック + **0:10〜0:15 の空のキャンバス `g-1`（名前「キャンバス 1」・`origin: user` / `durationMode: fixed`。「キャンバスを作る」と同じ形で、字幕の段の上の段 `V1`）**。`setup.sh` が空の音声トラック `A1` を足して git 管理にする。Cmd+Z の判定は edit.json / captions.json が fixture の HEAD と byte 一致かどうか（`scripts/undo.mjs`）
- ドラッグは実マウスでライブラリのカードを掴み、`Input.setInterceptDrags` で本物の DragData を横取りして `Input.dispatchDragEvent` で運ぶ（`scripts/pvdrag.mjs`）。本票で `--alt`（dragOver / drop の modifiers = ⌥）と、入れ子まで歩いて親（キャンバス）と絶対時刻を記録する処理を足した
- タイムラインの行へのドロップは `host:<x>,<y>`（本体ページの CSS px）。キャンバスの帯が表示範囲に入るまで実ホイールで縦に送る（`scripts/wheel.mjs`）
- キャンバスを 0:20 へ動かす操作は C-0b の L1 と同じ（帯を実マウスでドラッグ。`scripts/movecanvas.mjs`）
- AFTER の一連の手順は `scripts/after.sh` にまとめてある（f6 だけは帯がスクロールバーに掛かったため、`wheel.mjs` を直してから同じ手順で取り直した）

## BEFORE（基点 `785f29f7` のビルド）

| 観測 | 記録 | 結果 |
|---|---|---|
| プレイヘッド 0:12（キャンバスの区間内）で写真 `still/bg-aurora-mesh` をプレビューの右上へ | `before/before-drop-photo-at-12s.json` / `before/before-drag-photo-at-12s.png` | 仮枠の下は「0:12.0 → 0:17.0」だけ（行き先の表示なし） |
| 落とした後の edit.json | `before/before-edit-tracks-after-drop.json` / `before/before-after-drop-at-12s.png` | `image-1` は新しい段 `v1` の**段直下**（at 360・尺 150 = キャンバスの終わり 450 を越える）。キャンバス `g-1` の `items` は空のまま |

## AFTER（最終ビルド = codex 5 往復目）

| 観測 | 記録 | 結果 |
|---|---|---|
| 0:12 で写真をプレビューへドラッグ中 | `after/f1-drop-photo-at-12s.json`（`duringDrag.times`）/ `after/f1-drag-photo-at-12s.png` | 仮枠の下に「**0:12.0 → 0:15.0 · キャンバス 1 に入ります**」（終わりはキャンバスの終わりで切った時刻） |
| 落とす | `after/f1-drop-photo-at-12s.json` | `image-1` が **`g-1` の子**・相対 at 60（絶対 360）・尺 **90**（区間の終わりで切る）・`source.out` 3 秒。transform は ⌥ で外に置いたときと同じ値。空の `A1` を含む他の段は不変 |
| ▸ で開く | `after/f1-timeline-canvas-expanded.png` | キャンバス 1 の行の下に `image-1` の行 |
| Cmd+Z 1 回 | `after/f2-undo-photo.json` | edit.json が HEAD と byte 一致 |
| ⌥ を押して落とす | `after/f3-drop-photo-alt-at-12s.json` / `after/f3-drag-photo-alt-at-12s.png` | 仮枠の下は「0:12.0 → 0:17.0」だけ（行き先の表示なし）。`image-1` は新しい段 `v1` の段直下・尺 150（今までどおり）。Cmd+Z 1 回で HEAD（`after/f3-undo.json`） |
| ⌥ で置いた写真の画面上の位置（12.5 秒） | `after/f3-measure-12.5s-alt.json` / `after/f3-stage-12.5s-alt.png` | 中心 (961.75, 180.75)・落とした点 (961.09, 179.33) → 誤差 (0.66, 1.42)px、幅 320.25px |
| 区間外（0:05）で落とす | `after/f4-drop-photo-outside-at-5s.json` / `after/f4-drag-photo-outside-at-5s.png` | 行き先の表示なし。`image-1` は段直下 at 150・尺 150（今までどおり）。Cmd+Z 1 回で HEAD |
| T タイルを 0:12 でプレビューへ | `after/f5-drop-text-at-12s.json` / `after/f5-drag-text-at-12s.png` | 仮枠の下に「0:12.0 → 0:15.0 · キャンバス 1 に入ります」。captions に `c-0005`（12〜15 秒）、`g-1` の子に caption item `cap-c-0005`（相対 60・尺 90）、字幕の袋の `source.exclude` に `c-0005` |
| その文字の表示位置（12.5 秒） | `after/f5-plates-12.5s.json` / `after/f5-stage-12.5s-text.png` | 落とした点 (382.9, 216.8) → 文字の中心 (382.4, 217.2) |
| 文字の Cmd+Z 1 回 | `after/f5-undo-text.json` | edit.json と captions.json の両方が HEAD と byte 一致 |
| タイムラインのキャンバスの帯（0:13）へ写真 | `after/f6-timeline-before-drop.png` / `after/f6-drop-photo-on-canvas-row-13s.json` / `after/f6-drag-photo-on-canvas-row.png` | `image-1` が `g-1` の子・相対 90（絶対 390）・尺 60（区間の終わりで切る）。Cmd+Z 1 回で HEAD |
| タイムラインの Base 行（0:13・キャンバスの行ではない）へ写真 | `after/f7-drop-photo-on-base-row-13s.json` | 段直下（新しい段 `v1`・at 390・尺 150）= 今までどおり。Cmd+Z 1 回で HEAD |
| もう一度 0:12 でプレビューへ置き、キャンバスの帯を 0:20 へ | `after/f8-drop-photo-at-12s.json` / `after/f8-move-canvas-to-20s.json` / `after/f8-canvas-moved-to-20s.png` | キャンバス at 300 → 599（帯のドラッグの 1px 相当の誤差）。子 `image-1` は相対 60 のまま・**絶対 360 → 659**（キャンバスと一緒に動く） |

## 途中で見つかった差分（codex の往復ごと・同じスクリプト）

| 往復 | 観測 | 差し戻し |
|---|---|---|
| r1 | キャンバスへ入れる経路で、無関係な空の音声トラック `A1` が消える（段直下へ置いてから移し、空の段を全部片付けていた） | 最初から子として入れる・既存の段に触れない |
| r2 | キャンバスの区間内なら、タイムラインの Base 行へ落としても・T キーなど他の経路でもキャンバスに入る（時刻だけで判定していた） | プレビュー経由（`canvasAware`）とキャンバスの行（`canvasId`）だけに限る |
| r3 | タイムラインのキャンバスの帯の上へ落としても入らない（行の判定がドロップの target 要素に頼っていて、帯の上では見出し列の行に当たらない） | 座標で行を判定する |
| r4 | 縦スクロールしていると帯の上でも行が見つからない | 見出し行の実座標で判定する |

## 未確認

- キャンバスの子の写真（media item）そのものの描画: 基点のビルドでは group の子の media が描かれない（別票 C-0a の範囲。基点に未合流）。画面上の位置は、子の transform が ⌥ で外に置いたときと同じ値であること（キャンバス自身は変形なし）と、外に置いた写真の実測で確かめた
