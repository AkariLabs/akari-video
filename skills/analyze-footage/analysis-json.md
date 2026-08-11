# analysis.json の組み立てと検証

## 目次

- [最小形と要素](#最小の有効形)
- [意味制約](#schema-では表せない意味制約)
- [検証と確定](#検証して確定する)

## 原則

このスキルの `references/analysis.schema.json` を唯一の構造定義として使う。トップレベルと各 object は未知フィールドを許可しないため、作業メモ、信頼度、劣化理由、生成ツール情報を勝手に追加しない。

## 最小の有効形

```json
{
  "version": 0,
  "source": "../../clip.mp4",
  "transcript": [],
  "keyframes": [],
  "events": [],
  "tracks": {
    "speakers": [],
    "faces": [],
    "person_matte": null
  }
}
```

全 6 トップレベル項目は必須である。配列が空でも省略しない。

## 各要素の形

```json
{
  "start": 1.2,
  "end": 3.4,
  "text": "発話本文"
}
```

`speaker` と `words` は任意であり、確認できた場合だけ次のように追加する。

```json
{
  "start": 1.2,
  "end": 3.4,
  "text": "発話本文",
  "speaker": "A",
  "words": [
    { "start": 1.2, "end": 1.6, "text": "発話" }
  ]
}
```

[media-and-transcript.md のハルシネーション疑いの判定基準](media-and-transcript.md#ハルシネーション疑いの判定基準)に合致した segment はこの配列に含めない。全 segment が該当する場合は `transcript: []` のまま確定する。

```json
{
  "t": 12.0,
  "path": "keyframes/kf-0001-t12.000.jpg",
  "note": "画面共有へ切り替わり、資料タイトルが中央に表示されている。",
  "origin": "scene"
}
```

`origin` は任意で、採用元の抽出系統（`scene` / `interval` / `transcript`）を記す。付けられる場合は必ず付ける（トレーサビリティ）。

event は type ごとに許可フィールドが異なる。

```json
[
  { "type": "filler", "start": 5.0, "end": 5.8 },
  { "type": "trouble", "start": 40.0, "end": 55.0, "note": "音声波形が途切れ、直後に話者が聞き返している。" },
  { "type": "chapter", "t": 60.0, "title": "セットアップ手順" },
  {
    "type": "highlight",
    "start": 312.0,
    "end": 318.5,
    "quote": "リリースは 8 月頭で行きます",
    "reason": "リリース時期を明言（決定事項）",
    "importance": 4
  },
  {
    "type": "hook",
    "start": 12.0,
    "end": 24.0,
    "score": {
      "hook": 4,
      "self_contained": 5,
      "emotion": 3,
      "density": 4,
      "punch": 3
    }
  }
]
```

tracks の形:

```json
{
  "speakers": [
    { "id": "A", "spans": [[1.2, 3.4]] }
  ],
  "faces": [
    { "speaker": "A", "t": 12.0, "box": [0.1, 0.2, 0.3, 0.5] }
  ],
  "person_matte": {
    "path": "matte/person-matte.webm",
    "fps": 24,
    "quality": "balanced",
    "generated_at": "2026-07-23T01:33:30.069Z",
    "tool": "vision-person-segmentation"
  }
}
```

`person_matte` は生成・照合済みのときだけ値を入れ、それ以外は `null` にする。生成は任意工程であり、既定は `null` である（[person-matte.md](person-matte.md)）。`path`（マット動画へのパス）と `fps`（マット動画の fps）が必須、`quality` / `generated_at` / `tool` は任意である。相対パスは `analysis.json` のディレクトリ基準とし、区切りは `/` を使う。データ契約は [docs/contract-2026-07-23-analysis-person-matte.md](../../docs/contract-2026-07-23-analysis-person-matte.md) が正本である。

単一パスの文字列（`"mattes/person-alpha.mov"`）は旧形であり、`{ "path": ... }` の糖衣として読み手が受けるが、新しく書かない。face の speaker は対応する `tracks.speakers[].id` に存在させる。

`tracks.face_landmarks` / `tracks.hand_pose`（顔ランドマーク・手ポーズのトラック）は person_matte と違い、キー自体が任意である（未生成のときは `null` を書かず、キーごと省略する）。この 2 キーは agent がここで手組みするものではなく、[vision-tracks.md](vision-tracks.md) の `vision-tracks.mjs` が確定済みの analysis.json に対して直接読み書きする。データ契約は [docs/contract-2026-08-11-analysis-vision-tracks-v0.md](../../docs/contract-2026-08-11-analysis-vision-tracks-v0.md) が正本である。

## Schema では表せない意味制約

確定前に次を別途検査する。

- すべての区間で `end > start` である。
- transcript、word、event、span、face の時刻が source duration 内である。
- `words` がある場合、その word 区間が親 transcript segment 内にある。
- transcript、keyframes、events、各 span が source 時刻順である。
- `speaker` がある transcript と face の speaker ID が tracks と整合する。
- face box が `[x, y, width, height]` で、`x + width <= 1`、`y + height <= 1` である。
- `source`、keyframe path、非 null の person_matte の `path` を JSON の位置から解決でき、実ファイルが存在する。
- person_matte を書いた場合、マット動画の時刻 0 が素材の時刻 0 と一致し、`fps` が実際のマット動画の fps と一致する。
- JSON number に `NaN`、`Infinity`、文字列化した数値を使っていない。

## 検証して確定する

最初は同じディレクトリの `analysis.json.tmp` に書く。JSON 構文を先に確認する。

```bash
python3 -m json.tool "$OUT_DIR/analysis.json.tmp" >/dev/null
```

Python の `jsonschema` がローカルにある場合は Draft 2020-12 として検証する。

```bash
python3 - ".claude/skills/analyze-footage/references/analysis.schema.json" "$OUT_DIR/analysis.json.tmp" <<'PY'
import json
import pathlib
import sys
from jsonschema import Draft202012Validator

schema_path, data_path = map(pathlib.Path, sys.argv[1:])
schema = json.loads(schema_path.read_text(encoding="utf-8"))
data = json.loads(data_path.read_text(encoding="utf-8"))
Draft202012Validator.check_schema(schema)
errors = sorted(
    Draft202012Validator(schema).iter_errors(data),
    key=lambda e: "/".join(map(str, e.absolute_path)),
)
for error in errors:
    where = "/".join(map(str, error.path)) or "<root>"
    print(f"{where}: {error.message}", file=sys.stderr)
raise SystemExit(1 if errors else 0)
PY
```

ローカルに別の Draft 2020-12 対応 validator があればそれを使ってよい。validator を得るために無断でネットワーク導入しない。validator が一つもない場合は構文・構造・意味制約を手作業で照合し、Schema 検証未実施を報告する。

Schema 検証、意味制約、参照ファイル存在確認を通した後だけ、一時ファイルを `analysis.json` へ原子的に置き換える。既存ファイルがある場合は、同じ source の再分析だと確認してから置き換える。

## よくある間違い

- `version` を文字列 `"0"` にする。
- whisper.cpp の raw JSON を transcript へ直接入れる。
- ハルシネーション疑いの segment を突合せず transcript に残して確定する。
- trouble 以外の event に `note` を足す。
- highlight の `quote` に要約・言い換えを書く（transcript の実発言に忠実にする）。
- hook score を小数、0、6 以上にする、または 5 軸の一部を省く。
- 未生成の人物マットを空文字にする。未生成は `null` である。
- 人物マットの `path` にヘルパーが返した絶対パスをそのまま書く。`analysis.json` のディレクトリ基準へ直す。
- box を pixel 座標で保存する。
- Schema が検出しない `end <= start` を残す。
- backend（使用した文字起こしエンジン）を transcript segment に追加する — analysis.schema.json は `additionalProperties: false` でこのフィールドを許可しない。完了報告に書く（[media-and-transcript.md#provenancebackendの記録](media-and-transcript.md#provenancebackend-の記録)）。
