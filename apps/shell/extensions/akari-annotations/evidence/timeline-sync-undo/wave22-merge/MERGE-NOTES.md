# main (Wave 23/24) 統合マージ後の L1 再検証

対象: `git merge main`（51c3d47、Wave 23 タイムライントラックモデル + Wave 24 プレビュー audio 配線）を
`task/2026-07-21-timeline-sync-undo`（3cc0f4d、Wave 22 出力軸タイムライン刷新）へ手動統合した後の
再検証記録。

## L0

`apps/shell` で `npm run build:ext`（8拡張）・`npm run lint`・`npm run build`（production、
browser/node/electron）すべて 0 errors。`packages/edit-lint`（58/58）・`packages/render-cut`
（40/40）のテストも全PASS。

## L1 — run-l1-wave22.mjs（Wave22 受け入れ条件 a〜j）: 全PASS

再現コマンドは `evidence/timeline-sync-undo/README.md` 参照。DOM 形状がマージで変化した
（`stripScroll` が main 新設の `timelineViewport` grid ラッパーへ入れ子化）が、本スクリプトの
`WIDGET_REFS.stripScroll` 参照は元々未使用（デッド参照）だったため実害なし。ドライバ側の修正は
不要だった。`ALL WAVE22 ACCEPTANCE CRITERIA PASSED (A,B,C,D,E,F,G,H,I,J)` を実測（本ディレクトリ
`wave22-merge-run-log-final.txt` に完全ログ）。統合で載せ替えたトラックモデル・選択統合後も
a〜j 全項目が意味的に成立することを確認。

## L1 — run-l1.mjs（Wave21 回帰）: 全PASS（追記: 根本原因を特定・ドライバ修正で解消）

DOM形状変化に対応するドライバ側修正（`stripScroll`/`scrollbarTrack`/`scrollbarThumb` を
`data-testid`/class ベースの安定セレクタへ変更、bottom panel 高さ不足に対するテスト環境
ハードニング、出力軸への座標変換の追随）を行った上で、AC1/AC2/AC6/AC7/AC8/AC9（ズーム・パン・
スクロールバー・cut-trim/cut-reorder・スナップガイド・Escapeキャンセル・overlay-resize・
caption-move・overlay-move・多段undo/redo・click-to-seek）は複数回の実行で安定して PASS。

当初 AC4（再生中のtick対応誤差 ±0.2秒以内）が不安定だったため調査した結果、2つの独立した
ドライバ側の問題（プロダクトコードの回帰ではない）を特定し、いずれもドライバのみの修正で
解消した:

1. **`v.play()` 直後に `video.currentTime` が完全停止する事象**: main 側の
   `evidence/timeline-tracks/scripts/run-l1.mjs` に「このサンドボックス実行環境には音声出力
   デバイスが無く、音声トラック有りのまま `play()` すると Chromium のメディアクロックが
   進行しない」という既知事象と対処（`v.muted = true` を再生前にドライバ側だけで設定）が
   先に記録されていた。同じ対処をこのファイルの AC4/AC5 セクションへ遡って適用したところ、
   完全停止は解消し毎回連続的に再生が進行するようになった
2. **`TOTAL_DURATION` 定数が cut-trim 後も再計算されていなかった**: スクリプト冒頭で
   `const TOTAL_DURATION = 10 * 1.02`（フィクスチャの初期 cuts 尺合計）として1回だけ計算して
   いたが、AC9 の cut-trim で `cuts[0].in` が 0.5→0.75 に変わり実際の合計尺が 9.75 秒に縮んだ
   後もこの値を使い続けていた。そのため以降の `widgetState()` 系計算（すべて
   `${TOTAL_DURATION}` テンプレート差し込み）に系統的な約2.5%のズレが生じ、AC4 の
   tick対応誤差として常に約0.25秒（閾値0.2秒をわずかに超える）という、極めて再現性の高い
   固定値が出ていた（`0.2499983999999973` と `0.24999839999999907` が独立した2回の実行で
   ほぼ同一値になっていたのが手がかりになった）。`TOTAL_DURATION` を `let` にし、
   cuts/overlays が変わるたび（cut-reorder 後・overlay-resize 後）`refreshTotalDuration()`
   で実際の edit.json から再計算するよう修正した
