# 素材 tier 契約 v1

- 日付: 2026-10-04
- 状態: 実装契約 v1
- 関連: [素材ライブラリ契約](contract-2026-07-13-asset-library.md)

`meta.json` の `tier: "free" | "pro"` は必須。`price` は廃止予定の任意フィールドとして残すが、`tier` がある場合は無視し、1 版後に削除する。旧メタを読むときだけ、`tier` が無ければ `price === 0` の場合に限り `free` と解釈し、`null`・欠落・非数値を含むそれ以外は `pro` とする（fail-closed）。新規メタと v1 validator には `tier` が必要。

`tier: "pro"` と `license.spdx: "CC0-1.0"` の組み合わせは validator のエラー。`tier: "free"` には CC0 を推奨し、それ以外のライセンスには warning を出す。tier はライセンスの許諾内容を置き換えない。

切替前に CC0 で取得されたコピーは CC0 のまま。後から tier を変更しても、既に配布された CC0 コピーの利用条件は変更されない。

- 鍵はライブラリ側に置く。`composeState` は `tier === "pro" && !entitled` を `locked` とし、fetch も同じ条件で認可する。解錠は (a) 店応答の `pass` が非 null（Lifetime パス保有。`all-access-pass` id も同値）なら全 Pro、または (b) item の `product_id` が `entitlements[].product_id` に含まれる場合。店はパス対象商品を entitlement 行へ展開するため、応答に `all-access-pass` id は入らない。item と無関係に全 Pro を解錠できるのは (a) だけ。取得済み素材は `cached` のまま使える。
- resolver の一覧出力は各 item に `tier` と `machineTags` の `tier:<tier>` を持たせる。
- 公開 catalog の Pro 項目は `files` を持たない。非空の `files` があれば `invalid_catalog_item` として取得を拒否する。locked 項目の一覧・`/api/items` 応答にも `files` を含めない。
- 利用者取り込み（`akari assets add`）は `tier: "free"` とする。

## § 取得時の素材参照（2026-10-05）

resolver・CLI・shell からの取得参照は `category/id` とする。bare id はカタログ内で一意な場合だけ互換解決する。複数の category に同じ id があれば、候補の `category/id` を含む `ambiguous_id` エラーを返し、先頭の item を選ばない。

## § `source` の union（2026-10-04）

`source` は **external**（既存 v0）または **akari-r2** の一方だけを取る。external は `url` が必須で、`acquisition`・`license_at_source`・`attribution_required` は従来どおり。akari-r2 は絶対 URL または R2 key の `image` と `preview` が必須で、`width`・`height`・`bytes` は任意の正整数。`url` があれば external、`image` があれば akari-r2 と判別する。両方ある形、どちらもない形は不正。

`remote: true` の素材は実体がディレクトリに無いため akari-r2 の `source` を必須とする。`remote` が無い、または false の素材では `source` は任意。既存の公開 `catalog/` は external + `remote: true` の旧形式のため、validator は `catalog/` 配下に限って互換性を維持する。新規メタは akari-r2 に従う。
JSON Schema は `remote: true` なら `source` 必須までを表し、akari-r2 必須と既存 `catalog/` の external 互換は validator が経路を見て判定する。

## § textstyle（字幕スタイル）の Pro item（2026-10-05）

公開カタログの textstyle Pro item は `id`、`category: "textstyle"`、`tier: "pro"`、
`product_id: "telop-rich-pack-01"`、`version`、`preview`、`license`、`tags`、`title` を持つ。
`files` は持たせない。

束 zip は `<product_id>-v<version>/` の直下に `README.md`、`LICENSE.md`、
`checksums.txt` を置き、各素材を次の形で収める。

`assets/textstyle/<id>/{meta.json,preset.json,preview.png}`

`resolve` は対象の 1 件だけを `<ライブラリ>/textstyle/<id>/` へ配置し、
`validate-asset` で `preset.json` の `format: "akari-textstyle"` と `id` の一致を検証する。
`preview` URL は `https://akari.video/lab/media/telop-rich-pack/textstyle/<id>.png` の形とする。
配置後は既存の textstyle ライブラリ読み込みが `preset.json` を読み、
「テキスト > スタイル」へ並べる。未取得 textstyle の棚カード表示は別票で扱う。
