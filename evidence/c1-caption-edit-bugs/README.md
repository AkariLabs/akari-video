# 字幕のプレビュー編集 — 実機の記録

`run-l1.mjs` は合成プロジェクト（1920×1080、30 fps、字幕 5 件、図形、写真）を作り、Electron を CDP で操作する。座標はプレビュー webview の CSS px。基点は専用の一時 worktree でビルドした。[BEFORE の測定](before/before-v2-final.json)と[最終 AFTER の測定](after/after-v3-final.json)に、字幕の中心・4 隅、枠の 4 隅、つまみ、再生位置、ファイル差分と書き込み通知を保存した。

回転した幅操作の固定辺は、右つまみなら左上 `corners[0]` と左下 `corners[3]`、左つまみなら右上 `corners[1]` と右下 `corners[2]` で測る。`geometry` は固定する上角の x・y 移動と、移動後の辺の 2 隅から元の辺の直線への垂直距離を、ドラッグ中・確定後の両方で記録する。

## BEFORE / AFTER

| 操作・測定 | BEFORE | AFTER |
|---|---:|---:|
| c-0003、30°、右つまみの縮小 | 2→5 行、固定角の移動 **142.591 px**、元の辺から **66.740 px** | 2→5 行、固定角の移動 **0.015 px**、元の辺から最大 **0.010 px** |
| c-0003、30°、左つまみの縮小 | 未採取 | 2→5 行、固定角の移動 **0.001 px 未満**、元の辺から最大 **0.001 px 未満** |
| c-0004、scale 1.6、右つまみの縮小 | 3→3 行、固定角の移動 68.591 px、元の辺から 33.366 px | 3→5 行、固定角の移動 **0.008 px**、元の辺から最大 **0.006 px** |
| c-0004、scale 1.6、左つまみの縮小 | 3→3 行、固定角の移動 68.591 px、元の辺から 33.366 px | 3→5 行、固定角の移動 **0.009 px**、元の辺から最大 **0.008 px** |
| 幅操作の確定と undo | `edit.json`・`captions.json` 各 1 通知、undo 1 回で元へ | 同左。scale 1.6 の幅は 36→20.94%、30° の右は 36→14.92%、左は 36→14.91% |
| 通常字幕の右・左つまみ | 固定角の移動 0.004 px、元の辺から 0 px | 同左。右の幅 36→63.11%、左は 36→22.45% |
| 30° の字幕と選択枠の対応する四隅の最大距離 | **59.761 px** | **0.015 px** |
| c-0001、自動折り返しの編集前→編集中→1 文字追加中→確定後→選択解除後 | **3→2→2→3→3 行** | **3→3→3→3→3 行** |
| c-0001、1 文字追加後の `captions.json` 本文 | `\n` 無し、書き込み 1 回 | **`\n` 無し**、書き込み 1 回 |
| c-0005、テンプレ＋runs と保存済み `\n`、編集前→初回→再編集→選択解除 | 2→2→2→2 行、run 2 件 | 同左 |
| 入力中の左右キー（開始 4.000 秒） | 左で 3.967 秒、右で 4.000 秒 | 左右とも 4.000 秒（0 コマ） |
| 入力外の右キー | 4.000→4.033 秒 | 同左 |
| c-0002、Shift+Enter で行を追加 | Shift+Enter で編集終了、保存済みの 2 行のまま | 入力後・確定後・再編集後・選択解除後すべて 3 行、`captions.json` 1 回 |
| OSR の字幕画像（0.8 秒） | SHA-256 `ce5f9db69fd057900d6f2915703e506aae319ba40194844cc533ea1d37604f7b` | **同一ハッシュ** |

差し戻し時の 30° 右つまみでは、左上の角が x に +6.99 px 動き、元の辺から約 6.05 px 離れていた。最終測定では固定角の x・y 移動がそれぞれ −0.015 / +0.005 px、辺からの距離は最大 0.010 px。行数が増えても回った枠の反対辺の直線を維持した。

通常字幕のインスペクター表示は幅 36→63.1%、保存値は 36→63.11%（表示桁の差）。両 JSON の `results.width.fileDiff` に `edit.json` と `captions.json` の差分があり、`edit.json` は通知 1 回でも JSON 値の差分は空。字幕の幅・位置は `captions.json` の `text_style` へ 1 回で記録された。

## 回帰

| 対象 | BEFORE / AFTER |
|---|---|
| 図形のつまみ | 左上ずれ (0, 0) px、41.5×27.7→66.2×44.1 px、`edit.json` 1 回、undo 1 回 |
| 写真のプレビュー選択 | 両方でインスペクターが `photo.png` を表示。AFTER は完全版の通しで確認 |
| 字幕の大きさ | 入力中 38→110 px、確定後も 110 px |
| 字幕の行間 | 入力中 53.96→70.3 px、確定後も 70.3 px |
| 字幕の字間 | 入力中 `normal`→9.12 px、確定後も 9.12 px |

字幕の 3 スライダーは各操作の確定で `captions.json` 1 回、undo 1 回で元へ戻った。写真と図形の BEFORE は[別起動の測定](before/before-v2-regression.json)、AFTER は[完全版の `results.regression`](after/after-v3-final.json)。ライブ値は両完全版の `results.caption-live` にある。

スクリーンショット: [BEFORE の編集中の折り返し](before/before-v2-final-reopen-wrap.png)・[テンプレ＋runs](before/before-v2-final-styled-newline-reopen.png)・[scale 1.6](before/before-v2-final-scaled-right-narrow-during.png)・[30° 右](before/before-v2-final-rotated-narrow-during.png)・[OSR](before/before-v2-osr-osr.png)。[AFTER の編集中の折り返し](after/after-v3-final-reopen-wrap.png)・[テンプレ＋runs](after/after-v3-final-styled-newline-reopen.png)・[scale 1.6](after/after-v3-final-scaled-right-narrow-during.png)・[30° 右](after/after-v3-final-rotated-narrow-during.png)・[30° 左](after/after-v3-final-rotated-left-narrow-during.png)・[OSR](after/after-v3-final-osr.png)。

その他の AFTER スクリーンショット: [全体](after/after-v3-final-window.png)・[幅の操作中](after/after-v3-final-width-during.png)・[幅の確定後](after/after-v3-final-width-after.png)・[左の幅](after/after-v3-final-width-left-during.png)・[入力中のキー](after/after-v3-final-keys-editing.png)・[改行の再編集](after/after-v3-final-newline-reopen.png)・[自動折り返しの確定後](after/after-v3-final-soft-wrap-edit.png)・[回転枠](after/after-v3-final-rotated.png)・[scale 1.6 の左つまみ](after/after-v3-final-scaled-left-narrow-during.png)・[写真と図形](after/after-v3-final-regression.png)・[大きさ](after/after-v3-final-live-caption-size.png)・[行間](after/after-v3-final-live-caption-line-height.png)・[字間](after/after-v3-final-live-caption-letter-spacing.png)。

## L0

- `npm run build`・`npm run lint`: 成功。
- `akari-preview`: 1,637/1,637 件成功。
- `akari-annotations`: vendored `ffprobe` が無い環境で実行できない `timeline-frame-audio-rpc` を除き、2,512/2,512 件成功。
- `overlay-runtime`: 255/255 件成功。
