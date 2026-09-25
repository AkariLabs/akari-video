# ライブラリの素材を出力プレビューへ直接置く — L1 証跡（task 2026-09-25-libcanvas-p1-preview-drop）

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動（`scripts/launch.mjs`）。`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は本票専用の一時ディレクトリ、CDP ポート 9541、ウィンドウ 1440×900（CSS px）。起動の cwd はリポ直下
- fixture: `scripts/gen-fixture.mjs` の `spoken`（1280×720・12 秒の単色映像 + 話した言葉 4 行・字幕トラック）に空の `A1` を足して git 管理（`scripts/setup.sh`）。Cmd+Z の判定は edit.json / captions.json が fixture の HEAD（または直前の保存）と byte 一致かどうか（`scripts/undo.mjs`）
- ドラッグは実マウスでカードを掴み、`Input.setInterceptDrags` で本物の DragData を横取りして `Input.dispatchDragEvent`（dragEnter → dragOver ×6 → drop）で出力プレビューの上へ運ぶ（`scripts/pvdrag.mjs`）。落とす点は出力の枠の割合で指定（`stage:0.75,0.25` = 右上）
- 出力の枠の位置: 本体の `iframe.webview` → 外側の文書の content iframe → 内側の文書の `#preview-stage` の矩形を足し合わせる（`scripts/stage.mjs`）。期待値 = 落とした点を出力 px に換算した値（`drop.outputPx`）
- 置いた写真の実測: 出力の枠だけを出力 px の倍率で撮り（`scripts/stageshot.mjs`）、下地の色から外れた画素の外接矩形を取る（`scripts/bbox.mjs` / `scripts/measure.mjs`）。選択枠のハンドルが写らないよう Escape で選択を外してから撮る
- 文字の実測: webview 内の `.caption-row-plate` の文字の矩形の中心を出力 px に換算（`scripts/plates2.mjs`）
- 書き出し: `render-cut <project> --engine osr` の MP4 から該当時刻のフレームを取り出し、同じ `bbox.mjs` で測る

## BEFORE（基点 `b76f1275` のビルド）

| 観測 | 記録 | 結果 |
|---|---|---|
| 写真 `still/bg-aurora-mesh` を出力プレビューの右上へ | `before-drop-photo-on-preview.json` / `before-drag-photo-over-preview.png` | ドラッグ中も落とした後も何も出ない（受け皿の層・仮枠なし）。edit.json 不変 |
| 同じ写真をタイムラインの 2 秒へ | `before-drop-photo-on-timeline.json` / `before-timeline-drop-edit-excerpt.json` / `before-after-drop-photo-on-timeline.png` | `image-1` at 60・150 フレームが新しいトラック `v1` に入るが **transform なし** |
| そのときのプレビュー（3 秒） | `before-timeline-drop-preview-3s.png` | 1672×941 の写真が原寸のまま出力いっぱいに広がる |

## 途中で見つかった差分（codex の往復ごと・同じスクリプト）

| 往復 | 観測 | 記録 | 結果 → 差し戻し |
|---|---|---|---|
| r2 | 層が出ない | — | 出力プレビューの widget に層の部品が付いていない（開く経路の 1 つにしか付けていなかった）→ どの開き方・復元でも 1 回付くように |
| r3 | 層は出るが仮枠が出ず、落としても何も起きない | `r3-drop-photo.json` / `r3-drop-photo-dbg.json` | ドラッグ中は Theia の透明オーバーレイ（`div.theia-transparent-overlay`・z-index 999）が target になり、層（z-index 25）へ dragover が届かない → 層をオーバーレイより前面へ |
| r3 | 実行中の DOM だけで層の z-index を上げて確認（`scripts/zpatch.mjs`・ソースは不変） | `r3z-drop-photo.json` / `r3z-drag-photo.png` | 仮枠は出るが「素材の大きさを取得できませんでした」。ライブラリの素材は参照で置かれ、実体がプロジェクトの外にあるため寸法が取れない → 参照表から実体を引いて測る |
| r4 | 初めて取る B-roll が scale 1 / T タイル・テキストスタイルの文字の左端が落とした点に来る / タイムラインを閉じて置くと再生位置が 0:00 に戻る | — | r5 で修正（下の AFTER） |

## AFTER（最終ビルド = codex 5 往復目）

出力 1280×720。幅の期待値は出力幅の 1/4 = 320px。

