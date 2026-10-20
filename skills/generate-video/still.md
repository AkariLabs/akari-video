
# Build timeline placeholders with still images and text cards

A placeholder gives a timeline item a duration and position before the final picture exists. It is a media item on the edit.json v2 timeline plus an adjacent `<path>.meta.json` file; the item's cuts determine its duration. A placeholder is also a finished output: if the still works, keep it as the final visual.

Placeholders are not a generation step. Choose a picture or a local text card; when the picture itself should be made by an AI image model, read the thin [generate-image](../generate-image/SKILL.md) skill first and return here to give the result a duration.

## beats.json

Describe each placeholder with its order, an optional display name, the visual prompt, target duration, and the optional draft of the later video request. Minimal example:
```json
{
  "style_suffix": "柔らかな自然光、16:9、文字なし",
  "beats": [
    {
      "id": "opening",
      "name": "オープニング",
      "prompt": "朝の窓辺に置かれたノート",
      "duration_s": 4,
      "video": { "prompt": "窓辺の光がゆっくり動く", "last": "demo" }
    },
    {
      "id": "demo",
      "name": "操作デモ",
      "prompt": "動画編集タイムラインを操作する手元、落ち着いた青系",
      "duration_s": 8
    }
  ]
}
```
- `style_suffix`: Optional text appended to every prompt. Use it for the shared look instead of repeating it.
- `beats`: Placeholder definitions in timeline order. Array order is recorded; start times are not.
- `id`: Kebab-case identifier, unique per spec. The generated file is `assets/generated/<id>.png` and the timeline source/item is `gen-<id>`.
- `name`: Optional human-readable beat name.
- `prompt`: Visual content. For a text card, it becomes the card text.
- `duration_s`: Placeholder duration in seconds; the CLI converts it to frames with the project fps.
- `video`: Optional draft for the later video request (`prompt` and `last`; `last` is a beat id or `next`). It only records the plan.

Do not duplicate start times in beats.json and edit.json. Start times come from the end of the first visual track, in spec order. Check `akari generate still --help` or `--dry-run --json` for the exact schema accepted by the CLI.

To inspect the request and planned changes without generating:
```sh
akari generate still <projectDir> --spec <beats.json> --dry-run --json
```

## Text cards

Use `--placeholder` when the visual is undecided, no generation connection is available, or only timing and order need review.
```sh
akari generate still <projectDir> --spec <beats.json> --placeholder --json
```
The text-card PNG is created locally at no cost. Its adjacent metadata records `kind: "still"` and `status: "planned"`. It is not sent to a model. Replace it later with an image or video if needed, or export the text card as the final visual.

## Existing still images

When the still already exists (a generated PNG, a photograph, or a supplied asset), add it to the first visual track as a media item with a cut duration. The CLI inserts generated stills itself as `gen-<id>`; do not add a second item for the same source. Keep the adjacent `<file>.meta.json` when the file has one, and never add generation-only fields to edit.json.

## Check the metadata

Confirm that the output and `<file>.meta.json` both exist under `assets/generated/`, then check:

- `kind` is `still`; `planned` denotes a text card and `done` a generated still.
- `inputs` retains the prompt and reference images; `output` retains the requested output settings.
- Provenance traces `result.path`, SHA-256, dimensions, creation time, and the method used.
- The edit.json item ID, track, and duration are preserved without generation-only fields.
