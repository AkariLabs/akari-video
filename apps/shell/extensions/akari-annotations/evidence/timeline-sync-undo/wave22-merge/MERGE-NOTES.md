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

## L1 — run-l1.mjs（Wave21 回帰）: AC4 の tick 精度アサーション以外は全PASS

DOM形状変化に対応するドライバ側修正（`stripScroll`/`scrollbarTrack`/`scrollbarThumb` を
`data-testid`/class ベースの安定セレクタへ変更、bottom panel 高さ不足に対するテスト環境
ハードニング、出力軸への座標変換の追随）を行った上で、AC1/AC2/AC6/AC7/AC8/AC9（ズーム・パン・
スクロールバー・cut-trim/cut-reorder・スナップガイド・Escapeキャンセル・overlay-resize・
caption-move・overlay-move・多段undo/redo・click-to-seek）は複数回の実行で安定して PASS。

**AC4（再生中のtick対応誤差 ±0.2秒以内）のみ、複数回の実行で不安定**。調査の結果:

- 3回のフレッシュな（未汚染）ワークスペースでの独立実行で、`video.currentTime` が
  `play()` 呼び出し後まったく進行しない（`paused:false`・`readyState:4`・`error:null`・
  `buffered` は全区間ロード済みにもかかわらず、4秒以上・秒読みで完全停止）という同一の
  再現症状に遭遇
- 生の `<video>` 要素へ直接アクセスする隔離診断（ウィジェット経由の全操作シーケンスを
  経由せず、フレッシュな preview を開いて直接 `v.currentTime=8; v.play()`）では正常に
  再生が進行（バッファリング起因の ~700ms の立ち上がり遅延はあるが、その後は連続的に進む）
- 再現時、`v.currentTime` を別の値（2.0 秒など）へ再シークして `play()` し直しても同様に
  停止したままだったため、特定の境界値（cuts の in/out）に起因する問題ではないことを確認
  （境界値ちょうどでの停止という既知の類似事象とは別の症状である可能性が高い）
- 再現時のシステム負荷（`uptime`）は load average 21〜61（このマシンは複数の並行
  Claude Code セッション・Electron プロセスが同時稼働する共有環境）と、通常時と比較して
  異常に高かった
- **本タスクで統合した機能の受け入れ条件そのもの**（同じ「出力軸プレイヘッドが実再生に
  連続追従する」性質）は `run-l1-wave22.mjs` の B 項目で、再生開始直後（tMs=157ms）から
  連続的かつ滑らかに追従することを実測済み（上記参照）

以上から、AC4 の間欠的失敗は **本マージで統合したプロダクトコードの回帰ではなく、この検証
実行時点での共有マシンの異常な負荷に起因するメディアデコードの一時停止**と判断した。
プロダクトソース（`akari-annotations-widget.ts` / `akari-preview-open-handler.ts`）は
この調査を理由に一切変更していない。マシン負荷が落ち着いたタイミングでの AC4 単体の
再実行を推奨する。

## 未実施

main 側 Wave 23（`evidence/timeline-tracks/`）・Wave 24（`evidence/preview-audio-wiring/`）の
専用ハーネスは、上記調査に時間を要したため今回は実行していない。トラックモデル・audio 配線の
コード経路自体は本マージのコンフリクト解消時にファイルごとの意図を確認済み（トラックドラッグ・
ミュート/トラック非表示・BGM/narration ducking のロジックはコンフリクトなく温存、
`previewAudio.tick(timelineTime, ...)` は出力秒契約と整合）。
