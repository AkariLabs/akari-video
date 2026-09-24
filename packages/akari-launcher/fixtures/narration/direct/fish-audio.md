# Fish Audio S2.1-Pro API memo

- 取得日: 2026-09-24
- 公式: https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
- OpenAPI: https://docs.fish.audio/api-reference/openapi.json
- 料金: https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits
- 感情タグ: https://docs.fish.audio/developer-guide/core-features/emotions
- 声の登録: https://docs.fish.audio/api-reference/endpoint/model/create-model
- 公開声一覧: https://docs.fish.audio/api-reference/endpoint/model/list-models
- 残高確認: https://docs.fish.audio/api-reference/endpoint/wallet/get-api-credit

`POST https://api.fish.audio/v1/tts`。`Authorization: Bearer <key>` と `model: s2.1-pro` ヘッダ。
無料枠のモデルは `s2.1-pro-free`。`s2-pro` / `s1` もある。入力の正本は OpenAPI `TTSRequest`。
`text` 必須、既製声は `reference_id`、形式は `format: mp3`。応答は音声バイト。
日本語に対応する。S2 の話し方は `[whispering]` 等の角括弧タグを `text` に置く。
`[sad][whispering]` のような連続タグも文書にある。

料金は `s2.1-pro` が $15 / 100 万 UTF-8 バイト。日本語 1000 字は概ね 3000 バイトで $0.045。
実際の見積は文字数ではなく `Buffer.byteLength(text, 'utf8')` で計算する。

声クローンは **per-request**。`references: [{audio: <binary>, text: <録音原稿>}]` を毎回渡す。
公式 OpenAPI は `references` に **MessagePack 必須** と記すため、JSON / data URI で送らない。
本人同意・クラウド送信同意・照合 0.7 以上・`--yes` が必要。`POST /model` で登録して
`reference_id` を再利用する方法もあるが、今回は正本録音とその同意状態を毎回確認できる方式を採用。
日本語公開声は `GET /model?language=ja` の 2026-09-24 の読み取り結果から、一般的な名前の 5 件を採用。
doctor は OpenAPI で `user_id: self` が明記された `GET /wallet/self/api-credit`。
