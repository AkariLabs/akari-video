# 出力プレビューの選択の食い違い — L1 証跡（task 2026-09-26-preview-selection-sync）

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動。`--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME` は本票専用の一時ディレクトリ（名前に `preview-selection-sync` を含む）、CDP ポート 9624（`scripts/relaunch.sh`）
- fixture（`scripts/gen-fixture.mjs`、1280×720・12 秒）
  - `sel`: 0〜3 秒に 字幕 c-0001・置いた文字 c-0003（time_domain output）・写真 photo-a-item・HTML html-a-item・図形 shape-a、5〜9 秒に c-0002(5-8)・c-0004(5-8)・photo-b-item・html-b-item・shape-b
  - `z-plain` / `z-group` / `z-multi`: V7 に図形 shape-z（x 700〜1180）、上の V8 に B ロール（中央 50% = x 320〜960）。`z-group` は group の中に字幕、`z-multi` は本編 2 カットが 5〜7 秒でディゾルブ
- 選択状態の読み方（`scripts/pss.mjs`）: webview の closure 変数（`selectedCaptionId` / `requestedOverlayId` / `requestedCutId` / `selectedLayerId` / `cutSelected`）を Debugger の条件付きブレークポイント（常に false を返す logpoint）で `window.__pssState` へ写す。`window.akari.report*` をラップしてホストへの通知を、host→webview の message を、`window.akari.interaction.selectedId` を、タイムラインのチップの selected クラスを同時に記録
- 手順: (a) `scripts/scenario-a.mjs`（1 秒で素材を動かす → 6 秒へ → 6 秒の別の素材をクリック、11 通り。`scripts/run-a-matrix.sh`）/ (b) `scripts/scenario-b.mjs`（6 秒でタイムラインから範囲外の素材を選ぶ → 写真 B の位置をクリック）・`scripts/scenario-b2.mjs`（範囲内・Shift/Cmd の追加・再生中・矩形選択・undo）/ (c) `scripts/scenario-c.mjs`（タイムラインで shape-z を選び、見えている部分を掴んでドラッグ。前・中・離した直後・書き込み後・選択解除後の z とスクリーンショット）
- 書き出し: `render-cut <project> --engine osr`（`AKARI_EXPORT_ALLOW_DESKTOP=0`、`provenance.osr.launcher_tier: 2`）の 3 秒のフレーム（`export/`）。図形の HTML は `http://`（svg の xmlns）を含むため GPU 書き出しは `absolute-external-url` で不適格

## BEFORE（基点 e2a5eaf34）— 手順 0 で特定した原因

`before/findings.md` に全表。要点:

| 症状 | 実測 | 原因 |
|---|---|---|
| (1) 字幕 / 置いた文字を動かして 6 秒へ → 写真をクリックしても選べない | `before/a-caption-photo.json`・`a-placed-photo.json`: シーク後も `selectedCaptionId="c-0001"`、クリックは `reportCaptionSelection(null)` だけ（解除として消費）。見えていない字幕が選ばれていると写真のドラッグも効かない | 仮説 1-1 を確認（`isSelectionReleaseTarget` が `selectedCaptionId` だけで true） |
| (1) 字幕を選んだまま図形 / HTML をクリック | `before/a-caption-shape.json`: タイムラインに c-0001 と shape-b が両方選択で残る | 字幕の解除がホストへ通知されない |
| (1) 図形 / HTML を選んで範囲外へ | `before/a-shape-photo.json`: `requestedOverlayId="shape-a"` が残り、IX は通知なしで解除、タイムラインは shape-a のまま | 仮説 1-2・1-4 を確認。仮説 1-5（空白の null が後着でメディア選択を打ち消す）は再現せず |
| (2) タイムラインで範囲外を選ぶ | `before/b-*.json`: 再生位置 6 のまま、枠なし。字幕 / 置いた文字はその後の写真クリックを食う | 範囲外の選択時にシークしない |
| (3) V7 図形が V8 B ロールの上に出る | `before/c-group.json` / `c-group-strip.png`: group の中に字幕があると図形 overlay z=8・B ロールの media plane z=7（ドラッグ前・中・後とも同じ）。字幕なし（`c-plain`）・複数 cut（`c-multi`）・B ロールが動画（`c-z-vplain` / `c-z-vmulti`）は正しい | 候補 a（z の尺度の食い違い）を確認。ドラッグ中に z を上げる処理は無い。候補 b は本編が V1 の構成では再現せず |

