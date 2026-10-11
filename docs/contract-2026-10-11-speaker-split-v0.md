# 話者分離と声の照合のデータ契約 v0

状態: v0。既定はふつうの文字起こしで、話者を分けない。話者分離は選んだときだけ行い、確認するのは人数だけとする。誰の声かは、チャンネルの人物のうち同意済みの声の見本がある人とだけ照らす。照合結果は提案であり、名前を決めるのは人である。

## 文字起こしと話者分離

```text
akari media transcribe <target> [--diarize] [--speakers auto|1|2|3|4] [--identify] [--people <people.json>]
```

- 旗なしでは通常の文字起こしを行う。結果 JSON と ASR のキャッシュの鍵は従来どおりである。
- `--diarize` は話者を分ける。`--speakers` の既定は `auto`。`1`〜`3` はクラスタ数を指定し、`4` は「4 人以上」として自動判定する。`--speakers` だけでも話者分離を有効にする。`1` は指定クラスタ数で 1 回だけ分離する。`2`〜`3` を指定した場合、各話者が 3 秒以上かつ全発話時間の 3% 以上で人数がちょうど一致した結果を採用する。満たさなければ自動の結果に戻し、そのことを標準エラーに 1 行示す。
- 自動の結果がちょうど指定の N 人なら、短い話者がいても戻したことにはしない。
- `--identify` は人物の声と照らす。話者分離も有効にする。`--people` は照合に使う `people.json` を指定し、これだけでも `--identify` と話者分離を有効にする。省略時は対象プロジェクトが `channels/<c>/videos/<p>/` にあれば、そのチャンネルの `people.json` を使う。見つからなければ警告を出し、照合を省く。
- 声のエンジンが無い場合は exit 2 で `話者を分けるには準備が要ります（akari tools install voice か、アプリの『字幕を作る』から）` と案内する。通常の文字起こしには声のエンジンを要求しない。

結果 JSON には、話者分離を選んだときだけ `speakers` が加わる。`count` は話者数、`ids` は `A` からの話者 ID、`seconds` は話者ごとの発話秒数、`requested` は指定人数（自動なら `"auto"`）、`fallback` は自動結果へ戻したかどうかである。同じ 2 つを voices.json にも記す（照合できない環境でも書く）。照合できた場合だけ `identify` が加わり、`compared` は実際に比較した人物参照、`suggestions` は話者ごとの候補となる。
`speakers.shortSpeakers` は採用条件を満たさない話者 ID の配列で、空なら省く。

```json
{
  "speakers": {
    "count": 2,
    "requested": 2,
    "fallback": false,
    "ids": ["A", "B"],
    "seconds": { "A": 42.2, "B": 31.5 },
    "identify": {
      "compared": ["channel/p-123"],
      "suggestions": {
        "A": { "person": "channel/p-123", "name": "中島さん", "score": 0.86, "level": "strong" },
        "B": { "score": 0.31, "level": "none" }
      }
    }
  }
}
```

`level` は `strong`（0.60 以上）、`maybe`（0.45 以上 0.60 未満）、`none`（0.45 未満）。`none` には `person` と `name` を付けない。しきい値は `packages/akari-voice/src/identify.mjs` の `VOICE_MATCH_LEVELS` にまとめた仮置きで、較正は後日行う。`strong` でも自動確定しない。自動判定で同じ人物に強く一致したクラスタは束ねる。

`analysis.json` には発話と一番長く重なる話者を `transcript[].speaker` に記し、`tracks.speakers` に `{ "id": "A", "spans": [[開始秒, 終了秒]] }` を並べる。重なる話者がいない発話には `speaker` を付けない。声の埋め込みは `analysis.json` に入れない。

ASR のキャッシュは従来のままで、話者分離は `.akari/cache/diarize/` の別キャッシュに保存する。分離の鍵は音声の SHA-256、対象範囲、`--speakers`、声のエンジンの版から作る。

## 声の側ファイルと人物の重心

プロジェクト内の素材では、`.akari/sidecars/<素材の相対パス>.analysis/voices.json` に声の特徴量と提案を保存する。埋め込みは 256 次元の float32 を little-endian のバイト列として base64 化したもの。埋め込みを作れた話者だけが `speakers` に入る。埋め込みを作れない場合も空の `speakers` と `requested`、`fallback` を保存する。再分離しても `decided` は保持する。
voices.json の `shortSpeakers` も採用条件を満たさない話者 ID の配列で、空なら省く。

