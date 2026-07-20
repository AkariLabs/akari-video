# エンジンアダプタ

`bin/generate-narration.mjs` の `generate` サブコマンドで実際にナレーション音声を作る。

```
node skills/generate-narration/bin/generate-narration.mjs generate \
  --project <projectDir> --engine <voicevox|fal-qwen3> \
  --reading-file <読み原稿.txt> [--script-file <表示原稿.txt>] \
  --t <タイムライン秒> [--gain-db 0] [--id n-0001] \
  [--speaker 3]              # voicevox 用（既定 3 = ずんだもん/ノーマル）
  [--profile owner-ja]       # fal-qwen3 用
  [--dry-run] [--yes] [--apply]
```

- `--reading-file` は必須。原稿は [reading-text.md](reading-text.md) の規約でかな化した**読み原稿**を渡す
- `--script-file` は任意。渡した場合、表示原稿として `script` に記録される
- `--id` を省略すると、`<projectDir>/edit.json` の `audio.narration[]` にある既存 id の最大値 + 1
  （無ければ `n-0001`）を自動採番する
- 出力音声は `<projectDir>/out/narration/<id>.<wav|mp3>` に保存される（voicevox は wav、fal-qwen3 は mp3）
- `--apply` を付けると `edit.json` の `audio.narration[]` にエントリを追加し（`audio` / `narration` が
  無ければ作る）、直後に `packages/schemas/bin/validate-edit.mjs` を実行する。NG なら書き込みを
  ロールバックする
- `--apply` を付けない場合、音声ファイルの生成とエントリ JSON の標準出力のみ行い、`edit.json` は
  変更しない（手動で確認してから追記したい場合に使う）

## voicevox アダプタ

- 完全ローカル・無償・API キー不要。既にエンジンが `http://127.0.0.1:50021` で起動していればそれを使い、
  未起動なら `/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run` をヘッドレスで自動起動する
  （`/version` 応答まで最大 60 秒待機。自分が起動した場合のみ生成後に終了させる）
- `/audio_query` → `/synthesis`（speaker id 指定）の順で呼び、wav を得る
- `--speaker` は VOICEVOX の style id（既定 3 = ずんだもん・ノーマル）。話者名は `/speakers` から解決し、
  provenance に `voice: speaker:<id>(<話者名>)` / `credit: VOICEVOX:<話者名>` として記録する
  （キャラクターごとのクレジット表記義務。ハードルール 6）
- 費用はゼロ。承認ゲートは不要（`--dry-run` 以外はそのまま実行される）

## fal-qwen3 アダプタ（自声クローン）

- `~/.config/akari-video/voice-profiles/<profile>/meta.json` の `embedding_source_url` /
  `reference_text` を使い、`https://fal.run/fal-ai/qwen-3-tts/text-to-speech/1.7b` へ
  `text` / `language:"Japanese"` / `speaker_voice_embedding_file_url` / `reference_text` /
  `max_new_tokens:2048` を POST する
- 声プロファイルが無ければ先に [voice-profile-setup.md](voice-profile-setup.md) を行う
- `FAL_KEY` は `~/.config/akari-video/credentials.env` から読む。無ければ KEY 名と置き場を案内して
  exit 1（API キー直叩き禁止・manage-connections 経由のみ。ハードルール 5）
- 実行前に見積り（文字数 × $0.09 / 1000 字）を stderr に表示する。**`--yes` を明示しない限り送信せず
  exit 2**（費用宣言 → 明示承認、ハードルール 4）
- provenance は `provider: fal` / `engine: qwen-3-tts-1.7b` / `voice: profile:<name>` を記録する

## ElevenLabs（凍結中）

ElevenLabs は今回のスキルではアダプタを実装しない。凍結中のため、実行時にも選択肢として提示しない
（ハードルール 4）。`.akari/connections.json` の `elevenlabs` エントリ自体は既存のまま変更しない。

## `--dry-run`

どちらのエンジンでも実リクエストを送らない。送るはずのペイロード JSON（fal の API キーはマスク表示）と、
出力予定パス・見積り費用（voicevox は 0、fal-qwen3 は概算 USD）を標準出力に JSON で出して exit 0 で終わる。
本番実行前の確認や、有償レーンの費用感を人間に見せる用途に使う。

## エンジン選択基準・二段運用

| 状況 | 選ぶエンジン |
|---|---|
| 尺やテンポを素早く確定したい（仮ナレ・アニマティクス） | voicevox（無償・数秒・承認ゲート不要） |
| ずんだもん文化圏コンテンツ・キャラ解説・下書き試聴 | voicevox |
| 本人ナレーションの本番（CM・ブランドコンテンツ） | fal-qwen3（`--profile owner-ja` 等） |
| 多言語展開（自分の声のまま他言語） | fal-qwen3（クロスリンガルクローン） |

**二段運用（推奨フロー）**: まず `--engine voicevox` で仮ナレを生成し `--apply` して尺とテンポを
確定する。方針が固まったら、同じ `--reading-file`（必要なら微調整）・同じ `--t` で
`--engine fal-qwen3 --profile <name> --yes --apply` を実行し、同じ `id` は使わずに新しい narration
エントリとして本番音声へ差し替える（古い仮ナレのエントリは編集者が削除する）。仮ナレの段階では
費用が発生しないため、テンポ調整の反復を何度でも無償で行える。
