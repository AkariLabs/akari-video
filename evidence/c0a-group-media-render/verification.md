# group 内の描画検証

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
