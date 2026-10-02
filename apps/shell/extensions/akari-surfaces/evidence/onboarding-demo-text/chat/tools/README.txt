demo-chat 断片の作り直し（文字の大きさ）の再生成と確認（Windows・2026-10-01）

作業フォルダは C:/t/chat-text（スクラッチ）。道具の中の絶対パスはそこを指している。

1. 断片の組み立て（雛形の本文から使う文字を集め、Noto Sans JP 可変 → wght 800 の静的体 → その文字だけ → woff2 を埋める）
   python build.py fragment.tpl.html <worktree>/apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/overlays/demo-chat/fragment.html
   （head.modified を保持するので、同じ入力なら同じバイト列になる）
2. 本編フレームの背景: ffmpeg -i clip.mp4 -vf "select='between(n\,250\,335)'" -fps_mode passthrough -start_number 250 bg/f%d.png
3. 描画確認
   - 静的 base: node render-fragment.win.mjs <fragment.html> out.png --size 1280x720 --backdrop none
     （内部リポ harness/render-fragment.mjs の require / Chrome / file URL だけを Windows に直した写し）
   - 動き: node render-seq.mjs <fragment.html> <outDir> --start 8.5333 --times <ローカル秒,...> --mode preview|export
     [--bgdir bg] [--transparent] [--scale 0.5]
     （--scale 0.5 はアプリのプレビュー枠と同じく舞台を DOM で縮めて 640×360 で撮る）
   - 要素の箱: node dom-rects.mjs <fragment.html> dom-rects.json
4. 測る: python measure.py（全 73 フレームの透過描画から 最初に見えるフレーム・外接矩形・かぶり・プレビュー/書き出し経路の一致）
         python measure-export.py gpu|osr（render-cut の書き出し mp4 を本編フレームとの差で）
5. 実書き出し: 隔離プロジェクトで edit-lint → render-cut --engine auto（gpu）/ --engine osr
6. lint: node lint.mjs（packages/edit-lint の lintProject。隔離プロジェクトにこの断片 1 件）
