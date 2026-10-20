
# Generate still images

Use an AI image model when the picture itself matters. If only timing and order need review, skip generation and make a local text card with [generate-video's still.md](../generate-video/still.md) instead — it costs nothing and can become the final visual. Decide "shelf or generate" in planning; do not start by searching the asset shelf.

## 1. Write the image spec

The CLI reads the same `beats.json` shape as placeholders: each beat has a kebab-case `id`, a `prompt`, and a `duration_s`; `name` and a `video` draft are optional, and `style_suffix` appends a shared look to every prompt. The full field list is in [generate-video's still.md](../generate-video/still.md#beatsjson).

Write prompts as visual descriptions (subject, composition, light, aspect ratio, and "no text" when text will be added later). Do not put generation-only fields in edit.json.

## 2. Inspect before spending

```sh
akari generate still <projectDir> --spec <beats.json> --dry-run --json
```
Check the planned ids, order, frame positions, output paths, and the route the CLI will use. Confirm that route against the ledger row: capabilities, price, and `as_of` come from [generate-video's engines.md](../generate-video/engines.md), never from memory. The still route may be free; if the selected row is paid, present the cost in the [edit-plan approvals and generation](../edit-plan/approvals-and-generation.md) format and wait for explicit approval.

## 3. Generate

```sh
akari generate still <projectDir> --spec <beats.json> --parallel N --json
```
`--parallel` only changes throughput, not the result set. The CLI writes `assets/generated/<id>.png` and `<file>.meta.json`, then inserts each successful still into the first visual track as `gen-<id>` with the beat duration. Do not add a duplicate item. If an id already has a generated item, the CLI skips it rather than overwriting.

## 4. Confirm the metadata

- `kind` is `still` and `status` is `done` on success, or `failed` with a reason.
- `inputs` retains the submitted prompt and any reference images; `output` retains the requested settings.
- Provenance traces `result.path`, SHA-256, dimensions, creation time, and the method used.
- The model id and price agree with the ledger row for the generation time.
- The edit.json item id, track, and duration are intact, with no generation-only fields.

On failure, keep the existing image or placeholder in place, read the recorded reason, and retry only after fixing it. Do not silently start a second run under a different id.

## 5. Place it

A generated still is already on the timeline. Keep it as the final visual, or treat it as the opening frame of a later video: continue with [generate-video's video.md](../generate-video/video.md) and keep the same item id and duration. Replacing the still with video is a single undo step.
