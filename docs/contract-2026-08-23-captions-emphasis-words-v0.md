# captions.json v0 語レベル演出（emphasis_words）データ契約

- 日付: 2026-08-23
- 状態: 実装ラウンドの SSOT（`captions.json` の席と優先順を確定）
- 前提: [edit.json v1 語レベル演出契約](contract-2026-07-23-edit-json-v1-emphasis-words.md)
- スコープ: `captions.json` の object ルートに置くトップレベル任意フィールド
  `emphasis_words[]` と、旧 `edit.json` 席との読取優先順

## 背景

字幕表示に属する語レベル演出は、編集タイムラインではなく字幕の SSOT である `captions.json` 側へ置く。
`edit.json` v2 から `emphasis_words` を廃止した 2026-08-21 裁定は維持し、v2 の exact-keys に席を
戻さない。一方、その裁定の根拠だった fieldtest 60 本の使用 0 件は母集団外の本番リールを含んでおらず、
本番リールでは 15 語が実際に使用されていたため、「語レベル演出自体が不要」という根拠は訂正する。

## 1. 席

`captions.json` が object ルートのときだけ、トップレベルに `emphasis_words[]` を任意で置ける。

```jsonc
{
  "emphasis_words": [
    {
      "id": "e-0001",
      "src": "main",
      "t_start": 12.08,
      "t_end": 12.44,
      "word": "最高",
      "emotion": "joy",
      "style_hint": "size-pulse"
    }
  ],
  "captions": [ /* 既存のまま */ ]
}
```

従来の配列ルート（`[{ ...caption... }]`）にはトップレベルのフィールドを置けないため、
`emphasis_words[]` の席はない。語レベル演出を書く場合は object ルートへ移し、既存配列を
`captions[]` に包む。

## 2. レコード契約と差分

レコード形、フィールド語彙、source 秒アンカー、実測 word-level タイムスタンプを写す規律、
選定規律、劣化規約はすべて
[edit.json v1 語レベル演出契約](contract-2026-07-23-edit-json-v1-emphasis-words.md) と同じである。
本契約が定める差分は次の 2 点だけである。

1. 配列の置き場を `edit.json.emphasis_words` から、object ルートの
   `captions.json.emphasis_words` へ移す。
2. `edit.json` v2 へは書かない。v0/v1 の旧席は後方互換の読取専用として残す。

したがって各レコードは `{ id, word, emotion, src?, t_start, t_end, style_hint? }` で、`id` は
`^e-\d{4}$` かつファイル内一意、`word` と `emotion` は空でない文字列、時刻は source 秒で
`0 <= t_start < t_end` とする。`emotion` は `joy` / `pain` / `surprise` / `anger` / `sadness` /
`emphasis` を標準語彙として使うが、v1 契約どおり enum 強制はしない。`style_hint` も描画側への
提案に留まる。

## 3. 読取優先順

消費側は次の優先順で 1 つの席だけを読む。

1. object ルートの `captions.json` に `emphasis_words` キーが在れば、その値を採用する。
2. キーが無ければ、v0/v1 の `edit.json.emphasis_words` を後方互換として読む。
3. どちらにも無ければ語レベル演出なしとする。

両方の席が在る場合もマージしない。`captions.json` 側だけを採用し、警告は出さない。これにより
新しい字幕 SSOT が常に優先される一方、`captions.json` に席を持たない既存 v0/v1 プロジェクトは
従来どおり `edit.json` 側だけで描画され、回帰しない。

## 4. 検証責務

`captions.schema.json` は object ルートだけに任意の `emphasis_words[]` を定義し、要素の必須項目、
型、`id` 形式、非負時刻、非空の `word` / `emotion` を検査する。JSON Schema 標準では兄弟値を
比較できない `t_end > t_start` と、配列内の `id` 一意性は `validate-captions.mjs` が検査する。
語と `captions[].words[]` の実測値の突き合わせは v1 契約と同じく書き手の規律であり、静的検証では
行わない。
