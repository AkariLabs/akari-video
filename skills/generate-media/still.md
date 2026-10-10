

# Build timeline placeholders with still images

A placeholder consists of a still-image media item on the edit.json v2 timeline and an adjacent `<path>.meta.json` file. The item's cuts determine its duration. A still can remain the final visual; conversion to video is optional.

## beats.json

Describe each structural beat with its order, label, still-image prompt, target duration, and output filename. Minimal example:
```json
{
  "version": 1,
  "beats": [
    {
      "item_id": "item-opening",
      "label": "オープニング",
      "prompt": "朝の窓辺に置かれたノート、柔らかな自然光、16:9、文字なし",
      "duration_s": 4,
      "output": "opening.png"
    },
    {
      "item_id": "item-demo",
      "label": "操作デモ",
      "prompt": "動画編集タイムラインを操作する手元、落ち着いた青系、16:9、文字なし",
      "duration_s": 8,
      "output": "demo.png"
    },
    {
      "item_id": "item-ending",
      "label": "エンディング",
      "prompt": "夕暮れのデスクと閉じたノート、余韻のある構図、16:9、文字なし",
      "duration_s": 3,
      "output": "ending.png"
    }
  ]
}
```
- `version`: Format version of beats.json.
- `beats`: Placeholder definitions in timeline order. Array order is recorded; start times are not.
- `item_id`: Matching edit.json v2 item ID, one per beat.
- `label`: A human-readable beat name.
- `prompt`: Visual content to generate when using an image rather than a text card.
- `duration_s`: Placeholder duration in seconds, matching the item's cut duration.
- `output`: Filename under `assets/generated/`.

Do not duplicate start times in beats.json and edit.json. Take position from the timeline and match duration to the cuts. Check `akari generate still --help` or `--dry-run --json` for the exact schema accepted by the CLI.

To inspect the request and planned changes without generating:
```sh
akari generate still <projectDir> --spec <beats.json> --dry-run --json
```
To generate still images:
```sh
akari generate still <projectDir> --spec <beats.json> --parallel N --json
```


## Text cards

Use `--placeholder` when the visual is undecided, no generation connection is available, or only timing and order need review.
```sh
akari generate still <projectDir> --spec <beats.json> --placeholder --json
```
The text-card PNG is created locally at no cost. Its adjacent metadata records `kind: "still"` and `status: "planned"`. It is not sent to a video model. Replace it later with an image or video if needed, or export the text card as the final visual.

## Check the metadata

Confirm that the output and `<file>.meta.json` both exist under `assets/generated/`, then check:

- `kind` is `still`; `planned` denotes a text card and `done` a generated still.
- `inputs` retains the prompt and reference images; `output` retains the requested output settings.
- Provenance traces `result.path`, SHA-256, dimensions, creation time, and the method used.
- The edit.json item ID, track, and duration are preserved without generation-only fields.

A placeholder is not a mark of unfinished work. If the still image achieves the intended result, keep it as the final asset.
