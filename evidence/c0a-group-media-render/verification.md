# group 内の描画検証

## r6 の修正と L0

r5 の実機では字幕位置が合い、段直下 caption item の bbox はプレビュー `[303,214,517,299]`、OSR `[304,214,517,300]` だった。一方、group fixture の字幕領域の輝度はプレビュー p95/p99 `105/132`、OSR `138/158`。同じ段の写真がプレビュー字幕より上に合成されていた。

原因は描画面をまたぐ同点 z。写真レイヤー・字幕面・HTML が段の z だけを持ち、写真 DOM が字幕面より後に追加される。group 字幕を含む木だけ段と item を宣言順で採番し、写真・字幕行・HTML それぞれの z に使う。共有の字幕面は段 z を外して、行ごとに z を設定する。group 内の captions 袋の行は袋の位置を使う。段直下だけの edit は従来の段 z のまま。撮影スクリプトは各面の計算済み z と親・可視状態も記録する。r6 修正後の実機確認はラッパーの再撮影待ち。

L0: akari-preview `npx tsc -b` 通過。既知の失敗ファイル `cut-size-basis.test.mjs` と基点でもファイル単位で失敗する `frame-engine-preview.test.mjs` を除く全 200 ファイルは **1477/1477 通過**。edit-store の group 投影 9/9、render-cut の字幕・rasterize 22/22 通過。既存の z 統一テストの assert は保持した。

字幕なし変種の r5 実機では GPU eligible で書き出せた。GPU–OSR 差は HTML カードの領域が最大 146・平均 27.5、領域外が最大 31・平均 0.93。静的 opacity を持つ HTML の GPU 描画は段直下でも起きる gpu-export 側の制約で、本票の所有外として変更していない。

## r5 の修正と L0

ラッパーの切り分けで、合成済みの同じ transform と opacity を持つ段直下 caption item にも、プレビューと OSR の位置差が出た。2 秒と 0.5 秒の差分から求めた字幕画素重心はプレビュー `(405.52,254.84)`、OSR `(426.23,261.97)`。プレビューが左へ 20.71px、上へ 7.13px ずれた。bbox はプレビュー `[288,208,502,293]`、OSR `[304,214,517,300]`、meanDelta はそれぞれ 76.1 / 77.9。基点では段直下 caption item がプレビューに出ないため、このブランチで投影した字幕の配置問題である。

原因はプレビューの `[data-output-caption]` 規則。出力字幕のプレートを `width:92%`・`right:auto` にするため、caption item の全画面プレートを基準にした書き出し HTML と、行の水平方向の基準が違っていた。caption item と group 内の captions 袋から投影した行に `captionItemProjection` を付け、その行だけ `[data-output-caption]` を付けない。通常の出力字幕には既存の規則を残す。位置を数値で補正していない。

撮影スクリプトは、Electron の事前確認が通った後で phase の古い PNG を消す。GPU が適格性で拒否されたときは拒否理由を記録し、GPU を含む画素差を作らない。既存の `after.json` に残っていた古い GPU 比較値と GPU PNG も撤去した。さらに字幕 item だけを外した一時的な変種を GPU と OSR で撮り、`after/` に別名の 2 秒フレームと画素差を記録する。変種の純関数判定は GPU eligible、degraded 0、overlay は `duration-marker` と `html-card` の 2 件だった。実機の撮影はラッパーが再実行する。

L0: akari-preview の `npx tsc -b` 通過、字幕関連テスト 173/173 通過（新しい配置テストを含む）。edit-store の group 投影テスト 9/9、render-cut の caption/rasterize テスト 22/22 通過。後に得た r5 の実機値は冒頭の r6 節に記録した。

## r4 の修正

