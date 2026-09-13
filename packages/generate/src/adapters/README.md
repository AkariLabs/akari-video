# fal 生成アダプタ

各アダプタの `MAP` は、生成入力の正規形を fal のリクエスト body へ決定的に写像する表です。

## MAP の読み方

- `{ param, format }`: 値を検証・変換して `param` 名で送る
- `"reject"`: このモデルでは非対応。値があれば拒否する
- `"drop-if-empty"`: 対応する引数がない。空だけを許し、値があれば拒否する
- `{ into: "prompt", notation }`: camera を bracket または prose 記法で prompt 先頭へ合成する
- `{ allow: [...] }`: extra の許可キーだけを body 直下へ展開する

契約上の 13 セルは、9 スロット（`prompt` / `negative_prompt` / `first_frame` / `last_frame` /
`reference_images` / `reference_videos` / `reference_audios` / `source_video` / `camera`）と、
4 出力ノブ（`duration_s` / `resolution` / `aspect` / `audio_out`）です。
fail closed に必要な補助セル `seed` / `extra` を加え、実装の MAP は計 15 セルを持ちます。

## アダプタ一覧

| id | endpoint |
|---|---|
| `fal:h3-i2v` | `minimax/h3/image-to-video` |
| `fal:kling-v3-standard-i2v` | `fal-ai/kling-video/v3/standard/image-to-video` |
| `fal:kling-v3-pro-i2v` | `fal-ai/kling-video/v3/pro/image-to-video` |
| `fal:seedance-2.0-i2v` | `bytedance/seedance-2.0/image-to-video` |
| `fal:veo-3.1-flf` | `fal-ai/veo3.1/first-last-frame-to-video` |

- アダプタは丸めない（enum 外・範囲外は reject。丸めはバリデータの仕事）
- アダプタは fs を触らない（メディアは呼び出し側が注入する resolveMedia だけで解決する）
- アダプタは部分送信しない（1 つでも reject があれば body を作らずに失敗する）
