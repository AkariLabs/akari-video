# `akari media` 観察コマンド契約 v0 — probe / grab / filmstrip / waveform / transcribe

- 日付: 2026-08-29
- 状態: **v0（オーナー裁定済み 2026-08-29・実装未）**。実装タスクで判明した齟齬は追記で解消する
- 前提:
  - `notes-2026-08-08-cli-consolidation.md`（launcher = 依存ゼロ / akari-tools = 外部依存側。launcher は
    パスを遅延解決して子プロセス起動）
  - `contract-2026-07-25-project-structure-v0.md`（`.akari/sidecars/` `.akari/reports/` `.akari/cache/` の置き場）
  - `contract-2026-07-17-data-contract-versioning.md`（版必須・追加のみ・寛容リーダー）
  - `contract-2026-07-13-m5-analysis-report.md`（analysis.json v0）と
    `contract-2026-08-11-analysis-vision-tracks-v0.md` §0（**分析はプル駆動**・未生成 = キー無し）
  - `contract-2026-07-18-edit-json-v1-sources.md`（観察結果は (`src`, source 秒) で永続化する）
- スコープ: 素材 1 本を**見る**ための 5 コマンドの入出力・置き場・帳面（analysis.json）への追記規約。
  LLM を呼ぶ判断（何を見るか・所見・採点）は**スキル側**（`analyze-footage` / `critique-cut`）の仕事で本契約の外
- 姉妹契約: `contract-2026-08-29-capture-v0.md`（edit.json の完成フレームを見る `akari capture`）

## 0. 位置づけ — 一言で言い切る

**観察は CLI、判断はスキル。** 素材について「何が入っている / 何を喋っている / どこが静か / この時刻の絵は」に、
1 つの問いに 1 つのコマンドで答える。事前パス（全部分析）を前提にしない。LLM を呼ばない。決定論で速い。
結果はプロジェクト内なら**自動で帳面（analysis.json）に追記**され、次のセッションは帳面から始まる。

現状、この面は存在しない。観察相当のコードは `akari internal beat-sync-probe-frame` /
`beat-sync-beatmap` の裏に 2 本あるだけで、probe / filmstrip / waveform / transcribe はスキルの手順書の中で
ffmpeg / ffprobe / whisper.cpp を直接叩いている。本契約はそれを 1 か所に寄せ、公開面にする。
コマンド名 `media` は仮称（外部の `dapi media` に寄せた）。改名しても本契約の意味は変わらない。

## 1. 共通規約

| 項目 | 規約 |
|---|---|
| 呼び出し | `akari media <sub> <target> [options]`。`<target>` はローカルファイルのパス、または開いているプロジェクトの `sources[].id` |
| stdout | **JSON のみ**。結果が 1 個なら JSON 1 値、複数なら 1 行 1 個の JSON Lines（配列で包まない） |
| stderr | 人間向けの進捗・警告・エラー。機械は読まない |
| exit | `0` 成功 / `1` 失敗（ファイル無し・ffmpeg 不在・不正引数・書き込み失敗）。部分成功は無い |
| 決定論 | 同じ入力・同じオプションは同じ出力（PNG の寸法・コマ割り・時刻ラベルまで）。乱数・現在時刻を結果に混ぜない（`generated_at` を除く） |
| LLM | 呼ばない。クラウドも既定で呼ばない（`transcribe` の承認制クラウドのみ例外・§2.5） |
| 時刻の入力 | 秒（`12.5`）または `MM:SS(.fff)`。負値・尺超過は exit 1 |
| 時刻の出力 | 常に **source 秒**（数値）。タイムコード文字列はラベル用の付加情報 |
| 置き場 | 実装は `packages/akari-tools/bin/`（ffmpeg / ffprobe 依存側）。launcher は `internal-command.mjs` と同じ様式で `repo-assets.mjs` からパスを遅延解決し、子プロセスで起動する。launcher 自身は akari-tools を import しない |
| ffmpeg / ffprobe | `packages/render-cut/src/render-cut.mjs` の `resolveFfmpeg()` / `resolveFfprobe()` を再利用（探索規則を二重化しない） |
| プロジェクト外 | `.akari/` を祖先に持たないパスも受け付ける（インストール直後の「ちょっと見る」）。帳面が無いので出力だけ（§3） |

### 1.1 コンタクトシート（grab / filmstrip / capture が返す画像の共通仕様）

- 1 枚 **≤ 2576×1456 px**、**最大 12 コマ**。vision model が全解像度で読める上限に合わせる（12 時刻を画像 1 枚で読ませ、
  キーフレームを 1 枚ずつ読むより画像トークンを 1/12 にするのが目的）
