# Assemble and validate analysis.json

## Contents

- [Minimum valid form](#minimum-valid-form)
- [Semantic constraints](#semantic-constraints-beyond-the-schema)
- [Validation and finalization](#validate-and-finalize)

## Principles

Use [packages/schemas/analysis.schema.json](https://github.com/AkariLabs/akari-video/blob/main/packages/schemas/analysis.schema.json) as the sole structural definition. Unknown fields are prohibited at the top level and within objects. Do not add working notes, confidence scores, degraded-result reasons, or generator metadata as extra fields.

## Minimum valid form

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

All six top-level fields are required, including empty arrays. `keyframes: []` and `events: []` are valid both when L2 was not observed and when observation found no matching items. Use the type and range of the corresponding `observations[]` to distinguish those cases; an empty array alone does not mean "not applicable."

## Element shapes

```json
{
  "start": 1.2,
  "end": 3.4,
  "text": "発話本文"
}
```

`speaker` and `words` are optional; add them only when supported by evidence.

When `--diarize` is selected, `transcript[].speaker` receives the speaker ID whose interval overlaps the utterance most. Never put voice embeddings in `analysis.json`.

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

Exclude segments that fail the [transcript-quality criteria](media-and-transcript.md#check-transcript-quality). If every segment fails, finalize with `transcript: []`.

```json
{
  "t": 12.0,
  "path": "keyframes/kf-0001-t12.000.jpg",
  "note": "画面共有へ切り替わり、資料タイトルが中央に表示されている。",
  "origin": "scene"
}
```

`origin` is optional, but always include it when the selection route (`scene`, `interval`, or `transcript`) is known so the choice can be traced.

Allowed event fields differ by type.

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

Track shape:

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

Set `person_matte` only after generation and verification; otherwise use `null`. Matte generation is optional and `null` is the default; see [person-matte.md](person-matte.md). A generated matte requires `path` and `fps`; `quality`, `generated_at`, and `tool` are optional. Resolve its relative path from the directory containing `analysis.json`, using `/` as the separator. The [person-matte data contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-23-analysis-person-matte.md) is authoritative.

The legacy single-path string (`"mattes/person-alpha.mov"`) may be read as shorthand for `{ "path": ... }`, but must not be written in new data. Each face's speaker ID must exist in `tracks.speakers[].id`.
`tracks.speakers` also receives `{ id, spans }` from speaker intervals when `--diarize` is selected. Do not store embeddings here either.

Unlike person_matte, `tracks.face_landmarks` and `tracks.hand_pose` are optional keys: omit them entirely when not generated instead of writing `null`. The agent does not assemble these tracks here. `vision-tracks.mjs`, described in [vision-tracks.md](vision-tracks.md), reads and updates the finalized analysis.json directly. Follow the [vision-track data contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-11-analysis-vision-tracks-v0.md).

## Semantic constraints beyond the schema

Check these conditions separately before finalization:

- Every interval satisfies `end > start`.
- Transcript, word, event, span, and face times lie within the source duration.
- Every interval in `words` lies within its parent transcript segment.
- Transcript segments, keyframes, events, and spans are ordered by source time.
- Any transcript `speaker` and face speaker ID agrees with the corresponding track.
- A face box uses `[x, y, width, height]` with `x + width <= 1` and `y + height <= 1`.
- `source`, keyframe paths, and a non-null matte `path` resolve from the JSON location to existing files.
- For a recorded matte, its time zero matches the source's time zero, and its `fps` matches the actual matte video.
- JSON numbers are not `NaN`, `Infinity`, or numeric strings.

## Validate and finalize

Write `analysis.json.tmp` in the same directory first, then validate its JSON syntax.

```bash
python3 -m json.tool "$OUT_DIR/analysis.json.tmp" >/dev/null
```

If Python's `jsonschema` is installed locally, validate against Draft 2020-12.

```bash
python3 - "packages/schemas/analysis.schema.json" "$OUT_DIR/analysis.json.tmp" <<'PY'
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

Another locally available Draft 2020-12 validator is also acceptable. Do not install one from the network without authorization. If no validator exists, manually inspect syntax, structure, and semantic constraints, and report that schema validation was not run.

Atomically replace `analysis.json` with the temporary file only after schema validation, semantic checks, and reference-file checks pass. Before replacing an existing file, confirm it describes the same source.

## Common mistakes

- Writing `version` as the string `"0"`.
- Copying raw backend JSON into transcript instead of the normalized `segments[]` from `akari media transcribe`.
- Keeping a suspected hallucinated segment without checking it against evidence.
- Adding `note` to event types other than trouble.
- Summarizing or paraphrasing a highlight in `quote` instead of preserving the actual words.
- Using a decimal, zero, or six or higher for hook scores, or omitting one of the five axes.
- Using an empty string for an ungenerated person matte; use `null`.
- Copying the helper's absolute matte `path` instead of converting it relative to `analysis.json`.
- Saving face boxes in pixel coordinates.
- Leaving `end <= start` intervals that schema validation cannot catch.
- Adding the transcription backend to a segment: analysis.schema.json uses `additionalProperties: false` and disallows that field. Report it in the completion report; see [transcription result handling](media-and-transcript.md#handle-the-result).
