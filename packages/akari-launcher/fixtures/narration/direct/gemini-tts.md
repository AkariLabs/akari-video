# Gemini 3.8 Flash TTS API memo

- 取得日: 2026-09-24
- 公式: https://ai.google.dev/gemini-api/docs/speech-generation
- 料金: https://ai.google.dev/gemini-api/docs/pricing
- モデル: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts
- 声の複製: https://ai.google.dev/gemini-api/docs/voice-replication
- Interactions: https://ai.google.dev/gemini-api/docs/interactions-overview

現行 REST は `POST https://generativelanguage.googleapis.com/v1beta/interactions`。
認証は `x-goog-api-key` ヘッダ。`model: gemini-3.8-flash-tts`、`input` は
`user_input` の `content` に原稿の `text` と任意の `speech_metadata.style` 注釈を置く。
`generation_config.speech_config: [{voice: "Leda"}]`、`response_format` に
`{type:"audio", mime_type:"audio/l16", sample_rate:24000}` を指定する。
応答は `steps[]` の `model_output.content[]` 内の `type:"audio"` の base64 `data`。
`audio/l16` はヘッダ無し 24 kHz、mono、16 bit PCM なので RIFF WAV で包む。
`audio/wav` の RIFF 応答もそのまま保存する。unary の既定は WAV。

日本語は対応言語に含まれる。既製 30 声から選び、既定は Leda。
料金は 2026-12-31 まで入力 $0.50 / 出力 $9.00（各 100 万トークン）、
2027-01-01 から入力 $1.00 / 出力 $18.00。公式料金表に音声 1 秒 = 25 トークンと明記。
見積は日本語約 5 字/秒で出力秒数を推定し、出力トークン単価を適用する概算。入力トークンは含めない。
声クローンは本人の口頭同意録音を伴う Voice replication API で、本件では未実装。
doctor は読み取り専用 `GET https://generativelanguage.googleapis.com/v1beta/models`。
