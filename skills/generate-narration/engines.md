# エンジンアダプタ

`akari narration generate` サブコマンドで実際にナレーション音声を作る。

```
akari narration generate \
  --project <projectDir> --engine <voicevox|gemini-tts|irodori|fal-qwen3> \
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
- 出力音声は `<projectDir>/out/narration/<id>.<wav|mp3>` に保存される（voicevox / irodori は wav、fal-qwen3 / gemini-tts は mp3）
- `--apply` を付けると `edit.json` の `audio.narration[]` にエントリを追加し（`audio` / `narration` が
  無ければ作る）、直後に `packages/schemas/bin/validate-edit.mjs` を実行する。NG なら書き込みを
  ロールバックする
- `--apply` を付けない場合、音声ファイルの生成とエントリ JSON の標準出力のみ行い、`edit.json` は
  変更しない（手動で確認してから追記したい場合に使う）

## voicevox アダプタ

- 完全ローカル・無償・API キー不要。既にエンジンが `http://127.0.0.1:50021` で起動していればそれを使い、
  未起動なら vv-engine の `run` をヘッドレスで自動起動する
  （`/version` 応答まで最大 60 秒待機。自分が起動した場合のみ生成後に終了させる）
- run 実行ファイルの解決順: 環境変数 `VOICEVOX_RUN`（絶対パス直指定）→ platform 別既定インストール先
  — darwin: `/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run`、
  win32: `%LOCALAPPDATA%\Programs\VOICEVOX\vv-engine\run.exe`（VOICEVOX 0.16+ の既定インストーラ配置先）。
  それ以外の platform では `VOICEVOX_RUN` 指定が必須（既定パスなし）
- `/audio_query` → `/synthesis`（speaker id 指定）の順で呼び、wav を得る
- `--speaker` は VOICEVOX の style id（既定 3 = ずんだもん・ノーマル）。話者名は `/speakers` から解決し、
  provenance に必須の `provider: voicevox` と `voice: speaker:<id>(<話者名>)` / `credit: VOICEVOX:<話者名>` を記録する（例: `{"provider":"voicevox","voice":"speaker:3","credit":"VOICEVOX:ずんだもん"}`）
  （キャラクターごとのクレジット表記義務。ハードルール 6）
- 費用はゼロ。承認ゲートは不要（`--dry-run` 以外はそのまま実行される）

## irodori アダプタ（お試し）

- AKARI はモデルを起動しない。別に起動した Irodori-TTS-Server へ `--engine irodori --irodori-url <url>` で接続する。URL はオプション → `AKARI_IRODORI_URL` → `http://127.0.0.1:8088` の順で決まる。別 PC のサーバーも指定できる。
- `--voice` は `narrator-male`（既定・落ち着いた男性ナレーター）、`bright-female`（明るい若い女性）、`slow-explainer`（低くゆっくりした解説）の声レシピから選ぶ。`--voice custom --style <声の指示>` で自分で書ける。`--style` を付けるとレシピの caption を置き換える。
- `voice: "none"` と `irodori.caption` を `/v1/audio/speech` に送り、wav を保存する。参照音声・声クローンは扱わない。`--speed` は 0.25〜4.0。既定のタイムアウトは 600 秒で、`AKARI_IRODORI_TIMEOUT_MS` で変更できる。GPU を推奨し、処理に時間がかかる。
- 費用は 0。provenance は `provider: irodori`、`engine: irodori-tts-v4-small`、`voice: recipe:<id>` または `caption:custom`、`experimental: true`、`server: <host:port>` を記録する。

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

## gemini-tts アダプタ（fal 経由）

- `--engine gemini-tts --voice Leda` が既定。`--voice` は 30 声から選び、`--style <text>` で話し方を指定できる。
- 費用見積りは暫定 `$0.05 / 1000 字`。価格未検証のため一覧の `price.verified` と provenance の `price_verified` は `false`。`--yes` 無しでは送信しない。
- `--speed` は Gemini 側で非対応のため警告して無視する。VOICEVOX では `/audio_query` の `speedScale` に渡す。
- `--text <原稿>` で文を直接渡せる。`--reading-file` を併用すれば表示文と読みを分けられる。`--caption-ref c-0001 --apply` で生成元の字幕 ID を記録する。
- `--t` は `--apply` 時に必須。`--apply` しない生成・承認見積りでは省略でき、省略時は 0 秒扱い。

## エンジン一覧・声一覧の JSON 口

- `akari narration engines --json` は接続状態を含むエンジン一覧を返す。VOICEVOX の起動はしない。
- `akari narration voices --engine <voicevox|gemini-tts|irodori|fal-qwen3> --json` は声一覧を返す。VOICEVOX の声取得時だけ必要に応じて起動する。
- `akari narration generate ... --json` は stdout に結果 JSON を 1 行で返し、経過ログを stderr に出す。Gemini の費用承認待ちは exit 2 と `status: needs_approval` を返す。

## VOICEVOX の常駐起動と停止

- `akari narration start --engine voicevox --json` は、停止中なら vv-engine を切り離して起動し、`~/.akari/run/voicevox.pid` に PID を記録する。既に動作中ならその版を返し、起動済みのアプリには触れない。
- `akari narration stop --engine voicevox --json` は PID ファイルの PID が生存し、実行コマンドが VOICEVOX の `run` と一致するときだけ停止する。古い PID は削除し、ユーザーが起動した VOICEVOX アプリは停止しない。
- `engines --json` の VOICEVOX `availability.detail` は `running`、`version`、`app_found`、`managed` を返す。設定画面の「止める」は `managed` の場合だけ有効。
- `generate` の従来の一時自動起動は、生成後に自分が起動した分を止めるまま。`start` で常駐させたエンジンを生成が止めることはない。

## 生成音声の聞き取り照合

- `akari narration verify --project <root> (--id n-0001 | --audio <path> --text <字幕の文字>) [--reading <読み原稿>] [--backend auto|speechanalyzer|whisper] --json` は、この Mac の SpeechAnalyzer または whisper.cpp で生成音声を聞き取り、字幕の文字と比べる。クラウドへ送らず、analysis / captions / edit に書かない。使える backend が無ければ exit 3 と `status: unavailable`、理由を返す。
- 字幕と聞き取りの文字を NFKC、英字小文字化、句読点・記号・空白除去のうえ、文字単位の編集距離で比較する。`score = 1 - 編集距離 / max(文字数)` を小数 3 桁で返し、連続した差を `diffs` にまとめる。読み原稿は比較せず結果に残す。
- verdict は `ok`（0.9 以上）、`check`（0.7 以上）、`ng`（0.7 未満）。**根拠のない初期値。較正は calibration/ で行う。**
- `--record <dir>` を明示したときだけ、そのディレクトリの `narration-verify.jsonl` に期待文、読み原稿、聞き取り、score、verdict、engine、voice、backend、時刻を 1 行 JSON で追記する。ポップアップからは指定しない。

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