- グリッドは「各コマが最大になる」ものを選ぶ。16:9 素材の目安:

| コマ数 | グリッド | 1 コマ |
|---|---|---|
| 1 | 1×1 | 1920×1080 |
| 2〜4 | 2×1 / 2×2 | 1280×720 |
| 5〜9 | 3×2 / 3×3 | 850×478 |
| 10〜12 | 4×3 | 636×357 |

- 13 コマ以上は複数枚に**均等割り**（13 → 7 + 6。12 + 1 にしない）。`--per-sheet <n>`（1〜12）で 1 枚あたりのコマ数を指定できる
- 各コマ左下にタイムコードラベル（`08s10f` / `01m05s` のようにゼロの単位を落とした形。フレームは 30fps 換算）。
  シート名は覆う範囲（`0f-11s.png`）
- 背景（コマ間の溝・透明部分）は不透明の中間グレー。素材が 1080p 未満なら 1080p 高さまで拡大、それ以上は拡大しない
- 実装は `packages/render-cut/src/contact-sheet.mjs`（`contactSheetGridDimensions` / `renderContactSheet`）を拡張して共用する。
  render-cut が書き出し後に自動生成する `.akari/reports/contact-sheet.png` と同じ描画コードにする（二重実装しない）

## 2. コマンド

### 2.1 `akari media probe <target>`

何が入っているファイルかを、デコードせずに答える。

```jsonc
{
  "path": "assets/interview.mov",          // 与えたパス（プロジェクト内なら root 相対）
  "sha256": "…",                           // 内容ハッシュ（transcribe キャッシュの鍵と同じ）
  "size_bytes": 1234567,
  "container": "mov",
  "duration_s": 754.2,
  "video": { "width": 3840, "height": 2160, "fps": 29.97, "codec": "hevc", "rotation": 0 } , // 無ければ null
  "audio": { "codec": "aac", "channels": 2, "sample_rate": 48000 },                          // 無ければ null
  "tool": { "ffprobe": "7.1" },
  "generated_at": "2026-08-29T10:00:00Z"
}
```

- 目安コスト: 一瞬。帳面には `probe` として追記（§3）

### 2.2 `akari media grab <target> -t <time…> [--separate] [--per-sheet <n>] [--out <dir>]`

指定時刻の絵を返す。既定はコンタクトシート、`--separate` で時刻ごとに 720p 高さの PNG 1 枚。

```jsonc
{ "kind": "sheet", "timecode": "0f-11s", "times_s": [0, 4.5, 11], "path": ".akari/reports/media/interview/grab-20260829T100000Z/0f-11s.png" }
```

- `-t` は 1 個以上必須。時刻はソースの秒（カット後のタイムラインではない — それは `capture`）
- 出力先の既定: プロジェクト内は `.akari/reports/media/<source-stem>/grab-<stamp>/`、プロジェクト外は OS の一時ディレクトリに
  `akari-grab-*` を新設（互いに上書きしない）
- 目安コスト: 秒。画像を読むトークンはシート 1 枚ぶん

### 2.3 `akari media filmstrip <target> [--count <n> | --every <sec> | --scenes [<threshold>]] [--per-sheet <n>] [--out <dir>]`

素材全体の絵の流れを返す。出力形は grab と同じ（シートの JSON Lines）。

- 既定は `--count 12`（等間隔 12 コマ = シート 1 枚）。`--every` は等間隔秒、`--scenes` は ffmpeg の scene 検出
  （閾値既定 0.3）でカット点を拾う。`--scenes` と `--count` の併用時は scene 点を優先して上限まで
- 目安コスト: 秒〜十数秒（長尺の `--scenes` はデコードを伴う）

### 2.4 `akari media waveform <target> [--silence-db <dB>] [--min-silence <sec>] [--out <dir>]`

音がどこにあるかを返す。PNG（波形。無音区間を色分け）と JSON。

```jsonc
{
  "path": "assets/interview.mov",
  "duration_s": 754.2,
  "png": ".akari/reports/media/interview/waveform.png",
  "silences": [ { "start": 12.4, "end": 13.6 }, … ],   // source 秒・閉区間ではなく [start, end)
  "speech_likely": true,                                 // 発話らしさの粗い判定（§4 の L1 ゲート）
  "loudness": { "integrated_lufs": -19.8, "peak_dbfs": -1.2 },
  "params": { "silence_db": -35, "min_silence_s": 0.6 },
  "generated_at": "…"
}
```

