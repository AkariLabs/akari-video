# 素材 tier 契約 v1

- 日付: 2026-10-04
- 状態: 実装契約 v1
- 関連: [素材ライブラリ契約](contract-2026-07-13-asset-library.md)

`meta.json` の `tier: "free" | "pro"` は必須。`price` は廃止予定の任意フィールドとして残すが、`tier` がある場合は無視し、1 版後に削除する。旧メタを読むときだけ、`tier` が無ければ `price === 0` の場合に限り `free` と解釈し、`null`・欠落・非数値を含むそれ以外は `pro` とする（fail-closed）。新規メタと v1 validator には `tier` が必要。

`tier: "pro"` と `license.spdx: "CC0-1.0"` の組み合わせは validator のエラー。`tier: "free"` には CC0 を推奨し、それ以外のライセンスには warning を出す。tier はライセンスの許諾内容を置き換えない。

- 鍵はライブラリ側に置く。`composeState` は `tier === "pro" && !entitled` を `locked` とし、fetch も同じ条件で認可する。`all-access-pass` で解錠し、取得済み素材は `cached` のまま使える。
- resolver の一覧出力は各 item に `tier` と `machineTags` の `tier:<tier>` を持たせる。
- 利用者取り込み（`akari assets add`）は `tier: "free"` とする。
