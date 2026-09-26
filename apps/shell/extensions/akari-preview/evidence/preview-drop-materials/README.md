# どの素材も出力プレビューへドラッグで置く — L1 証跡（task 2026-09-26-preview-drop-materials）

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動（`scripts/setup.sh` → `scripts/launch.mjs`）。`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は本票専用の一時ディレクトリ、CDP ポート 9621、ウィンドウは 1440×900 に揃える（本票の PID のウィンドウだけ）。止めるのは `scripts/stop.sh`（PID 指定）
- fixture: `scripts/gen-materials.mjs` — P-1 の `gen-fixture.mjs` の `spoken`（1280×720・12 秒・話した言葉 4 行・字幕トラック）に、左の「プロジェクト」に並ぶ素材 3 つ（`assets/clip-yellow.mp4` 640×360 4 秒・`assets/photo-orange.png` 800×600・`assets/tone-440.m4a` 3 秒）と空の `A1` を足して git 管理
- ドラッグ: `scripts/drag.mjs`。2 つの運び方を比べられる
  - `--mode=intercept`: `Input.setInterceptDrags` で本物の DragData を横取りして `Input.dispatchDragEvent`（P-1 / FX-2 と同じ）
  - `--mode=mouse`: `Input.dispatchMouseEvent` の押下 → 移動 → 離す だけ（実マウス相当。Chromium のドラッグがそのまま走る）。**AFTER はすべてこちら**
- 記録: ページ内に記録器を仕掛け（検証専用・ソースは不変）、ドラッグ中の層（`[data-akari-preview-library-drop]`）の有無・drop が層へ届いたか・`setDragImage` に渡された要素・配置コマンドの呼び出しと戻り値・通知・edit.json / captions.json の差分・見本の札（`[data-akari-drag-sample]`）の表示を 1 つの JSON にまとめる。1 行の要約は `scripts/sum.mjs`（置かれたものの中心と、落とした点を出力 px に換算した期待値との差 `err`）
- 期待値: 落とした点（本体ページの CSS px）を出力の枠（`scripts/stage.mjs`）で出力 px に換算。枠の外に落とした場合は枠の中へ寄せた点（`clampedOutputPx`）
- 文字の実測: webview 内の字幕プレートの中心を出力 px に換算（`scripts/plates2.mjs`）
- 書き出し: `render-cut <project> --engine osr`（`AKARI_EXPORT_ALLOW_DESKTOP=0`・`render.json` の `launcher_tier: 2`）の MP4 から 5 秒のフレームを取り、プレビューの出力の枠の撮影（`scripts/stageshot.mjs`）と色ごとの外接矩形（`scripts/colorbox.mjs`）で比べる
- 記録中の作業場所は `<work>`（実パス）/ `<work-via-symlink>`（`/tmp` 経由 = symlink を含むパス）/ `<repo>` に置き換えてある
- AFTER の手順は `scripts/after.sh`（(a)〜(c)・(e)）と `scripts/after-d.sh`（(d)・(e)・回帰）

## BEFORE（基点 `5e38b7a87` のビルド）

| 観測 | 記録 | 結果 | 原因 |
|---|---|---|---|
| (a) プロジェクトの映像をプレビューの右上へ（intercept / mouse） | `before/a1-material-video-intercept.json` / `before/a1-material-video-mouse.json` / `before/a1-material-video-*drag.png` | ドラッグ中に層が出ない。dragover の target は Theia の `div.theia-transparent-overlay`、drop は起きず dragend だけ。edit.json 不変。2 つの運び方で結果は同じ | プレビュー側が `akari.material.dragStart` / `application/x-akari-material` を見ていない |
| (b) 実パスで開いた場合: T タイル（intercept / mouse）・テキストスタイル `subtitle-news`・図形 `star-5`・写真・B ロール・BGM・オーバーレイ | `before/b1-*`〜`before/b7-*` | **すべて置けた**（層・仮枠が出て drop が層へ届き、配置コマンドが成功）。0:06 で落とした図形も 0:06 に見え、再生位置は 0:06 のまま（`before/b3b-*`） | — |
| (b) プレビューの editUri と照合側の文字列が違う場合（`/tmp/...` の editUri で開いたプレビュー、ワークスペースのルートは `/private/tmp/...`） | `before/d1-symlink-text-mouse.json` / `before/d2-symlink-photo-mouse.json` | T タイル → `akari.caption.placeText` が undefined・「タイムラインを開いてから文字を置いてください。」。写真 → 「プロジェクトを特定できません。」。何も置かれない。**同じセッションで T タイルを押すと置ける**（`before/d3-symlink-text-click.txt`） | 配置コマンドが `locateAll()` の結果を `editUri.toString() ===` の文字列一致で探す（契約の H1） |
| 同上・アプリの UI（ホームの「続きから編集」）でプレビューを開いた場合 | `before/d6-symlink-ui-flow-uris.json` / `before/d7-symlink-ui-flow-text-mouse.json` | 起動パスが `/tmp` でもプレビューの editUri はルートと同じ `/private/tmp` になり、置ける | 文字列が食い違うのは、プレビューを editUri の文字列で開く経路（コマンドに外から渡したパス）だけ |
| NFD の日本語名フォルダを NFD のパスで開く | `before/d4-nfd-text-mouse.json` / `before/d5-nfd-photo-mouse.json` | 置ける（両側とも同じ NFD 文字列） | — |
| (c) 出力の枠の外（左の黒帯・再生バー・右の黒帯）へ T タイル・写真・図形 | `before/c1-*` / `before/c2-*` / `before/c3-*` | 層は出て drop も層へ届くが、仮枠が消え、コマンドは 1 つも呼ばれず無言 | `hostToOutput` が枠外で undefined → return（契約の H2） |
| ドラッグ画像 | 各 JSON の `dragImages` | ライブラリのドラッグは毎回 `<canvas 1×1>`。プレビューの外でも手元には何も出ない | window の dragstart で差し替え |

## AFTER（最終ビルド・実マウス相当 = `--mode=mouse`）

出力 1280×720。写真・映像の幅は出力幅の 1/4 = 320px（P-1 と同じ）。

| 観測 | 記録 | 結果 |
|---|---|---|
| (a) プロジェクトの映像を 0:03 で右上へ | `after/a1-material-video.json` / `after/a1-material-video-drag.png` | 仮枠「clip-yellow.mp4」「0:03.0 → 実尺」。`clip-1` at 90・120 フレーム・scale 0.5（= 320/640）。中心の誤差 (0.06, -0.18)px |
| (a) プロジェクトの画像（4:3）を左下へ | `after/a2-material-image.json` / `after/a2-material-image-drag.png` | 仮枠 150.7×113.1（サムネイルから取った 4:3）。`image-1` at 90・150 フレーム・scale 0.4（= 320/800）。誤差 (0.03, -0.47)px |
| (a) プロジェクトの音を中央へ | `after/a3-material-audio.json` / `after/a3-material-audio-drag.png` | 仮枠は音符の札「時刻に置く」「0:03.0 → 実尺」。`audio.sfx[]` に `assets/tone-440.m4a`・t = 3（ライブラリの BGM と同じ入れ先） |
| (b) T タイル / テキストスタイル `subtitle-news` を 0:04 で | `after/b1-text.json` / `after/b2-textstyle.json` / `after/b12-plates-5s.json` | `c-0005` 4〜7 秒 / `c-0006` 4〜7 秒・`style_preset: subtitle-news`。プレビューの文字の中心 (384.5, 216.4) / (639.1, 288.6)、期待 (384.3, 216.6) / (639.2, 288.8) |
| (b) 図形 `star-5` | `after/b3-shape.json` / `after/b3-shape-drag.png` | `shape-1` at 120・240×228。中心の誤差 (0.06, -0.2)px |
| (b) 写真 / B ロール / BGM / オーバーレイ | `after/b4-*` / `after/b5-*` / `after/b6-*` / `after/b7-*` | `image-2`（誤差 (0.03, -0.2)px）/ `clip-2`（1128 フレーム・誤差 (0.06, -0.44)px）/ `audio.sfx` t = 4 / `overlay-1`（ブラウザモックの窓の中心がプレビューで (512, 431)・期待 (511.7, 431.2)。transform の値は O-1 の規則のまま） |
| (b) まとめ | `after/summary-abc.jsonl` / `after/f1-stage-5s.png` | 13 件すべて、層が出て drop が層へ届き、1 件ずつ増える。通知なし |
| (c) 左の黒帯へ T タイル / 再生バーへ写真 / 右の黒帯へ図形（0:06） | `after/c1-*` / `after/c2-*` / `after/c3-*` | 寄せて置かれる: 文字は x = 0 の縁（`c-0007` 6〜9 秒）、写真の中心 (639.6, 720)、星の中心 (1280, 216.4)。ドラッグ中の仮枠も枠の縁へ寄せた位置に出る（`*-drag.png`） |
| (d) symlink を含むパス（`<work-via-symlink>` の editUri で開いたプレビュー・ルートは `<work>`） | `after/d0-symlink-uris.json` / `after/d1-*`〜`after/d4-*` / `after/summary-dg.jsonl` | T タイル・写真・図形・プロジェクトの画像がすべて置ける（誤差 0〜0.74px）。T タイルを押して置いた先も同じ `ws-d/captions.json`（`after/d5-symlink-click-same-project.txt`） |
| (e) プレビューの外でのドラッグ | `after/e0-material-hold-over-project.png` / `after/e1-text-hold-over-library.png` / `after/e3-shape-hold-over-library.png` / `after/e4-photo-hold-over-library.png` / `after/e2-sample-over-timeline.png` | 手元に見本の札（サムネイル + 名前 / 無ければ「T テキスト」「◇ 5 点の星」）が出てカーソルに付いてくる。プレビューの上では札は隠れ（各 JSON の `duringDrag.sample[].display = none`）、P-1 の仮枠だけが見える。ネイティブのドラッグ画像は 1×1 のまま |
| (f) 書き出し（OSR）との比較（5 秒） | `after/f1-stage-5s.png` / `after/f2-osr-frame-5s.png` / `after/f3-preview-vs-osr-5s.jsonl` | 映像（黄）: プレビュー (961.3, 180.5)・書き出し (961, 180)。画像（橙）: (318.7, 540.5)・(319, 539)。星: (989.3, 217.1)・(988, 216)（左腕が赤い文字の板に隠れるため右側だけの外接矩形）。差は 1.5px 以内 |
| 回帰: タイムラインへのドロップ | `after/g1-timeline-drop-photo.json` / `after/e2-sample-over-timeline.png` | 写真が Base の上の段に 7.97 秒で入る（transform なし = 従来どおり）。タイムラインの上では見本の札が出る |
| 回帰: トランジションをプレビューへ | `after/g2-transition-on-preview.json` / `after/g2-transition-drag.png` | 仮枠「カットの境目に置いてください」→ 通知「トランジションはタイムラインのカットの境目に落としてください。」だけ。edit.json 不変 |
| 回帰: LUT をプレビューの本編へ（当てる） | `after/g3-lut-on-base-cut.json` / `after/g3-lut-edit-diff.txt` | `akari.timeline.applyLibraryItem` → `cut-base` に `adjust.lut = cinematic` |

## スクリプト

`scripts/` — `gen-materials.mjs`（fixture）/ `setup.sh`（起動 → タイムラインとプレビュー → プレイヘッド）/ `drag.mjs`（2 つの運び方・記録器）/ `sum.mjs`（要約）/ `uris.mjs`（プレビューの editUri とワークスペースのルート）/ `openlook.mjs`（テキストスタイルの棚）/ `colorbox.mjs` + `bbox-load.mjs`（色ごとの外接矩形）/ `after.sh` / `after-d.sh` / `stop.sh`。
`cdp-lib.mjs` / `l1-lib.mjs` / `l1-common.mjs` / `common.mjs` / `gen-fixture.mjs` / `launch.mjs` / `open.mjs` / `click.mjs` / `key.mjs` / `ev.mjs` / `shot.mjs` / `stage.mjs` / `stageshot.mjs` / `bbox.mjs` / `measure.mjs` / `plates2.mjs` / `ptime.mjs` / `seek.mjs` / `home.mjs` / `opencat.mjs` / `reload.mjs` / `undo.mjs` は P-1（`../p1-preview-drop/scripts/`）の写し（ポートだけ 9621）。
