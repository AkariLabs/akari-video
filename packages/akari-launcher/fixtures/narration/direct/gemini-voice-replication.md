# Gemini 3.8 Flash TTS voice replication

- 取得日: 2026-09-24
- 公式資料: https://ai.google.dev/gemini-api/docs/voice-replication
- 料金表: https://ai.google.dev/gemini-api/docs/pricing
- 公式ブログ（取得日 2026-09-24、記事公開日 2026-09-23）: https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-8-text-to-speech/
- 作成: `POST https://generativelanguage.googleapis.com/v1beta/voices`、`x-goog-api-key`。`{store:true,voice:{model:"gemini-3.8-flash-tts",type:"replicated",display_name,replicated:{source_audio:{mime_type:"audio/wav",data:"<base64>"},consent_audio:{mime_type:"audio/wav",data:"<base64>"}}}}`
- 正本: 本人の自然な発話 10〜30 秒を送る。AKARI の正本が 30 秒を超える場合は、送信用音声だけ先頭 30 秒を使う。同意録音: 同じ成人本人が下記の固定文を明瞭に読む。両方とも同じマイク・環境での 24 kHz mono 16-bit PCM WAV 推奨。
- 固定文は 30 ロケール別。ja-JP: 「私はこの音声の所有者であり、Googleがこの音声を使用して音声合成モデルを作成することを承認します。」 en-US: “I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.”
- `store:true` は `voice_...` 形式の `id` を返す。プロジェクト上限 200 声、保持期間 1 年。`store:false` は `voicekey_...` 形式の `key` を返し、保持期間 7 日。本実装は `store:true` のみ使用。
- 合成: `POST /v1beta/interactions` の `generation_config.speech_config: [{voice:"voice_..."}]`。
- 制限: 本人の所有する声と本人の明示的な同意録音を要求。資料は同じ成人本人の 2 録音を要求する。他人の声での作成はこの要件を満たさない。
- 声作成自体の料金: 公式料金表に該当項目を確認できず、未確認（見積不可）。合成料金と混同しない。
- SynthID 透かし / C2PA credentials: 上記の Google 公式ブログで声の複製に付くことを確認（取得日 2026-09-24）。Voice replication の API 文書には記載なし。