- group 内の caption item は段直下と同じ字幕生成器の HTML を一切書き換えずに使う。両 fixture の `caption-line` の HTML はバイト一致した。字体、既定 fade、フォントの `file:` 参照が残る。親の transform、opacity `0.5`、時間の切り取りは外側の overlay レコードに載る。宣言のない keyframes は生成しない。
- HTML の子は `expandBagOverlays` で参照文字列のまま残し、親子の opacity の積だけを `record.opacity` へ載せる。これにより断片内の相対 URL の解決元を変えない。プレビューでは `projectedOverlays` → `buildItemKeyframeSummaryFields` → `summary.overlays` と opacity が進み、`runtime.mount(summary)` 完了後の `applyOverlayTracks()` が `data-overlay-id` の一致する container に `style.opacity` を設定する。summary 更新時にも同じ関数を呼ぶ。書き出しの `renderOverlayNode()` は `overlay.opacity` を外側の inline style に設定する。断片 HTML への style 挿入は無い。
- group と段直下の caption item はともに GPU 適格判定で `degraded`。条件は `absolute-external-url`、`font-face-external-resource`、`animation-timing` で同一（`caption-eligibility-r4.json`）。`render-cut --engine auto` は OSR を選び、`--engine gpu` は適格性エラーで拒否する。単独の GPU CLI も `exportWithGpu()` の適格性ゲートで拒否し、OSR への自動フォールバックはしない。これは段直下にもある既存の制約である。

## 実機証跡

`fixture/edit.json` は group 内に写真・caption item・HTML を置き、親の `at:30`、`duration:60`、位置 `(100,45)`、拡縮 `0.65`、回転 `18°`、opacity `0.5` を宣言する。観測時刻は区間外の 0.5 秒・3.5 秒と区間中点の 2 秒である。

`after.json` と `after/*.png` は **r2 の実機結果**。r3 の失敗で JSON が上書きされたため、r2 の verification に残っていた値だけを復元し、復元元と欠けたフィールドを JSON に明記した。2 秒の `c-0001` は書き出しレコード 1 件、プレビュー DOM の描画 1 件。0.5 秒・3.5 秒はプレビュー DOM の描画 0 件。2 秒の字幕変形は `matrix(0.618187, 0.200861, -0.200861, 0.618187, 115.065, -1.36401)`、opacity `0.5`。写真は `t=1` 秒、尺 2 秒、位置 `(78.285446,27.692757)`、拡縮 `0.4875`、回転 `18°`、opacity `0.5` に投影された。

r2 の 2 秒の全画面 RGB 差（最大 / 平均）は GPU–OSR `64 / 1.103540`、GPU–プレビュー `132 / 2.862070`、OSR–プレビュー `133 / 2.829659`。当時の字幕はプレビューが約 18px 左で、字幕領域の最大輝度はプレビュー 174、GPU・OSR 187 だった。r3 の字幕 HTML 改変に依存する DOM 再現スクリプトと画像は、現行の測定として誤読しないよう撤去した。

r4 では heavy-slot を取得し、Electron の `--version` を最初に実行した。終了コードは **134（SIGABRT）**（`electron-preflight-r4.json`）。指示に従い、今回の Electron プレビュー、GPU、OSR の実機撮影は試みていない。したがって r4 AFTER の字幕中心と三経路の画素差は **未取得**。`after-r3-attempt.json` と `after-export-attempt.json` は前回の障害記録として残す。

r2 の段直下だけの 2 fixture は `regression.json` で基点との差が GPU・OSR とも最大 0・平均 0。r4 では同じ Electron 障害のため再撮影していない。すべての PNG は 500KB 以下。

## テスト（r4）

| 対象 | 結果 | 基点比較 |
|---|---:|---|
| render-cut 該当 3 ファイル | 27/27 通過 | group 字幕と段直下の HTML バイト一致、適格判定・出口選択一致 |
| render-cut 全体 | 652 件中 609 通過、43 失敗 | 同じマシンの基点 `b76f1275` は 647 件中 604 通過、43 失敗。失敗名集合は同一、新規の赤 0 |
| overlay-runtime 指定非ブラウザー 5 ファイル | 32/32 通過 | `part-mask-mount` の新規赤 0。record の opacity `0.4`、keyframes 無し |
| overlay-runtime 指定ブラウザー 4 ファイル | 47/47 通過 | 基点比の新規赤 0 |
| akari-preview `tsc -b`・全テスト | 型検査通過、1474 件中 1472 通過 | 失敗は基点と同じ `cut-size-basis` と `frame-engine-preview.test.mjs` の 2 件、新規の赤 0 |
| edit-store 全体 | 949/949 通過 | 失敗 0 |

