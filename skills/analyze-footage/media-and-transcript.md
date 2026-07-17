# プロキシ生成と文字起こし

## 目次

- [720p プロキシ](#720p-プロキシ)
- [文字起こしバックエンドを選ぶ（3 層）](#文字起こしバックエンドを選ぶ3-層)
- [provenance（backend の記録）](#provenancebackend-の記録)
- [文字起こし不能時の劣化](#文字起こし不能時の劣化)

## 原則

映像の時刻対応を変えずに軽量化し、発話は取得できた証拠だけを保存する。既定はローカルとし、登録済みクラウドは決定カードで人間が明示承認した場合だけ使う。ツール不足を推測で埋めない。

## 720p プロキシ

原本の縦横比を保ち、1280×720 の枠内へ収める。次の scale 構文は FFmpeg 公式ドキュメントの例に基づく。

```bash
ffmpeg -hide_banner -nostdin -y -i "$SOURCE" \
  -map 0:v:0 -map '0:a?' \
  -vf "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart \
  "$OUT_DIR/proxy.mp4"
```

720p は AKARI Video のプロキシ契約値である。生成後に `ffprobe` で width、height、duration、映像・音声ストリームを確認し、幅 1280 以下かつ高さ 720 以下、duration が原本と対応していることを確かめる。縦動画を引き伸ばしたり、プロキシ生成時に trim したりしない。

一次資料: [FFmpeg Filters Documentation — scale](https://ffmpeg.org/ffmpeg-filters.html#scale)

## 文字起こしバックエンドを選ぶ（3 層）

既定は層 1、利用できなければ層 2 へ進む。層 3 は層 1/2 の結果とは独立したオプトイン候補であり、接続条件を満たしても人間の明示承認なしには使わない。

### 層 1: macOS SpeechAnalyzer（Mac 既定）

- 使用条件は `sw_vers -productVersion` のメジャーが 26 以上で、`swiftc` を呼び出せること。`node bin/transcribe-sa.mjs --check` で判定し、`available:false` ならその `reason` を報告して層 2 へ進む。
- ヘルパーは [bin/speechanalyzer-helper.swift](bin/speechanalyzer-helper.swift) に置く。internal `tasks/2026-07-18-stt-3way-comparison/artifacts/speechanalyzer-helper.swift` から実証済みソースを取り込んだものである。初回使用時に `swiftc -O` で自動ビルドし、バイナリはコミットしない（[.gitignore](.gitignore) 参照）。ネットワークから新しいツールを導入せず、既存の Command Line Tools だけを使う。
- `node bin/transcribe-sa.mjs --input <mono 16kHz wav などデコード可能な音声>` で実行する。層 2 の「音声を入力形式へ変換する」で作る `whisper-input.wav` を共用してよい。
- ヘルパーが `kAFAssistantErrorDomain Code=1101` などで失敗したら自動リトライせず、層 2 へフォールバックして理由を完了報告に書く。

### 層 2: whisper.cpp（共通フォールバック）

#### whisper.cpp の実行ファイルを探す

ネットワークから自動導入せず、次の順で読み取り・実行可能なものを探す。

1. `WHISPER_CPP_BIN` で明示されたパス
2. `PATH` 上の `whisper-cli`（Homebrew の `whisper-cpp` フォーミュラを導入した開発機では `/opt/homebrew/bin/whisper-cli` が `Cellar/whisper-cpp/<version>/bin/whisper-cli` へのシンボリックリンクとしてここに乗り、この順位で見つかる。2026-07-14 時点で実在・動作確認済み）
3. リポジトリ内または隣接する whisper.cpp checkout の `build/bin/whisper-cli`

候補を見つけたら `-h` を実行し、`-m`、`-f`、`-l auto`、`-oj`、`-ojf`、`-of` を受け付ける版か確認する（`whisper-cpp 1.8.4` の `-h` 出力で全オプションの存在を確認済み）。名前が一般的すぎる `main` を由来確認なしで使わない。

#### モデルを探す

次の順に `ggml-*.bin` を探索する。

1. `WHISPER_CPP_MODEL` で明示された読み取り可能なファイル
2. リポジトリ内の `models/`、`whisper.cpp/models/`
3. `$HOME/.cache/whisper.cpp/`
4. `$HOME/Library/Caches/whisper.cpp/`
5. Homebrew の `whisper-cpp` が導入済みなら、その share ディレクトリ
6. VoiceInk（`com.prakashjoshipax.VoiceInk`）が保存した whisper.cpp モデル: `$HOME/Library/Application Support/com.prakashjoshipax.VoiceInk/WhisperModels/`

6 は姉妹スキル `whisper-transcribe` が既定で再利用するモデル置き場と同じである。1〜5 のいずれかで見つかればそちらを優先し、6 はそれらが全て空のときだけ評価する。1〜5 が典型的な開発機ではどれも存在せず `transcript: []` へ不要に劣化していたため、この開発機で実際にモデルが手に入る場所を探索順の最後に加えた。実在確認: 2026-07-14 時点でこのパスに `ggml-large-v3-turbo-q5_0.bin`（約 574 MB）が存在することを確認済み。

存在するルートだけを対象に、例えば zsh では次のように列挙する。

```zsh
MODEL_ROOTS=(
  "$REPO_ROOT/models"
  "$REPO_ROOT/whisper.cpp/models"
  "$HOME/.cache/whisper.cpp"
  "$HOME/Library/Caches/whisper.cpp"
)
if command -v brew >/dev/null && BREW_PREFIX="$(brew --prefix whisper-cpp 2>/dev/null)"; then
  MODEL_ROOTS+=("$BREW_PREFIX/share/whisper-cpp")
fi
MODEL_ROOTS+=("$HOME/Library/Application Support/com.prakashjoshipax.VoiceInk/WhisperModels")

for model_root in "${MODEL_ROOTS[@]}"; do
  [[ -d "$model_root" ]] || continue
  find "$model_root" -type f -name 'ggml-*.bin' -not -name 'for-tests-*' -print
done
```

探索範囲をファイルシステム全体へ無制限に広げない。whisper.cpp の `for-tests-*` はテスト専用なので、広い探索で見えても本番文字起こしに使わない。複数候補がある場合は、明示指定を最優先し、次に上記の探索順で見つかったローカルの多言語モデルを使い、選択理由を報告する。英語専用の `*.en.bin` は、素材が英語だと確認できた場合だけ使う。

#### 音声を入力形式へ変換する

音声ストリームがある場合だけ、プロキシから mono 16 kHz PCM WAV を作る。

```bash
ffmpeg -hide_banner -nostdin -y -i "$OUT_DIR/proxy.mp4" \
  -map 0:a:0 -ar 16000 -ac 1 -c:a pcm_s16le \
  "$OUT_DIR/whisper-input.wav"
```

16 kHz PCM への変換手順と CLI オプションは whisper.cpp 公式資料に基づく。

一次資料: [whisper.cpp CLI README](https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/README.md)

#### ローカル文字起こしを実行する

```bash
"$WHISPER_BIN" \
  -m "$WHISPER_MODEL" \
  -f "$OUT_DIR/whisper-input.wav" \
  -l auto -oj -ojf \
  -of "$OUT_DIR/whisper.raw"
```

`-of` は拡張子を含まない出力 prefix であり、生成された JSON の実在パスを確認する。API キーを使うクラウド文字起こしへ勝手に切り替えない。

#### whisper JSON を正規化する

raw JSON をそのまま `analysis.json` に貼らない。公式 CLI 実装では segment と token の `offsets.from/to` はミリ秒整数、`timestamps.from/to` は表示用文字列である。数値時刻は `offsets` を 1000 で割って source 秒へ変換する。

一次資料: [whisper.cpp CLI source](https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/cli.cpp)

正規化ルール:

- segment を必須の `{ start, end, text }` と、根拠がある場合だけ任意の `speaker`、`words` に正規化する。
- `start` と `end` は `offsets.from / 1000`、`offsets.to / 1000` とし、`end > start` を確認する。
- 通常実行には話者分離がないため `speaker` を省略する。実際に話者分離を実行して対応を確認できた場合だけ非空 ID を入れる。
- `words` は次項の手順で**原則組み立てる**（word 単位のカット精度、字幕の文字追従表示、タイムスタンプを保った字幕修正など下流機能の基盤になるため）。信頼できる単語時刻をどうしても作れない segment に限り `words` を省略し、省略した segment 数と理由を完了報告に書く。
- transcript を source 時刻の昇順に並べ、原本 duration 外へはみ出さないことを確認する。
- `tracks.speakers` は話者分離を実際に行い、各 ID の区間を確認できた場合だけ作る。通常実行では空配列にする。

1000 による換算は whisper.cpp のミリ秒出力を秒契約へ変える単位換算であり、編集上の閾値ではない。

#### words（単語タイムスタンプ）を組み立てる

full JSON の `tokens[]` は BPE 単位であり、日本語ではマルチバイト文字が token 境界で分断されて、**token 単体の `text` が不正なバイト列になる**ことがある（実測: 62 分の日本語実素材で該当。strict UTF-8 の `json.load` がファイル全体で失敗する）。raw JSON をバイト単位で読み、次の手順で word を復元する。

1. segment 内の token を順に走査し、制御 token（`[_BEG_]` など `[` 始まり）と空文字を除く。
2. 連続する token の `text` バイト列を連結し、**有効な UTF-8 になった時点で 1 word として確定**する。`start` は先頭 token の `offsets.from / 1000`、`end` は末尾 token の `offsets.to / 1000`。
3. 末尾に不正バイトの端数が残った場合は直前の word に吸収し、それでも復元できないバイトは捨てて完了報告に書く。`U+FFFD`（置換文字）を `words[].text` に残さない。
4. word の時刻が親 segment の区間からはみ出す場合は segment 区間へクランプする。クランプで `end > start` を保てない word は捨てる。

日本語では「word」は形態素単位ではなく token 連結由来のかたまりになるが、字幕追従・カット精度の用途にはこの粒度で足りる。粒度の細かさより時刻の正確さを優先する。segment 単位の `text` しか使わない場合でも、raw JSON の読み込み自体が strict UTF-8 で失敗しうる点は同じなので、バイト単位読み（または `errors='replace'` での読み捨て）を最初から使う。

### 層 3: クラウド（オプトイン・決定カード）

- 層 1/2 のローカル結果とは独立に、`.akari/connections.json` の `elevenlabs`（ElevenLabs Scribe = 品質枠）または `groq`（Groq whisper = 速度枠）が `doctor.status === "ok"` で、credentials.env に対応キーが設定済みのときだけ決定カードを**提案してよい**。未設定または非 ok の provider は選択肢自体を出さない。既定はあくまでローカルである。
- `node bin/transcribe-cloud.mjs --decision-card --project-root <.akari を持つプロジェクトルート> --duration <source 秒>` で決定カードを得る。速度（RTF・待ち時間見積）× 品質（所見）× 費用（概算）の 3 軸を SpeechAnalyzer の基準値とクラウド候補で提示する。実測値は internal 契約 §2 の表を引用する。
- 人間の明示承認を得るまで音声を送信しない。
- 送信前に音声を mono 32〜64k へ抽出する。Groq は 32k、Scribe は 64k を既定にする。

  ```bash
  ffmpeg -hide_banner -nostdin -y -i "$OUT_DIR/proxy.mp4" \
    -map 0:a:0 -ac 1 -c:a aac -b:a "${BITRATE}k" \
    "$OUT_DIR/cloud-input.m4a"
  ```

- 承認後だけ実送信する。

  ```bash
  node bin/transcribe-cloud.mjs --send --provider scribe|groq \
    --input "$OUT_DIR/cloud-input.m4a" --duration <source秒> \
    --project-root <...> --approved
  ```

- 単発送信を既定とする。プロバイダの上限（Groq 25MB・Scribe 10 時間相当）を超える場合だけ、無音検出を優先した境界で分割し**逐次**送信する（**並列同時送信は実装しない**。`grep -n "Promise.all\|allSettled\|worker_threads" bin/transcribe-cloud.mjs` で不在を確認できる）。各分割区間の word/segment 時刻は分割開始オフセットを加算してから 1 本の transcript へ縫合する。

## provenance（backend の記録）

- 使用した backend（`speechanalyzer` / `whisper-cpp` / `scribe` / `groq`）は **analysis.json には書かない**。`packages/schemas/analysis.schema.json` の `transcriptSegment` は `additionalProperties: false` で `backend` を許可しておらず、このタスクの境界（`packages/**` は編集禁止）ではスキーマを変更できない。既存の「劣化理由は Schema 外のフィールドとして JSON に足さず、完了報告に書く」規約と同じ扱いとし、使用した backend と選定理由を完了報告に明記する（[workflow.md](workflow.md) の完了報告項目を参照）。
- filler イベント検出は whisper.cpp 由来 transcript ではフィラーが正規化で脱落するため、SpeechAnalyzer / Scribe 由来 transcript がある場合はそちらを優先する（[events-and-hooks.md](events-and-hooks.md) 参照）。

## 文字起こし不能時の劣化

音声ストリームがない場合、または層 1/2 が失敗し、層 3 も非該当・未承認・失敗となって 3 層すべてから有効な結果を得られない場合は、`transcript: []` として視覚分析を続ける。ほかの根拠で確認済み話者 track がなければ `tracks.speakers: []` とする。次の原因を確認し、該当するものを報告する。

- 音声ストリームがない。
- SpeechAnalyzer の利用条件を満たさない、ビルドできない、またはヘルパーが失敗した。
- `whisper-cli` がない、実行できない、または必要なオプションに非対応である。
- 読み取り可能な適合モデルがない。
- 音声変換または推論が失敗し、有効な時刻付き結果を回収できない。
- 推論自体は成功したが、出力がハルシネーション（非発話区間への定型文出力等）と判定でき、実発話の記録として採用できない（判定基準は次項）。
- 登録済みで doctor ok のクラウド provider がない、明示承認がない、または承認後の送信が失敗した。

### ハルシネーション疑いの判定基準

whisper.cpp は無音・環境音のみの区間に対しても、学習データ由来の短い定型英語フレーズ（"Thank you." "Thanks for watching." "Bye." 等）を確信度高く出力することがある。これは実行時エラーを起こさないため、上の 4 条件だけでは検出できない。次のいずれかに強く合致する segment は採用しない。

- **音声エネルギー突合**: 該当区間の音声にエネルギーがあるかを ffmpeg の `volumedetect` で確認し、無音〜背景ノイズレベルの区間に発話が記録されていないか照合する。

  ```bash
  ffmpeg -hide_banner -nostdin -i "$OUT_DIR/whisper-input.wav" -af volumedetect -f null - 2>&1 \
    | grep -E "mean_volume|max_volume"
  ```

- **短い定型文の反復**: 内容が変化しないまま同一・類似の短い定型文が複数 segment にわたって繰り返され、transcript 全体の文脈と噛み合わない。
- **視認済みキーフレームとの矛盾**: [keyframes-and-review.md](keyframes-and-review.md) で視認した keyframe に人物・発話の兆候（口の動き、字幕、マイク等）がないのに、断定的な発言内容が記録されている。

いずれかに合致する segment は transcript から除外する。全 segment が該当するなら `transcript: []` に確定する。一部 segment だけが該当する場合は、除外した segment を除いた残りで transcript を組み立て、除外理由を完了報告に書く。判断に迷うグレーな segment は黙って残さず、根拠とともに完了報告へ書いて人間の確認を仰ぐ。

実測記録: testsrc 60 秒 + 440Hz 正弦波音声（実発話なし）の素材を whisper.cpp（`ggml-large-v3-turbo-q5_0.bin`）で文字起こしした際に "Thank you." が出力され、音声エネルギー突合（正弦波トーンのみで発話兆候なし）と視認済みキーフレーム（テストパターンのみで人物・字幕なし）の両方と矛盾することを確認して不採用にした事例がある。

完了報告には `transcript_unavailable` と具体的理由、探索した実行ファイル・モデルの場所を書く。空配列を「発話なし」と断定せず、「文字起こし未取得」と明記する。ハルシネーション判定で除外した場合も、除外した segment の内容・時刻・根拠を完了報告に書く。

## よくある間違い

- モデルを見つけるために無断ダウンロードする。
- 日本語素材へ英語専用モデルを使い、壊れた文字列を確定する。
- `timestamps` の表示文字列を浮動小数として雑にパースする。
- ミリ秒を秒として保存し、全 event 時刻を 1000 倍ずらす。
- token の確率や内部 ID を Schema 外のフィールドとして残す。
- token 1 個 = 1 word とみなし、分断されたマルチバイト文字を `U+FFFD` のまま `words` に残す。
- 作れるのに `words` を省略し、word 精度のカット・字幕追従など下流機能の基盤を欠落させる。
- whisper.cpp がないのに transcript を要約から捏造する。
- ハルシネーション疑いの定型文を音声・視認と突合せず transcript として確定する。
- クラウド決定カードの明示承認前に音声を送信する。
- 分割送信を並列（`Promise.all` 等）で実装し、無料枠のレート制限へ配慮しない（契約 §3 で明示的に不採用と裁定済み）。
