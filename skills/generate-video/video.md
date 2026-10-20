

# Turn a placeholder clip into video

Identify the target by one edit.json v2 item ID. Generate one clip at a time by default. Start with a dry run to inspect the normalized inputs, the request body that would be sent to the provider, and the cost estimate.
```sh
akari generate video <projectDir> --item <itemId> --dry-run --json
```


## Fill the nine input slots

1. `prompt` / `negative_prompt`: Describe the content and motion. The adapter incorporates camera instructions into the prompt.
2. `first_frame`: An optional input; if omitted, use the target clip's still image.
3. `last_frame`: Supply it with `--last-frame`. Never send it to a model that does not support it; fail with a validation error.
4. `reference_images[]`: Supply with `--reference-image`, observing the capability catalog's limit on image count.
5. `reference_videos[]`: Motion references. v1 has no dedicated CLI flag; use `--inputs <json>` when needed.
6. `reference_audios[]`: Supply with `--reference-audio`, extracting only the needed `range_s`.
7. `source_video` + `mode`: The video to extend or edit and the operation mode. In v1 these are fields only; use `--inputs <json>` when needed.
8. `camera`: Supply with `--camera`. The adapter converts bracket, trajectory, or prose notation to the format required by the model.
9. `seed`: A displayed value for reproducibility, which does not guarantee deterministic output. In v1, pass it with `--inputs <json>`.

Output controls are `--duration`, `--resolution`, and `--audio-out`; use `--model` and `--prompt` to override defaults. Each reference includes a path and SHA-256 hash, and each file must be no larger than 20 MB.
Derive duration from the target item's cuts. If the model requires rounding, show the requested duration, the value and type that will actually be sent, the rounding direction, and the difference before execution.

## Cost approval

Estimate cost from the capability catalog's price and `as_of` date. When asking for approval, present the eight items specified by [approvals-and-generation.md](../edit-plan/approvals-and-generation.md):
```text
対象:
使う手:
理由:
代替案と得失:
見積費用（通貨・計算根拠・as_of）:
待ち時間:
外部送信:
実行後に残す provenance:
```
If a model has no price, show `見積不可` ("estimate unavailable") and explain why, then wait for explicit confirmation. For multiple items, show each item's cost and the total before requesting a single cost approval. Add `--yes` only after approval.
```sh
akari generate video <projectDir> --item <itemId> --model <modelId> --prompt <prompt> --last-frame <path> --reference-image <path> --reference-audio <path> --camera <value> --duration <seconds> --resolution <value> --audio-out --inputs <json> --yes --json
```


## Replace the placeholder

When generation completes, replace only the same item's `sources[].path` with the MP4. Keep the item ID, track, `at`, and total timeline duration unchanged.

- If the generated clip is at least as long as the cut, trim its end to the cut duration.
- If it is shorter than the cut, play its full duration and hold the last frame for the remainder with `freeze`.
- Keep `mute: true` by default even when the generated video contains audio. Narration and BGM remain the authoritative audio; a person may unmute the clip if needed.

Make the replacement a single undo step. Do not include status updates or history entries in that undo step.