## AFTER（最終ビルド = ブランチの実装コミット）

| 観測 | 記録 | 結果 |
|---|---|---|
| (a) 11 通り（字幕・置いた文字・図形・写真・HTML を動かして 6 秒へ → 別の素材をクリック） | `after/a-*.json`・`after/a-caption-photo-*.png` | 全て **クリック 1 回で選べる**。タイムラインの選択も 1 つに揃う。字幕 / 置いた文字はシークで解除・通知される |
| (b) 6 秒でタイムラインから範囲外の c-0001 / c-0003 / shape-a / photo-a-item / html-a-item を選ぶ | `after/b-*.json`・`after/b-c-0001-1-timeline-select.png` | 再生位置が **0 秒（範囲の先頭）へ移り、枠が出る** |
| 範囲内（1 秒で shape-a） | `after/b2-conditions.json` #1 | 1 秒のまま |
| Shift / Cmd で範囲外 shape-a を足す | 同 #3 | 6 秒のまま（選択は 2 つ） |
| 再生中に範囲外の c-0001 を選ぶ | 同 #4 | 飛ばない（9.2 秒）・選択は残る |
| 矩形選択（photo-a-item だけを囲む） | 同 #5 | 6 秒のまま |
| undo（Cmd+Z / 元に戻す） | 同 #6 | 6 秒のまま |
| (c) group 字幕あり | `after/c-z-group.json`・`after/c-group-strip.png` | B ロールの media plane z=10 > 図形 z=8。ドラッグ前・中・後とも **B ロールの下** |
| (c) group 字幕なし / 複数 cut | `after/c-z-plain.json`・`after/c-z-multi.json` | 図形 6 < 面 7 のまま（変化なし） |

## 未達・既知の問題（ラッパーの実機検証で検出。codex 3 往復を使い切ったため未修正）

1. **回帰**: 写真（photo-a-item）を選んだ状態で、見えている本編（cut）のうち「今は見えていない写真 B / 図形 B の矩形」に当たる位置（例: 出力 (450,420)・(220,420)・(120,480)）をクリックすると何も選ばれない（本編が選べない）。(700,500) のように他の素材の矩形に当たらない位置は選べる。基点のビルド（本票の src 4 ファイルを基点へ戻して再ビルド）では同じ手順で本編が選べる。ログポイントでは `handleVisualMediaPointerDown` が `shouldStartPreviewMarquee` で return しており（メディアの当たりが null → 空のマーキー → 解除だけ）、見えていない素材の矩形でメディアの当たり判定が失われている
2. 図形 / HTML / 写真を**ドラッグで動かした（書き込み・再読込を伴う）後**に範囲外へシークすると、その選択が解除されない（`after/a-shape-photo.json` 等の `t6-after-seek`: `requestedOverlayId="shape-a"`・タイムライン shape-a）。プレビューとタイムラインは揃っており、次のクリックも 1 回で選べる。クリックだけで選んだ場合は解除・通知される。書き込み後の再読込で「見えていた」記録が失われている見込み
3. 書き出し（OSR）は frame-engine の canvas を z-index 0、HTML オーバーレイ（図形を含む）を z-index 1 に置くため、トラックの順に関係なく図形が写真・動画の上に描かれる（`export/z-plain-export-3s.png`・`export/z-group-export-3s.png`）。プレビューはトラックの順（オブジェクトツリー契約 §4 = 上の段ほど手前）に揃えたので、この構成ではプレビューと書き出しが食い違う。書き出し側（`packages/osr-export`）は本票のファイル境界の外
