# review-board — L1 実機検証（2026-07-24）

タスク: `2026-07-24-review-board`（レビューボード — かんばん UI + コンパイル導線）

## 検証方法

- Electron v39.8.7（darwin-arm64）を実起動し、`playwright-core` の CDP 接続で実 UI 操作
  （クリック・キーボード・コマンドパレット）を駆動
- 隔離ワークスペース: `templates/project-default/` 相当の構成に、ffmpeg 生成の 20 秒
  testsrc+sine mp4（`source.mp4`）+ 2 カット構成 `edit.json`（source 0-8s / 10-18s、
  合成タイムライン長 16s）+ 4 チケットの `review.json`（open×2・addressed×1・resolved×1、
  `[要確認]`/confidence/strokes バッジを網羅する組み合わせ）を用意
- ホーム画面が「AI パートナーと接続」を要求するため、ボードはコマンドパレット
  （`Cmd+Shift+P` → 「レビューボードを開く」）経由で開いた（メニュー登録済みの同一コマンド）
- 出力プレビューの実シーク値は、入れ子 webview（`webview.localhost` origin →
  `active-frame`）に対し CDP `Page.getFrameTree` + `Runtime.executionContextCreated` の
  `auxData.frameId` 突き合わせで実行コンテキストを特定し、`Runtime.evaluate` で
  `document.querySelector('video').currentTime` を直接読んで実測（verify skill L1 節の手法）

## スクリーンショット

1. `01-board-open-fixture-*.png` — フィクスチャでボードタブを開いた直後。依頼中 2 /
   AI 対応済み 1 / 完了 1。`[要確認]`・confidence バッジ・✏️ バッジ・サムネイル
   （ffmpeg 実フレーム、コマ番号が sourceT と一致）を確認
2. `02-card-click-opens-and-seeks-*.png` — 依頼中カード（strokes なし）をクリック →
   出力プレビューのタブが自動で開き、実測 `video.currentTime === 3`
   （sourceT 3.0 と一致。cut0 は source/output 恒等写像のため）
3. `03-resolve-gate-*.png` — AI 対応済みカードの「完了にする」→ review.json が
   機械確認で `resolved` に書き変わり（バイト読み直しで確認）、カードが完了列へ移動。
   依頼中列に addressed 化の操作が存在しないことを DOM で確認（`data-board-resolve`
   属性が addressed 列以外に 0 個）
4. `04-live-update-*.png` — アプリ実行中に review.json を外部から直接書き換え
   （新規チケット追加）→ 監視経路（タイムライン widget の `fileService.watch` +
   `ReviewModel`）に相乗りしたボードが約 2〜3 秒でライブ反映
5. `05-review-json-missing-*.png` — review.json を削除 → 空ボード（0/0/0）、
   warning 無し、クラッシュ無し
6. `06-review-json-corrupt-*.png` — review.json を不正 JSON で上書き → warning
   バナーのみ表示（`レビューデータを読み取れません: ...`）、他機能に影響なし
7. `07-compile-button-*.png` — 注釈パネルの録音セクション「コンパイル」ボタン →
   `review セッション s-0001 をコンパイルして` をクリップボードへコピー
   （`navigator.clipboard.readText()` で実測確認）+ `akari.partner.beginOnboarding`
   実行（未接続時は推奨導線を開始 = パートナーペインへのフォーカスと同義。接続済みなら
   `shell.activateWidget` のみでフォーカスだけになる実装は `akari-partner-widget.tsx`
   の `beginRecommended()` で確認済み・未編集）
8. `08-real-data-selection-dogfood-*.png` — 実プロジェクト
   `~/Movies/AkariVideo/selection-dogfood` を開いた状態。実チケット 3 枚
   （open 1・addressed 2・resolved 0 — review.json の実データと一致）が正しい列・
   バッジ・実サムネイル（実撮素材のフレーム）で表示。閲覧後に `git status --porcelain`
   と主要ファイルの sha256 が閲覧前と完全一致することを確認済み（無改変）

## 発見した既存不具合（本タスクのファイル境界外・修正せず報告のみ）

`REVIEW_ANNOTATION_SHOW_STROKES_EVENT`（`akari.review.annotation.showStrokes`）の
ハンドラ `showReviewAnnotationStrokes`
（`apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts:757-772`、
S3 で実装済み・本タスクでは編集禁止ファイル）は、
`widget.sendMessage({ type: 'akari-preview-seek', time: detail.sourceT })` と
**source 秒を無変換のまま output/composition 秒として送出している**。

同じ `akari-preview-seek` メッセージを送る `seekOutputPreview`
（`akari.preview.seekOutput` コマンド。同ファイル 946-990 行、
タイムライン widget の `sourceToOutput()` で cuts 変換済みの値を渡す）とは非対称であり、
cuts が非自明な写像を持つ（先頭カット以外・トリムあり）場合、ストローク静止表示は
**実際に描かれた source フレームとは異なるフレームを表示してしまう**（本 L1 検証の
フィクスチャで実測: `a-0003` の `strokes[0].frame.sourceT=12`・`cutIndex=1` を
クリックすると `video.currentTime` は 14 になり、意図した 12 ではなかった。
`cutIndex=1`（cut1: source[10,18] / timeline[8,16]）の場合、正しい output 秒は
`8 + (12-10) = 10` のはずだが、実装は sourceT=12 を output 秒として解釈し、
逆算で source 14 にシークしている）。

本タスクのボード（`akari-review-board-widget.ts`）は既存の ✏️ ボタン
（`akari-review-panel-widget.ts`）と**全く同じ event detail 形状**で dispatch しており、
この不具合はボード固有ではなく既存 S3 機能に既に存在するもの。ファイル境界
（`akari-preview/**` 編集禁止）のため本タスクでは修正しない。次段で
`showReviewAnnotationStrokes` 側に source→output 変換（`sourceToOutput` 相当）を
追加する契約が必要。
