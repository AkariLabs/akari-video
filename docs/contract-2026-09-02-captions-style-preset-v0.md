# captions.json v0 字幕スタイルプリセット参照契約

- 日付: 2026-09-02
- lifecycle: accepted
- 位置づけ: オーナー裁定 #4「個別に凝る字幕はテロップへ寄せる」を維持した、字幕テンプレのハイブリッド保存契約

## 0. 位置づけ

字幕テンプレは、保存時には小さく安定した id を参照し、描画前に値へ解決する。プリセットの見た目を
共通カタログで更新できる一方、個々の字幕は従来の `text_style` で必要なフィールドだけを上書きできる。
字幕の個別 override 語彙は増やさず、より複雑な表現はテロップへ変換するという裁定 #4 を維持する。

## 1. 席

席は `captions.json` の各 `captions[]` レコードに置く任意フィールド `style_preset` である。
配列ルートと object ルートのどちらでも、レコード内の席は同じである。

```jsonc
{
  "captions": [
    {
      "id": "c-0001",
      "style_preset": "subtitle-standard",
      "text_style": { "color": "#ffe082" }
    }
  ]
}
```

id は `^[a-z0-9][a-z0-9-]*$` に従う。`captions.json` ルートに `style_preset` の席を設けることは
本契約のスコープ外である。

## 2. 解決順とマージ規則

実効スタイルの優先順は、低い方から次のとおりである。

1. object ルートの `default_text_style`
2. `style_preset` が参照するプリセットの `style`
3. 同じ字幕レコードの `text_style`

プリセットと `text_style` はフィールド単位でマージする。`stroke` / `background` / `shadow` /
`glow` / `position` / `animation` は 1 段内側のキー単位でマージし、`animation` の `in` / `loop` /
`out` は各スロット単位で上書きする。未知の id は無視し、保存形を変更せず lint warning を出す。
`style_preset` キー自体は解決後のレコードにも残す。

## 3. 消費側の約束

`captions.json` を読む消費側は、既存の描画・スタイル merge へ渡す前に必ず
`applyCaptionStylePresets(root, TEXTSTYLE_CATALOG)` を通す。render-cut、GPU export、OSR export、
shell preview、edit-store inspector、preview-server の各入口がこの前処理を担う。

既存の 6 つの merge 実装は変更しない。前処理は `text_style` へ解決値を写すだけで、
`default_text_style`、原本の `style_preset`、書き戻し形式を変更しない。

## 4. カタログと生成物

正本は `presets/textstyle/index.jsonl` と各 `presets/textstyle/<id>.json` である。
`packages/edit-store/scripts/gen-textstyle-catalog.mjs` がブラウザでも使える
`TEXTSTYLE_CATALOG` を `packages/edit-store/src/generated/textstyle-catalog.ts` に決定論的に生成する。
生成順は id 昇順で、drift テストが正本との差を検出する。各 index 行の `style` と個別 JSON の
`style` は一致し、個別 JSON は `format: "akari-textstyle"` を持つ。

## 5. lint

schema と validator は id の型・形式を検査するが、カタログ上の存在までは必須にしない。
edit-lint はカタログを読める環境だけ存在検査を行い、未知 id を
`captions.style-preset-unknown` warning として報告する。配布物にカタログが無い場合はこの存在検査を
スキップする。

## 6. 無料テンプレ 3 種

| id | 表示名 | 役割 |
|---|---|---|
| `subtitle-standard` | 標準 | 白文字、黒縁、座布団・アニメなし |
| `subtitle-variety` | ポップ | 黄文字、太い縁、影 |
| `subtitle-news` | ニュース帯 | 白文字、赤い座布団 |

## 7. 非スコープ

- ルートレベルの `style_preset`
- price、購入状態、👑 プレミア、Lab 接続
- テンプレピッカー UI と選択行への一括適用 RPC（T6b）
- 既存 merge 実装の統合・改修
- テロップ契約との統合
