# presets/textanim — テキストアニメーション語彙（v0・2026-08-03 新設）

テキスト（textstyle / 字幕）に割り当てる**動きの語彙**。旧 AKARI Video
（akari-video-on-os `src/lib/text-animation-presets.ts` の 48 種から "none" を除く 47 種）を移植した。

## スロットモデル（旧 `textAnimationAtf` と同じ）

CapCut 同様、**登場（in）/ 退場（out）/ ループ（loop）を独立指定**する:

```json
"animation": {
  "in":   { "id": "fade-up",  "duration_sec": 0.6, "ease": null, "amp": null },
  "loop": { "id": "float" },
  "out":  { "id": "fade-up",  "duration_sec": 0.6 }
}
```

- **out は in アニメのキーフレームを時間反転して使う**（旧実装の設計を踏襲。
  out 専用プリセットは持たない）
- index.jsonl の `slot` は既定の適性（`in` = 登場/退場向き・`loop` = 常時ループ向き）。
  ループ系 9 種（float / breath / neon-flicker / hologram / retro-flicker / wobble /
  news-ticker / marquee-left / crawl-up）以外は in/out 両用
- カテゴリ 10 種: 標準 / フェード / スライド / ズーム / 弾性 / 回転 / 強調 / 文字表示 / ループ / テロップ

## 実装状況

**この索引は語彙の宣言（カタログ）であり、新リポの字幕レンダラはまだ動きを実装していない**
（現行は行順送り reveal 系のみ）。実装は内部契約
（akari-video-internal planning/contract-2026-08-03-textstyle-v0.md §4）の残作業。
旧実装にはさらに ATF アニメカタログ 439 種（S01〜S30・akari-telop `src/effects/catalog/imported/`）
があり、in/loop/out スロットの上級語彙として将来接続できる（移植は未定）。
