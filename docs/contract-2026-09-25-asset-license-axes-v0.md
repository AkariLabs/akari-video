# 素材ライセンスの 2 軸 v0

素材の `meta.json` の `license` に、商用利用の可否 `commercial`（`allowed` / `prohibited` / `unknown`）と帰属表示の要否 `attributionRequired`（`true` / `false` / `null`）を任意で加える。古い `scope`・`spdx`・`attribution_required` は読み取りで使い、書き換えない。`null` は判断できないことを表す。

## 導出

| 宣言・旧値 | 商用利用 | 帰属表示の既定値 |
|---|---|---|
| `CC0-1.0`、`LicenseRef-AKARI-Assets-v0`、`LicenseRef-AKARI-Sounds-Terms-v0`、`MIT`、`OFL-1.1` | allowed | false |
| 版番号を持つ `CC-BY-*`（`CC-BY-SA-*`・`CC-BY-ND-*` など、NC を含まないもの） | allowed | true |
| `CC-BY-NC-*`（SA・ND との組み合わせを含む） | prohibited | true |
| その他、SPDX 識別子に `NC` 区切り語を含むもの | prohibited | 判別できなければ null |
| 旧 `scope: commercial-ok` | allowed | 未指定なら null |
| 旧 `scope: non-commercial` | prohibited | 未指定なら null |
| 旧 `scope: attribution` | allowed | true |
| `scope: paid-license-required` など未対応の scope と、判別できない SPDX の組み合わせ | unknown | 未指定なら null |
| `meta.json` はあるが `license` が無い・判別できない | unknown | 未指定なら null |
| `meta.json` が無い | 対象外（利用者の素材として所見を出さない） | 対象外 |

旧 `attribution_required` の真偽値は帰属表示の軸へ写す（版番号を持つ CC-BY 系の帰属表示は true を優先）。新しい 2 軸があれば最優先する。SPDX 識別子の `NC` 区切り語による商用禁止は旧 `scope: commercial-ok` より優先する。未知の scope だけでは商用可否を決めず、既知の SPDX があればそちらの導出値を使う。どちらの軸も、もう一方を根拠に補完しない。

## 書き出し前の表示

edit-lint は使用中の素材について `license.non-commercial` を warning、`license.unknown` と `license.attribution` を info で出す。各所見の `details` は `asset`・`name`・`credit` を持つ。クレジットは同じ素材ディレクトリの `CREDIT.txt` 先頭行を優先し、無ければ題名・作者・SPDX を組み立てる。書き出し画面は該当する行だけを表示し、名前の一覧を開閉できる。帰属表示が必要な行ではクレジットをコピーできる。これらの所見で書き出しは止めない。

既存の `assets/` と `catalog/` のメタデータは `packages/asset-resolver/test/license-axes.test.mjs` で全件点検し、商用利用が unknown になるパスをテスト出力へ列挙する。元データは点検で変更しない。
