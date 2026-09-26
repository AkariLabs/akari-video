# 生成中オーロラ — 実機証跡

すべて一時プロジェクトとスタブで撮影した。画像生成・読み上げの実サービス、有償 API は呼んでいない。Electron は CDP 9634、専用 userData・設定・ホームで起動し、撮影スクリプトが起動した PID だけを終了する。

## 撮影手順

BEFORE は変更前の `HEAD` を別の一時ツリーへ展開してビルドした。リポジトリのコードは戻していない。下記はリポジトリ直下から実行する。`BEFORE` は他の作業と重ならない一時ディレクトリ名にする。

```sh
BEFORE="$(node -p "require('node:path').join(require('node:path').sep,'tmp','gen-progress-aurora-before-src')")"
mkdir -p "$BEFORE"
git archive HEAD | tar -x -C "$BEFORE"
cp -c -R node_modules "$BEFORE/node_modules"
cp -c -R apps/shell/node_modules "$BEFORE/apps/shell/node_modules"
(cd "$BEFORE/apps/shell" && npm run build)
GEN_PROGRESS_SHELL="$BEFORE/apps/shell" node apps/shell/extensions/akari-annotations/evidence/gen-progress-aurora/scripts/capture.mjs --before --port=9634
BEFORE="$BEFORE" node -e "require('node:fs').rmSync(process.env.BEFORE,{recursive:true,force:true})"
```

AFTER は変更後のシェルをビルドし、同じ空の枠を選択して「編集 → 静止画 → 作る」を UI から実行する。成功時の差し替えと undo もアプリの操作。音の枠は「編集」にナレーションタイルが出なかったため、起動中アプリのフロントから `AkariAnnotationsService.generateNarration` を RPC 呼び出しした。偽エンジンは `AKARI_GENERATE_CLI` に指定する。動画の 42% は一時プロジェクトの meta を撮影スクリプトが設定した。サムネイル上の半透明オーロラは同じ映像クリップを 3 秒差で撮り、位置の変化を確認する。

```sh
(cd apps/shell && npm run build)
node apps/shell/extensions/akari-annotations/evidence/gen-progress-aurora/scripts/capture.mjs --port=9634
node apps/shell/extensions/akari-annotations/evidence/gen-progress-aurora/scripts/export-zero-px.mjs
```

## ファイル

- `before-planned.png` / `before-generating.png`: 変更前の全体画面。生成中もタイムラインとプレビューは planned のまま。
- `after-planned.png` / `after-generating.png` / `after-done.png` / `after-failed.png` / `after-audio-generating.png` / `after-video-generating.png`: 変更後の状態別の全体画面。planned は生成開始前に撮影した。
- 各状態の `-timeline-2x.png` / `-preview-2x.png`: `Page.captureScreenshot` の `clip` と `scale: 2` で撮った該当クリップ周辺。
- `after-generating-timeline-2x-t3.png`: `after-generating-timeline-2x.png` と同じ枠を約 3 秒後に撮ったもの。サムネイル上のオーロラが藍から紫の位置へ移る。
- `after-reduced-motion.png`: `prefers-reduced-motion: reduce` での生成中。
- `after-undo.png`: 静止画を差し替えたあと、アプリの undo で元の枠へ戻した画面。
- `before-results.json`: 変更前の UI 操作とプレビュー描画確認。
- `visual-after.json`: UI 操作結果、3 秒間の同一ノード秒数更新とオーロラの background-position 変化、動きを減らす設定の animation-name、元 meta の復元、音声 RPC の開始・完了、動画の 42% と進捗バー。
- `export-before-frame-210.png` / `export-generating-frame-210.png` / `export-pixels.json`: OSR で同じフレームを書き出した画素比較。
- `scripts/`: 一時 fixture、偽 Codex app-server、偽読み上げ CLI、Electron/CDP 撮影と OSR 比較の手順。
