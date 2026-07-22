# Telop カタログ（ATF テロップテンプレート）

旧 `akari-telop`（ATF v0.2・`src/samples/wave3` + `wave3b`）から全件機械移植したテロップ
テンプレート 36 件です。`catalog/` の他カテゴリ（3d/audio/broll/font）とは構造が異なります —
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

## 色ツマミの標準化（役割ベースの共通パレット契約・2026-07-22）

全 36 件のハードコード色を ATF 変数へ抽出し、テンプレ間で共通の役割ベース命名に統一した
（`index.jsonl` の `params` に反映済み。AI は目次を読むだけで、どの変数がどの役割かを
判断できる）。**プリセットの色をそのまま使わず、色・トーンはコンテンツ由来のパラメータで
上書きする**のが前提（`akari-video-internal` notes 第 30 巡「色味の引きずり」対策）。

| 役割 | 意味 | 備考 |
|---|---|---|
| `color_bg` / `color_bg_2` / `color_bg_3` | プレート・帯・バッジの背景色 | `_2`/`_3` はグラデ 2 段目・二重帯など |
| `color_text` / `color_text_2` / `color_text_3` | 本文・二行目・三行目の文字色 | 複数行テキストがある場合のみ `_2` 以降を使う |
| `color_primary` (`_2`〜`_4`) | テンプレの識別色（多段グラデが単一の「金」等のブランド色を成す場合） | 図形とテキストの双方に跨って使われることがある |
| `color_accent` / `color_accent_2` | アクセントライン・ハイライト・進行バー等 | |
| `color_stroke` / `color_stroke_2` | テキストの縁取り（外/内） | |
| `color_shadow` / `color_shadow_2` | ドロップシャドウ色 | |
| `color_glow` / `color_glow_2` | ネオン・フォスファー等のグロー色 | |

- 全役割 `default` = 移植時点の色そのもの（無指定なら見た目は完全に後方互換）
- テンプレごとに勝手な変数名は作らない。上表にない役割が必要になったら、まずこの表を拡張する
- 詳細な変更履歴・堅牢化（後述）の設計判断は
  `akari-video-internal/tasks/2026-07-22-telop-tunables/`（内部リポ）を参照

## テキスト長への堅牢化（shrink-to-fit・2026-07-22）

どの `text` 型変数にどんな長さの文字列を渡しても、キャンバスからはみ出さない
（`packages/bake-layer/vendor/telop/atf/resolve.ts` に汎用の自動縮小を実装。
詳細は `vendor/PROVENANCE.md` の該当節）。36 件 × テキスト長 4 種（1文字/標準/2倍長/
4倍長・日英混在）= 144 ケースの機械検証結果は内部リポ
`tasks/2026-07-22-telop-tunables/out/status.json` + `robustness-gallery.html` に記録。

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

> 剪定注記（2026-07-22）: 初回移植 235 件からオーナー選別（keep 36）で剪定。落とした 199 件は git 履歴と旧リポ（akari-telop f251914）から復元可能。
