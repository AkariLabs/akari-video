demo-diagram 断片（図解「この動画の中身」）の再生成と確認（Windows・2026-10-01）

作業ツリーの直下で:
1. 生成（実データの読み込み → フォントの切り出し → テンプレートへの流し込み）
   python apps/shell/extensions/akari-surfaces/evidence/onboarding-demo-production/elements/diagram/build/build_diagram.py \
     --data-json apps/shell/extensions/akari-surfaces/evidence/onboarding-demo-production/elements/diagram/diagram-data.json
   読むもの: src/node/onboarding-service.ts（DEMO_PLAN の demo-stage / demo-sfx / onboarding-bgm）、plan.json（sfx_sources の音の頭）、
   analysis/word-timing.json（字幕 22 行）、transcript.json（カラオケの区切り直し）、bgm.m4a（波形）、assets/font/noto-sans-jp。
   出力: apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/overlays/demo-diagram/fragment.html（同じ入力なら同じバイト）
   お手本のデータ（テロップ・効果音の at、字幕の時刻、BGM の keyframes）が変わったら、これを流し直せば図解も追随する。
2. 描画（本編のコマ f<n>.png を背景に。ffmpeg で clip.mp4 から -ss 22.9 -start_number 687 で切り出したもの）
   node build/render-seq.mjs <fragment.html> <outDir> --start 23.2333 --frames 694:810 --bgdir <bg> --prefix p
   node build/render-seq.mjs <fragment.html> <outDir> --start 23.2333 --frames 694:810 --transparent --prefix a
   node build/render-seq.mjs <fragment.html> <outDir> --start 23.2333 --times 1.967 --bgdir <bg> --static   # base の見た目
3. 実測
   python build/measure.py <transparent-dir> <out.json>                      # 語頭との差・置き場所（ハーネス）
   python build/measure_export.py <export-frames> <bg> <harness-dir> <out.json>   # 書き出しの語頭との差・パリティ
4. 書き出し: render-cut <隔離プロジェクト> --engine osr / --engine gpu（AKARI_EXPORT_ALLOW_DESKTOP=0、AKARI_HOME・TMP 隔離、空の作業フォルダ）
