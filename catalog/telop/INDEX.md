# Telop カタログ（ATF テロップテンプレート）

旧 `akari-telop`（ATF v0.2・`src/samples/wave3` + `wave3b`）から全件機械移植したテロップ
テンプレート 235 件です。`catalog/` の他カテゴリ（3d/audio/broll/font）とは構造が異なります —
それらは「取得先の索引」（`remote: true` の meta.json）ですが、こちらは本体そのものを
このリポにベンダリングした「目次方式カタログ」です
（契約 [`planning/contract-2026-07-22-prerender-rail-and-assets.md`](../../../akari-video-internal/planning/contract-2026-07-22-prerender-rail-and-assets.md) §1.3。
内部リポの契約のため相対リンクはローカル参照用）。

## 構造

```
catalog/telop/
  index.jsonl        # 1 プリセット 1 行。id・name・tags・params・source を持つ。AI が読むのはここだけ
  <id>/
    template.json     # ATF ドキュメント本体（AtfDoc）。bake CLI（packages/bake-layer）が読む
```

- **index.jsonl だけを読めば選定できる**設計です。本体（`template.json`）は bake 時に機械が
  読むためのもので、通常は開かなくて構いません。
- `bake-layer` の `--preset <id>` はこの `id`（= ディレクトリ名）をそのまま受け取ります。

## タグの品質

- `tag_quality: "curated"` — 代表 25 件。使用頻度が高そうな汎用テンプレ
  （人名スーパー・字幕各種・バラエティ感情スタンプ・レシピ等）を優先選定し、雰囲気/用途タグを
  手動整備
- `tag_quality: "auto"` — 残り 210 件。id を単語分割した機械変換タグ（`category` = ATF の
  kind を併記）。今後の使用実績に応じて段階整備する

## 出所

- 移植元: `akari-os/akari-telop`（`src/samples/wave3/` 48 件 + `src/samples/wave3b/` 187 件）。
  commit `f2519143ad27bfa67463df2bf3c461ab6a7fa685`
- 移植スクリプト: `packages/bake-layer/scripts/port-telop.mjs`（再実行可能・冪等）
- 描画エンジン: `packages/bake-layer/vendor/telop/`（同 commit からソース同梱。
  `vendor/PROVENANCE.md` 参照）
