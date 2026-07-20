# 声プロファイル作成手順（fal-qwen3 自声クローン用）

fal-qwen3 アダプタ（[engines.md](engines.md)）で自声クローンを使うには、事前に
`~/.config/akari-video/voice-profiles/<name>/` へ声プロファイルを 1 度作っておく必要がある。
本リーフはその作成手順を正文として記載する。**クローンするのはプロジェクトオーナー本人の声のみ**
（SKILL.md ハードルール 1）。

## 1. 原稿提示

同梱の [assets/reading-script-v1.md](assets/reading-script-v1.md) を人間にそのまま提示する。
本文は正文であり、人間が読みやすいよう言い換えたり要約したりしない
（`reference_text` と完全一致させる必要があるため）。約 330 字・45〜60 秒を目安と伝える。

## 2. 録音（2 経路）

どちらでもよい。

- **経路 A（既定）**: iPhone / Mac のボイスメモで原稿を読んでもらい、共有・書き出しで
  `~/Downloads` へ保存してもらう（AirDrop 含む）。追加権限が要らず、既存の録音習慣と一致する。
- **経路 B（全自動）**: `ffmpeg -f avfoundation -i ":<device>"` でマイクから直接録音する。
  利用可能なデバイスは `ffmpeg -f avfoundation -list_devices true -i ""` で確認する
  （初回のみマイク許可プロンプトが出る）。

## 3. 拾いルール

セットアップ開始時刻の mtime を記録しておき、`~/Downloads` の中で**その時刻以降に更新された**
最新の音声ファイル（m4a / wav / mp3）を対象にする。ボイスメモの自動命名は録音場所に由来し
ファイル名からは内容を推定できないため、**ファイル名ではなく mtime で拾う**。

## 4. 送信前ガード（省略不可、ハードルール 2）

外部（fal）へ送信する前に、ローカル whisper で拾った音声を逆文字起こしし、所定原稿（§1）との
一致度と、長さが 30〜300 秒の範囲かを確認する。目的は文字起こしの精度検証ではなく、
**誤ファイル（別録音・他人の声・私的な音声）を外部サービスへ誤送信しないための照合**である。

- whisper.cpp の実行ファイル・モデル探索は
  [../analyze-footage/media-and-transcript.md](../analyze-footage/media-and-transcript.md) の
  「層 2: whisper.cpp」節と同じ探索順・同じ呼び出し規約を流用する（新しい探索ロジックを作らない）
- 一致度が低い、または長さが範囲外なら**送信せず停止**し、録音のやり直しを人間に案内する
- 照合をスキップしてよいのはオーナーが明示的に指示した場合のみで、その場合も `meta.json` の
  `reference.verification` に `"skipped by owner instruction (<日付>)"` のように理由と日付を記録する
  （既定は照合ありのまま変えない）

## 5. クローン（fal `clone-voice/1.7b`）

`FAL_KEY` は `~/.config/akari-video/credentials.env` から読む（manage-connections 経由のみ。
ハードルール 5）。参照音声を data URI にエンコードし、`reference_text` に §1 の原稿本文をそのまま
渡して `fal-ai/qwen-3-tts/clone-voice/1.7b` を呼ぶ。応答の `speaker_embedding.url` が
声プロファイル資産（`embedding_source_url`）になる。**有償操作**なので、実行前に対象・使う手・理由・
代替案・費用・待ち時間・外部送信・provenance を宣言し、明示承認を得てから送信する
（[../manage-connections/SKILL.md](../manage-connections/SKILL.md) の Decision Communication Contract
と同型。クローンは声につき通常 1 回のみで費用は僅少だが、宣言自体は省略しない）。

## 6. 保存

`~/.config/akari-video/voice-profiles/<name>/` に以下を保存する（`credentials.env` と同じ
ユーザーレベル・git 管理外）。

- `embedding.safetensors`（または `embedding_source_url` を meta.json に記録し、資産は fal 側 URL
  参照のままでもよい。実装は [bin/generate-narration.mjs](bin/generate-narration.mjs) の
  fal-qwen3 アダプタが `meta.json` の `embedding_source_url` を読む前提に合わせる）
- `ref-recording.<ext>`（送信した参照音声そのもの）
- `meta.json`:
  - `profile`: プロファイル名
  - `created_at`: ISO8601
  - `reference.sha256`: 参照音声のハッシュ
  - `reference.script_version`: 使用した原稿バージョン（例 `v1`）
  - `reference.verification`: whisper 照合の結果、またはスキップの記録（§4）
  - `consent`: 本人が本人の声のプロファイル作成を明示指示したことの記録（**必須**。ハードルール 1）
  - `reference_text`: fal に渡した参照テキスト（§1 の原稿本文と同一）
  - `embedding_source_url`: fal から得た speaker embedding の URL

## 7. 検収

短文 1 本（数十文字程度、$0.01 未満）を fal-qwen3 アダプタで試し生成し、`afplay` 等で人間に耳確認して
もらう。OK であればプロファイルは有効化完了。似度が不足する場合は、静かな環境で 30〜60 秒のナレ調
録音を撮り直してプロファイルを作り直す（NG 判定はその後で行う）。