- 既定: `--silence-db -35`、`--min-silence 0.6`（analyze-footage の pause 候補と同じ値に揃える。違えばそちらに合わせる）
- `speech_likely` は「無音でない区間の割合と帯域エネルギー」の粗い判定でよい。**確度は出さない**（宣言のない能力は存在しない）。
  transcribe の要否を決めるゲートに使い、字幕の根拠にはしない
- 目安コスト: 秒。帳面には `tracks.waveform` として追記（§3）

### 2.5 `akari media transcribe <target> [--in <time> --out <time>] [--backend <name>] [--lang <code>]`

何を喋っているかを、語ごとの時刻つきで返す。

```jsonc
{
  "path": "assets/interview.mov",
  "range": { "in": 0, "out": 754.2 },         // 指定なしは全体
  "backend": "speech-analyzer",                 // speech-analyzer | whisper-cpp | cloud:<connection-id>
  "no_speech": false,
  "segments": [ { "start": 1.2, "end": 3.4, "text": "…", "words": [ { "text": "…", "start": 1.2, "end": 1.5 } ] } ],
  "cache": { "hit": false, "key": "<sha256>-0-754.2-speech-analyzer-ja" },
  "generated_at": "…"
}
```

- `segments[]` の形は analysis.json v0 の `transcript[]` と同一（そのまま写せる）。時刻は **source 秒**
- バックエンドは analyze-footage の 3 層と同じ優先順: macOS SpeechAnalyzer（26+・swiftc 可）→ whisper.cpp → クラウド。
  **クラウドは `--backend cloud:<connection-id>` を明示したときだけ**で、`.akari/connections.json` に doctor `ok` で
  登録済みの接続に限る。既定で外部に音声を送らない。キーの値を stdout / stderr / 出力ファイルに出さない
- どのバックエンドも使えなければ推測せず exit 1（理由を stderr に）。喋りが検出できなければ `no_speech: true` +
  `segments: []` で **exit 0**（失敗ではない）
- **キャッシュは内容ハッシュ**: `.akari/cache/transcribe/<sha256>-<in>-<out>-<backend>-<lang>.json`。同じ音声を二度起こさない。
  プロジェクト外は OS 一時領域の同名ディレクトリ
- 目安コスト: 実時間の 0.1〜1 倍（バックエンド依存）。帳面には `transcript` として追記（§3）

## 3. 帳面（analysis.json）への追記

### 3.1 いつ追記するか

- **プロジェクト内で、対象がプロジェクトの素材のとき、既定で追記する**（オーナー裁定 2026-08-29「見た結果は analysis.json に
  入れて全然大丈夫」）。抑止は `--no-record`
- プロジェクト外のファイル、または `.akari/` を祖先に持たない場所では**出力だけ**（帳面が無い）
- 帳面の場所は analyze-footage `workflow.md` の正典パス `.akari/sidecars/<source-relative-path>.analysis/analysis.json`。
  無ければ**最小の妥当な文書**を作る: `{ "version": 0, "source": "<path>", "transcript": [], "keyframes": [], "events": [],
  "tracks": { "speakers": [], "faces": [], "person_matte": null } }`。キーが無い = **まだ見ていない**（「無かった」ではない）

### 3.2 何を書くか（スキーマは additive・`version: 0` 据え置き）

正本は `packages/schemas/analysis.schema.json` のみを変える（`additionalProperties: false` のため、追加キーはスキーマ側に
宣言しないと analyze-footage の検証で落ちる）。`apps/shell/lib/schemas/analysis.schema.json` は**追跡対象外のビルド生成物**
（`apps/shell/.gitignore` の `/lib/`）で、ビルドが正本から生成する。手で写しを編集・コミットしない
（2026-08-29 訂正: 起草時は「両写しに同じ変更」と書いていたが、写しは git に無い。実装レーンの実測による）。

| コマンド | 書き先 | 形 |
|---|---|---|
| probe | 新設 optional `probe`（object） | §2.1 の JSON から `path` / `generated_at` を除いたもの |
| waveform | 新設 optional `tracks.waveform` | `visionTrackPointer` と同型のポインタ `{ path, tool, generated_at }`（path は §2.4 の JSON。analysis.json のディレクトリ基準の相対） |
| transcribe | 既存 `transcript[]` | 全体なら置換。`--in/--out` 付きなら **その範囲の segments を差し替え**（範囲外は保持）。バックエンドは `observations[]` に残す |
| grab / filmstrip | `keyframes[]` には**書かない**（`note` は視認した者が書く分析であって観察ではない） | 生成した PNG は `observations[]` に載せるだけ |
| 全コマンド | 新設 optional `observations[]` | 下記 |