| 観測 | 記録 | 結果 |
|---|---|---|
| 写真を右上へドラッグ中（プレイヘッド 3 秒） | `f1-drop-photo.json`（`duringDrag`）/ `f1-drag-photo.png` | 点線の仮枠 119.5×67.2（CSS px。表示中の出力の枠 478.2px の 1/4・縦横比は未知なので 16:9）がカーソル中心、枠の下に「0:03.0 → 0:08.0」 |
| 落とす | `f1-drop-photo.json` / `f1-after-drop-photo.png` | `image-1` at 90（3 秒）・150 フレーム（5 秒）、transform `{x: 321.17, y: -180.37, scale: 0.1914}`（= 320 / 元の幅 1672）。トラックは Base と字幕のあいだの新しい `v1`（字幕は覆わない）。再生位置は 0:03 のまま |
| プレビューの実測（4 秒） | `f1-measure-4s.json` / `f1-stage-4s.png` | 中心 (961.75, 180.25)・期待 (961.09, 179.33) → **誤差 (0.66, 0.92)px**、幅 **320.25px** |
| Cmd+Z 1 回 | `f1-undo-photo.json` | edit.json が HEAD と byte 一致・`git status` 空 |
| もう一度置いて保存 → 再読込 | `f2-drop-photo-again.json` / `f2-measure-after-reload.json` / `f2-stage-4s-after-reload.png` / `f2-after-reload.png` | 再読込の前後で edit.json は byte 一致。再読込後の中心 (960.5, 180.75) → 誤差 (-0.59, 1.42)px、幅 321px |
| 同じ時刻にもう 1 枚（左上） | `f3-drop-photo2-same-time.json` / `f3-measure-left.json` / `f3-measure-right.json` / `f3-stage-4s-two-photos.png` | `image-2` は新しいトラック `v2`（`v1` の上・字幕の下）。1 枚目は入れ替わらない。2 枚目の中心誤差 (-0.85, 1.02)px・幅 319px。Cmd+Z 1 回で 2 枚目だけ消える（`f3-undo-photo2.json`） |
| B-roll（初めて取る・11MB）を 6 秒で左下へ | `f4-drop-broll-first-time.json` / `f4-drag-broll.png` / `f4-measure-7s.json` / `f4-stage-7s-broll.png` | 仮枠の下は「0:06.0 → 実尺」。`clip-1` at 180・1128 フレーム（実尺 37.6 秒）・scale 0.25（= 320/1280）・重なるので新しいトラック。再生位置は 0:06 のまま（尺は 12→43 秒）。中心誤差 (-0.98, 0.91)px・幅 321px。Cmd+Z で戻る |
| BGM を 2 秒で | `f5-drop-bgm.json` / `f5-drag-bgm.png` | 仮枠は音符の SVG の札 +「0:02.0 → 実尺」（点線の枠なし = 位置を持たない）。`audio.sfx[]` に t = 2（既存の ＋ と同じ書き方）。Cmd+Z で戻る |
| T タイルを 3 秒で (383.5, 215.7) へ | `f6-drop-text.json` / `f6-plates-4s.json` / `f6-stage-4s-text.png` | captions に `c-0005` 3〜6 秒・`text_anchor: "mc"`。プレビューの文字の中心 **(382.9, 215.7)**。Cmd+Z で captions.json が元に戻る |
| テキストスタイル `subtitle-news` を 5 秒で (640, 288.6) へ | `f7-drop-textstyle.json` / `f7-plates-6s.json` / `f7-stage-6s-textstyle.png` | `style_preset: "subtitle-news"`・5〜8 秒。赤い板（プリセットの見た目）の文字の中心 **(639.2, 288.6)** |
| テキストスタイル `title-impact` を (640, 432) へ | `f7b-drop-textstyle-title.json` / `f7b-plates-6s.json` / `f7b-stage-6s-textstyle-title.png` | 黄色の文字。中心 (656, 431.4) → 横に 16px ずれる（文字幅の見積もりによる） |
| トランジションを落とす | `f8-drop-transition.json` / `f8-drag-transition.png` | 仮枠は「カットの境目に置いてください」。落とすと「トランジションはタイムラインのカットの境目に落としてください。」の通知だけで edit.json 不変 |
| タイムラインを閉じて写真を 8 秒で左下へ | `f9-timeline-closed-before.png` / `f9-drop-photo-timeline-closed.json` / `f9-after-drop-timeline-closed.png` / `f9-measure-9s.json` / `f9-stage-9s-timeline-closed.png` | `image-2` at 240 が `v1` に入る（`image-1` の直後で重ならないので同じトラック）。タイムラインは閉じたまま・再生位置は 0:08 のまま。中心誤差 (0, 1.19)px・幅 320px |
| 未購入（`locked: true`）の写真を落とす | `f10-locked-preview.json` | 実機の catalog に未購入の素材が無いため、合成した drag イベントで確認。`akari.library.showPremiumPrompt` が未登録なので「この素材を使うには購入が必要です。」の通知だけで edit.json 不変 |
| 書き出し（OSR）との一致 | `a12-osr-bbox.json` / `a12-osr-frame-4.5s.png` / `a12-osr-frame-9.5s.png` | `render-cut --engine osr` の 4.5 秒: 写真の中心 (961, 180)・幅 322px（プレビュー (960.5, 180.75)）。9.5 秒: (320, 504)・幅 320px（プレビュー (320, 505)）。**差は 1px 以内**。r4 のビルドで書き出した（写真 2 枚の item は最終ビルドの edit.json と byte 一致。最終ビルドの後は機械の負荷で Electron 自体が起動しなくなり、書き出しを取り直せなかった） |

## スクリプト

`scripts/` — `setup.sh`（fixture → 起動 → ライブラリの画像を開く）/ `pvdrag.mjs`（プレビューへのドラッグ）/ `stage.mjs` / `stageshot.mjs` / `bbox.mjs` / `measure.mjs`（位置の実測）/ `plates2.mjs`（文字）/ `ptime.mjs`（再生位置の表示）/ `undo.mjs` / `reload.mjs` / `seek.mjs` / `home.mjs` / `opencat.mjs` / `sum.mjs` / `zpatch.mjs`（r3 の切り分け専用）。
`cdp-lib.mjs` / `l1-lib.mjs` / `l1-common.mjs` / `common.mjs` / `gen-fixture.mjs` / `launch.mjs` / `open.mjs` / `click.mjs` / `key.mjs` / `ev.mjs` / `shot.mjs` は akari-project の `library-textstyle-place` の写し（ポートだけ 9541）。
