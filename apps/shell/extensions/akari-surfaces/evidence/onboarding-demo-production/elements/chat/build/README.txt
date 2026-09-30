demo-chat 断片の再生成と描画確認（Windows・2026-10-01）

1. フォントの切り出し（Noto Sans JP 可変 → wght 800 / 500 の静的体 → 断片で使う文字だけ → woff2）
   python build_font.py <outDir> " AIかきけしせたてでにまるわトナパー合編話集！" 800,500
   → <outDir>/font.json（base64・unicode-range）
2. 断片の組み立て（fragment.tpl.html の @@FONT800@@ / @@FONT500@@ / @@RANGE@@ を埋める。
   build_fragment.py は font/font.json と fragment.tpl.html を作業フォルダから読む）
   python build_fragment.py <worktree>/apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/overlays/demo-chat/fragment.html
3. 描画確認（内部リポ harness/render-fragment.mjs と同じ入れ子とモーション語彙に、容器の data-akari-active・
   render-cut/src/rasterize.mjs と同じ WAAPI クローン化（--mode export）・本編フレームの背景を足したもの）
   node render-seq.mjs <fragment.html> <outDir> --start 8.5333 --times 0.05,0.4,0.8,1.45,2.0 --mode preview --bgdir <f256.png… のある dir>
4. 実書き出し: render-cut --engine osr（既定の stamp 検証のまま。AKARI_OSR_VERIFY=off だと入りが 1〜2 フレーム遅れて写る）