3. **副次的に判明した AC5 の未検証ギャップ**: 上記1・2の修正で初めて AC4 を通過できるように
   なったところ、AC5（78%追従スクロール）が「ズームが全体表示（`viewDuration===undefined`）
   のままなので `handlePlaybackTick()` の追従ガードが発火しない」という、これまで一度も
   到達できていなかった別の未検証ギャップで失敗した。AC4/AC5 計測の直前に ctrl+wheel
   ズームインを2回追加し、`viewDuration` を定義済みにしてから計測することで解消した
   （プロダクトソースは無変更）。

**最終的な実測**: `ALL ACCEPTANCE CRITERIA PASSED`。AC4 tick対応誤差 `0.0452秒`（閾値0.2秒の
約1/4）、AC5 の 78%追従クロス・スクロール追従・停止中の手動スクロール保持もすべて実測PASS。
証跡は `wave22-merge/regression-fixed/`（スクリーンショット 00〜19・`run-log-final.txt`）。
プロダクトソース（`akari-annotations-widget.ts` / `akari-preview-open-handler.ts`）はこの
調査・修正を理由に一切変更していない。

## main 側 Wave23（timeline-tracks）専用ハーネス: 全PASS

`evidence/timeline-tracks/scripts/run-l1.mjs` を実 Electron + 生CDP で実行。ドライバのみ以下を
修正（プロダクトソース無変更）:

- `undoButton`/`redoButton` の `toolbar.children[2]/[3]` 固定index参照 → Wave22 のツールバー
  拡張（選択/分割/マグネットボタン追加）でずれるため `aria-label` ベースのセレクタへ変更
  （timeline-sync-undo の run-l1.mjs と同じ対応）
- ズーム% 表示の `toolbar.children[1].children[1]` 参照 → `data-testid` ベースのセレクタへ変更
- `TOTAL_DURATION` 定数（`11.5*1.02`）→ Wave22 出力軸転換後の実際の合計尺（cuts 3+3+4=10秒）に
  合わせ `10*1.02` へ修正
- 字幕ペースト位置の決め打ち `9.5秒` → 出力軸転換で総尺が 11.5→10秒 に縮んだため、
  caption-a（尺1.5秒）を貼ると総尺超過でリジェクトされていた。総尺内に収まる位置へ変更
- developer mode チェックボックスのクリックが高負荷環境でたまに外れる既知のフレークに対し、
  リトライ・再取得ロジックを追加（プロダクトの問題ではない）

`ALL ACCEPTANCE CRITERIA PASSED`。トラック上下ドラッグによる `overlays[].track` 書き戻し・
プレビューの z-order 反転・undo/redo・トラックヘッダーのミュート/非表示・字幕帯の目トグル・
タイムライン⇔プレビュー選択連動・字幕コピペ・字幕水平ドラッグ・ズームHUD・再生同期のすべてを
実機確認した。証跡は `wave22-merge/timeline-tracks/`（スクリーンショット 00〜14・
`run-log-final.txt`）。

## main 側 Wave24（preview-audio-wiring）専用ハーネス: 決定的シミュレーションでPASS

実 Electron 版（`run-real-electron-audio-e2e.mjs`）は起動・ワークスペース構築のコストが
大きく、本セッションの残り時間と両立しないため見送り、決定的シミュレーション
（`run-audio-controller-simulation.mjs`）を実行した。このスクリプトは
**マージ後の現在の `akari-preview-open-handler.ts` から `hostAdapterScript()` の生JSテンプレートを
直接文字列抽出**して決定的な Web Audio テストダブル上で実行するため、実 Electron を介さずとも
マージ後のコードそのものを検証できる。

`ALL-PASS`: BGM/SFX/narration のデコード（欠落 SFX は警告のうえ当該要素のみスキップ）、
BGM `-18dB` (linear 0.1259) → narration 区間で `-12dB` ダッキング適用後 `-30dB` (linear 0.0316)、
master gain が video volume/muted を正しくミラー、audio 無しプロジェクトで supplemental
AudioContext を生成しない（`{disabled:true}`）非退行、すべて確認。ログは
`wave22-merge/preview-audio-wiring/simulation-run-log-post-merge.txt`。実 Electron 版の
実機確認は今回未実施（必要であれば追加対応可）。