```jsonc
"observations": [
  { "kind": "waveform", "at": "2026-08-29T10:00:00Z", "args": { "silence_db": -35, "min_silence_s": 0.6 },
    "outputs": [ "waveform.json", "waveform.png" ], "tool": "akari media 0.1.x" },
  { "kind": "transcribe", "at": "…", "range": { "in": 120, "out": 180 }, "args": { "backend": "speech-analyzer", "lang": "ja" },
    "outputs": [], "tool": "…" },
  { "kind": "grab", "at": "…", "args": { "times_s": [0, 4.5, 11] }, "outputs": [ "../../reports/media/interview/grab-…/0f-11s.png" ], "tool": "…" }
]
```

- `observations[]` は**追記のみ**（並べ替え・削除しない）。「何をいつ見たか」の台帳であり、レポートの「未観察」表示と
  次セッションの出発点の根拠になる
- 書き込みは原子的（tmp → rename）。同時実行で壊さない。既存の未知フィールドは保持する（寛容リーダー）

### 3.3 レポート側の約束

`analyze-project` と分析レポートは**その時点で帳面にあるもの**から描き、無い章は「未観察」と正直に出す。
全章が埋まっている前提を置かない（これは本契約でなく `analyze-footage` / `analyze-project` の改訂で担う）。

## 4. 分析レベルと既定（`analyze-footage` の改訂方針。本契約は語彙を定義する）

| レベル | 見るもの | コマンド | 要る案件 |
|---|---|---|---|
| **L0 メタ** | 尺・解像度・音声の有無 | probe | 全部 |
| **L1 音** | 文字起こし・無音・ビート | waveform → transcribe / `internal beat-sync-beatmap` | 字幕・喋り物・音先行 |
| **L2 絵** | キーフレーム・フィルムストリップ（視認は人間 / スキル） | grab / filmstrip | カット判断・切り抜き・B ロール選定 |
| **L3 人物** | person matte / face landmarks / hand pose | 既存サイドカー（vision-tracks 契約） | 人物演出を使う素材の使う区間だけ |

- **既定は L0 + L1**（オーナー裁定 2026-08-29「音ぐらいは入れていい」）。L1 の既定手順: `waveform` を常に（秒で終わる）→
  `speech_likely` が真のときだけ `transcribe`。喋りの無い B ロール PV で無駄に起こさない
- L2 / L3 は案件と頼まれたことで決める。案件の型は**例示**であって閉じた列挙ではない（intake に「案件タイプ」は持たない）
- どのレベルで見ても結果は帳面へ（§3）

## 5. 非スコープ

- マルチモーダルモデルに「聴かせる / 見せる」コマンド（外部の `listen` 相当）。判断はスキルの仕事
- GUI（shell の素材パネルからの呼び出し）。後続
- 複数素材の一括（`analyze-project` の仕事）
- edit.json の完成フレーム（`capture` 契約）

## 6. 受け入れ条件（実装タスクの物差し）

- 5 コマンドがフィクスチャ（`packages/schemas/fixtures/` または akari-tools の小さな mp4 / wav）で契約どおりの JSON を返す。
  stdout に JSON 以外を出さない（launcher 経由でも）
- コンタクトシートの割付（コマ数 → グリッド・均等割り・寸法上限）に**純関数のユニットテスト**がある
- waveform: 合成 wav（無音 2 秒 + トーン 3 秒 + 無音 1 秒）で `silences` が期待区間 ±1 フレームに収まる
- transcribe: 同じファイルの 2 回目がキャッシュヒット（`cache.hit: true`・バックエンド未起動）。バックエンド不在で exit 1
- 帳面: プロジェクト内で `probe` → `waveform` → `transcribe` の順に実行した analysis.json が正本スキーマで妥当（ビルド生成の shell 写しがあればそれでも）。
  `--no-record` で無変更。プロジェクト外で `.akari/` を作らない
- launcher: `akari media --help` が 5 サブコマンドを列挙し、akari-tools 不在時は「インストール方法」を示して exit 1
- 既存テスト（akari-launcher / akari-tools / schemas）が全緑

## 7. 変更履歴

- 2026-08-29: v0 起草（内部の判断メモ「分析をプル駆動にする」のオーナー裁定を反映。裁定内容は非公開の内部記録で管理）
- 2026-08-29: §3.2 / §6 訂正 — shell 側スキーマは追跡外のビルド生成物なので正本 1 本だけを変える（実装レーン `2026-08-29-media-inspect-cli` の実測）