```json
{
  "schema": "akari.voices/0",
  "requested": 2,
  "fallback": false,
  "key": {
    "model": "wespeaker-voxceleb-resnet34-LM",
    "space": "wespeaker/voxceleb_resnet34_LM",
    "preprocess": "akari.voice/hamming-cmn-tile10-v1"
  },
  "speakers": {
    "A": { "seconds": 42.2, "embedding": "<base64 float32 × 256>", "suggestion": { "person": "channel/p-123", "name": "中島さん", "score": 0.86, "level": "strong" } }
  },
  "decided": { "A": "channel/p-123" }
}
```

人物の重心は、`people.json` の `voice.samples[]` のうち `consent` が `self` または `subject` の見本だけで作る。各見本を 16 kHz モノラルに変換し、埋め込みを平均して L2 正規化する。`channels/<c>/.akari/voice-centroids.json` に、埋め込みの `key` と見本ファイルの SHA-256 を使ってキャッシュする。

声の特徴量は個人を識別できる情報としてこの機械の中だけで扱う。外へ送らず、記憶パックや配布物に入れない。`.akari/sidecars/` のうち `voices.json` だけを履歴から外し、AI の読み取りも禁止する。
既存プロジェクトの `.claude/settings.json` は、プロジェクトを開いたときに voices.json の読み取り拒否を 2 行追加する。

## 話者に名前を付ける

```text
akari speakers set <target> <A> --person <channel>/<id> | --name <名前> | --clear
akari speakers list <target> [--json]
```

`set` は人が確認した結果をプロジェクトの `.akari/dictionary.json` の `speakers.<id> = { name, person }` に書く。`--name` だけなら `name` を保存し、既存の `person` は保持する。`--person` で人物を決め、声の側ファイルがある場合は `voices.json` の `decided` にその人物参照を保存する。`--clear` は辞書の決定と側ファイルの `decided` を消す。`list` は秒数、提案、決定を表示し、`--json` なら JSON で返す。実装の入口は `packages/akari-tools/bin/speakers.mjs`。ランチャーから `akari speakers` として実行する。

## 声のエンジン

実行時の部品 `sherpa-onnx-node`、対応プラットフォームの `sherpa-onnx-<plat>`（Windows は `sherpa-onnx-win-x64`）、`onnxruntime-node` と、WeSpeaker ResNet34-LM、pyannote segmentation 3.0、Silero VAD の 3 モデルはアプリに同梱しない。初回に `akari tools install voice` またはアプリの「字幕を作る」から `<AKARI_HOME>/tools/voice/` へ取得する。実装が認識する形は `manifest.json`、`runtime/<platform>-<arch>/node_modules/`、`models/`。`AKARI_VOICE_HOME` で置き場を差し替えられる。対応する環境は `win32-x64`、`darwin-arm64`、`darwin-x64` である。

Intel Mac（`darwin-x64`）では話者を分けられるが、声の照合はできない。この環境では `onnxruntime-node` と `onnxruntime-common` を準備の必須条件にしない。

`key.preprocess` の `hamming-cmn-tile10-v1` は、Kaldi 互換の fbank に hamming 窓を使い、録音全体の特徴量平均を引き、10 秒未満の発話を敷き詰めてから WeSpeaker に渡す処理を指す。照合用の埋め込みは `onnxruntime-node` で作る。

| モデル・部品 | 許諾 | 出典 |
|---|---|---|
| WeSpeaker ResNet34-LM | CC BY 4.0（帰属表示が必要） | [wenet-e2e/wespeaker](https://github.com/wenet-e2e/wespeaker) |
| pyannote segmentation 3.0 | MIT | [pyannote/pyannote-audio](https://github.com/pyannote/pyannote-audio) |
| Silero VAD | MIT | [snakers4/silero-vad](https://github.com/snakers4/silero-vad) |
| sherpa-onnx | Apache-2.0 | [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) |
| onnxruntime | MIT | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) |

## 実装の場所

- `packages/akari-voice/src/voice-home.mjs`: エンジンの置き場、状態、実行時部品の読み込み。
- `packages/akari-voice/src/audio.mjs`: 音声の読み込みと話者区間の連結。
- `packages/akari-voice/src/fbank.mjs`: Kaldi 互換 fbank。
- `packages/akari-voice/src/embed.mjs`: 埋め込みの前処理、推論、符号化。
- `packages/akari-voice/src/diarize.mjs`: 話者分離、ラベル、発話への割り当て。
- `packages/akari-voice/src/identify.mjs`: 人物候補と一致度の判定。
- `packages/akari-voice/src/centroids.mjs`: 人物の見本と重心のキャッシュ。
- `packages/akari-voice/src/voices-file.mjs`: 声の側ファイル。
- `packages/akari-voice/src/dictionary.mjs`: 話者辞書。
- `packages/akari-voice/src/index.mjs`: 公開するモジュールの入口。

## 対象外

この版では文字起こしのエンジンの追加、別方式の話者分離、顔による照合、他の製品の声の台帳の取り込みは行わない。
