# 生成エンジンを選ぶ

能力と価格の正本は `packages/schemas/gen-models.json`。モデル名の記憶や provider の一般論で補わず、実行時にこのカタログの該当行を読む。

## 読む欄

- `id` / `kind` / `provider` / `endpoint`: CLI と接続レジストリで使う識別子
- `inputs`: first / last frame の required・optional・none、参照上限、camera 表記、許可された extra
- `duration` / `resolutions` / `aspects` / `audio_out`: 出力可否、値の範囲、provider へ送る型と書式
- `price`: 解像度・秒数・音声倍率からの見積。`null` なら見積不可
- `as_of` / `source_url` / `price_url` / `verified`: 情報の鮮度と根拠
- `calibration[]`: 実測済みの較正記録。主観点数の代わりに事実帯へ出す

値のある未対応スロットは送らずに失敗する。参照上限が未知なら推測で上限を作らない。`extra` は `extra_allowed[]` の名前だけを通す。

## 既定

- 静止画: `codex:image`。無償扱い
- 動画: `fal:h3-i2v`。有償かつ外部送信のため、見積と費用承認が必要

価格行が無い、または `price: null` のモデルは「見積不可 + 明示確認」と表示し、確認なしに実行しない。価格表示には必ず `as_of` を添える。

H3 は音声欄がなくても音声を生成する。タイムラインへ差し替えた item は既定 `mute: true` とする。provider が返した `expanded_prompt` は送信 prompt と別の事実として `result.expanded_prompt` に保存し、較正では expanded 側も評価対象にする。