render-cut の基点は `b76f1275` の packages と参照ファイルを専用の一時領域へ展開し、同じマシンの既設 node_modules と shell を使って実行した。比較値と失敗名は `test-comparison-r4.json` に記録した。実レンダーの失敗には、基点でも起きる OSR Electron の SIGABRT が含まれる。`cut-size-basis` は既知の生成 bundle 不足、`frame-engine-preview.test.mjs` は基点でも同じファイル単位失敗だった。

## 再実行

重い処理の前に `heavy-slot.sh acquire libcanvas-c0a`、終了後に `release libcanvas-c0a` を実行する。実機は最初に Electron の `--version` が 0 で終わることを確認してから、リポジトリ直下で `npm run build --prefix packages/edit-store`、`npm run build --prefix apps/shell`、`node evidence/c0a-group-media-render/run.mjs after`、`node evidence/c0a-group-media-render/run-regression.mjs` の順に行う。スクリプトは専用一時領域、CDP 9547、HTTP 48841 を使う。失敗した撮影は `after-attempt.json` に記録し、成功済みの `after.json` を上書きしない。

検証用に再生成した edit-store の `lib/` は最後に追跡版へ戻す。コミット、push、タスク状態ファイルの更新は行わない。証跡にローカル絶対パスは残さない。

## r6 後の実機再撮影（ラッパー）

r6 のコードで edit-store・preview-server・プレビュー拡張の frame-engine bundle と shell を再ビルドし、`run.mjs after` と `run-regression.mjs` を実行した（結果は `after.json`・`after/`・`regression.json`）。

- プレビュー 2 秒: 写真 `t=1・尺 2・(78.29,27.69)・拡縮 0.4875・回転 18°・opacity 0.5`、字幕 1 行（`captionC0001DrawCount = 1`・親の変形 `matrix(0.618187, 0.200861, -0.200861, 0.618187, 115.065, -1.364)`・opacity 0.5・全幅プレート）、HTML opacity 0.5。0.5 秒と 3.5 秒では写真・字幕・HTML とも出ない。記録された z は写真 4・字幕行 5・HTML 6（子の宣言順）
- 字幕領域（x300–520・y210–300）の輝度 p95 / p99: プレビュー `143 / 160`、OSR `138 / 158`。r5 の `105 / 132` から OSR 側にそろい、字幕が写真の上に重なる
- 段直下 caption item の同値 fixture で字幕の bbox はプレビュー `[303,214,517,299]`、OSR `[304,214,517,300]`
- OSR–プレビュー 2 秒の画素差: 最大 105・平均 2.10。差が 60 を超える画素は 345 個で、回転した写真と HTML カードの縁、字幕のグリフの縁に限られる。0.5 秒と 3.5 秒の差（最大 48・平均 0.127）はプレビュー撮影の最下行 1 行だけ
- GPU: 字幕を含む fixture は適格判定で拒否される（`overlay:caption-line:absolute-external-url, font-face-external-resource, animation-timing`。段直下の caption item と同じ既存の制約）。字幕を抜いた変種は GPU で書き出せ、GPU–OSR の差は最大 146・平均 1.86。差は HTML カードだけで、gpu-export が keyframes の無い HTML の静的 opacity を描かないため。段直下の HTML item（opacity 0.5）でも基点と現行の GPU は全不透明で描いた
- 段直下だけの既存 fixture 2 本（engine-parity・flat-overlay）: GPU・OSR とも基点との画素差 最大 0・平均 0
