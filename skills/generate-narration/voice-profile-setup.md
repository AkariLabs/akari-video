# 自分の声プロファイル（v2）

本人の声を録ったファイルを `<AKARI_HOME>/avatars/<人>/voice/<声の id>/` に正本として保存する。`AKARI_HOME` の既定は `~/.akari`。正本は `ref-recording.wav`（48 kHz・モノラル）、同意と原稿照合を記録した `meta.json` で構成される。アバターの `voice/voice.json` に既定の声 ID を置く。

彩サーバーの登録と fal Qwen3 の声は「写し」。正本の録音から作り直せる。録音は本人の声に限り、同意を記録する。クラウドの写しは本人のクラウド送信同意、ローカルの原稿照合 70% 以上、費用承認の `--yes` が揃ったときだけ作る。聞き取り機能がない PC からクラウドへは送らない。

```sh
akari voice scripts --json
akari voice check --audio <録音> --script quick-v1 --json
akari voice create --avatar <人> --id <声のid> --label <表示名> --audio <録音> --script quick-v1 --consent-self --json
akari voice copy --profile <声のid> --engine irodori --json
akari voice try --profile <声のid> --engine irodori --text 'こんにちは。' --json
akari voice profiles --json
```

- 原稿は `quick-v1`（約 20 秒）と `extended-v1`（約 60 秒）。`scripts` が返した本文をそのまま読む。`check` は長さ、音量、周囲の音、原稿との一致を確認する。周囲の音だけは警告で、作成を止めない。
- `create` でクラウド送信に同意する場合は `--consent-cloud` を追加する。作成時には写しを作らない。
- 彩への `copy` は `--irodori-url`、`AKARI_IRODORI_URL`、`http://127.0.0.1:8088` の順に接続先を決める。録音を multipart で送って `akari-<id>` として登録する。ローカルサーバーへの登録は無料。
- fal の写しは `akari voice copy --profile <id> --engine fal-qwen3 --yes --json`。約 $0.01 の費用と録音の外部送信がある。`--yes` がなければ見積りだけを返す。`try` の fal 生成にも `--yes` が必要。
- `akari narration generate --engine irodori|fal-qwen3 --profile <id>` は新しい場所を優先し、旧い `~/.config/akari-video/voice-profiles/<id>/` も読む。彩の写しがない声は `voice copy` で登録してから使う。
- `akari voice delete --profile <id> --json` は正本と彩サーバーの写しを消す。fal 側の声は残る。`--keep-server` なら彩の登録も残す。
- `akari voice migrate-legacy --profile owner-ja --avatar <人> --json` は旧い声をコピーする。旧ディレクトリは残り、録音の形式も変えない。

## 旧来の手順

以下は従来の fal 単独プロファイルを作成した際の手順である。新規登録は上の v2 CLI を使用する。

### 1. 原稿提示

同梱の [assets/reading-script-v1.md](assets/reading-script-v1.md) を人間にそのまま提示する。
本文は正文であり、人間が読みやすいよう言い換えたり要約したりしない
（`reference_text` と完全一致させる必要があるため）。約 330 字・45〜60 秒を目安と伝える。

### 2. 録音（2 経路）

どちらでもよい。

- **経路 A（既定）**: iPhone / Mac のボイスメモで原稿を読んでもらい、共有・書き出しで
  `~/Downloads` へ保存してもらう（AirDrop 含む）。追加権限が要らず、既存の録音習慣と一致する。
- **経路 B（全自動）**: `ffmpeg -f avfoundation -i ":<device>"` でマイクから直接録音する。
  利用可能なデバイスは `ffmpeg -f avfoundation -list_devices true -i ""` で確認する
  （初回のみマイク許可プロンプトが出る）。

### 3. 拾いルール

セットアップ開始時刻の mtime を記録しておき、`~/Downloads` の中で**その時刻以降に更新された**
最新の音声ファイル（m4a / wav / mp3）を対象にする。ボイスメモの自動命名は録音場所に由来し
ファイル名からは内容を推定できないため、**ファイル名ではなく mtime で拾う**。

### 4. 送信前ガード（省略不可、ハードルール 2）

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

### 5. クローン（fal `clone-voice/1.7b`）

`FAL_KEY` は `~/.config/akari-video/credentials.env` から読む（manage-connections 経由のみ。
ハードルール 5）。参照音声を data URI にエンコードし、`reference_text` に §1 の原稿本文をそのまま
渡して `fal-ai/qwen-3-tts/clone-voice/1.7b` を呼ぶ。応答の `speaker_embedding.url` が
声プロファイル資産（`embedding_source_url`）になる。**有償操作**なので、実行前に対象・使う手・理由・
代替案・費用・待ち時間・外部送信・provenance を宣言し、明示承認を得てから送信する
（[../manage-connections/SKILL.md](../manage-connections/SKILL.md) の Decision Communication Contract
と同型。クローンは声につき通常 1 回のみで費用は僅少だが、宣言自体は省略しない）。

### 6. 保存

`~/.config/akari-video/voice-profiles/<name>/` に以下を保存する（`credentials.env` と同じ
ユーザーレベル・git 管理外）。

- `embedding.safetensors`（または `embedding_source_url` を meta.json に記録し、資産は fal 側 URL
  参照のままでもよい。実装は `akari narration generate` の fal-qwen3 アダプタが
  `meta.json` の `embedding_source_url` を読む前提に合わせる）
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

### 7. 検収

短文 1 本（数十文字程度、$0.01 未満）を fal-qwen3 アダプタで試し生成し、`afplay` 等で人間に耳確認して
もらう。OK であればプロファイルは有効化完了。似度が不足する場合は、静かな環境で 30〜60 秒のナレ調
録音を撮り直してプロファイルを作り直す（NG 判定はその後で行う）。
