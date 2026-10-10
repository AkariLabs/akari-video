

# Shooting list and recording checklist

Read this file only at step 6 of [SKILL.md](SKILL.md), after the `structure-confirm` card has a non-null `completedAt` (or explicit chat approval) and `structure.confirmed` is set. Produce `shot_list[]` by turning approved storyboard cards in `structure.shots[]` into practical shooting instructions. Do not make new creative choices here.

## 1. Write a practical entry for each shot

Write an entry in `shot_list[]` for every shot in `structure.shots[]`. Normally one shot gets one entry; add entries when a shot must be divided into several recorded takes.

- `id`: A short identifier for this entry.
- `ref_shot_id`: The matching `structure.shots[].id`, or `null` for an additional shot not in the plan.
- `location`: Shooting location, or `null` if undecided.
- `equipment`: Array of needed equipment, such as a tripod, lights, and microphone.
- `checklist`: Array of checks to perform while recording; adapt the starting points below.
- `status`: `planned` by default, `ok` when shot satisfactorily, or `ng` when a retake is needed.

## 2. Start the checklist

Adapt the checklist to the subject, but retain these checks:

- Audio levels, including ambient sound and speech volume.
- Framing and horizon against the intended composition.
- Exposure and white balance.
- Retake plan if a take fails: use the same position or substitute another shot.

Automated metadata collection with ExifTool, ffprobe, or similar tools is outside this skill. A future shooting-support skill may share IDs with those tools. Here, keep `ref_shot_id` as a stable link to the storyboard.

## 3. Update `status` after shooting

In v0, initialize every `status` to `planned`. A person, or a future shooting-support skill, can set `ok` or `ng` after the actual shoot. Do not invent shooting results during planning.

## 4. Final validation

After filling `topic`, `target`, `structure`, `shot_list`, `sources`, and `feedback` in `research-plan.json`, run the validator:
```sh
node packages/schemas/bin/validate-research-plan.mjs <research-plan.json のパス>
```
Do not mark the work complete until the exit code is `0`. Warnings are allowed, but list them in the completion report.

## Common mistakes

- Starting the shooting list before `structure.confirmed` is finalized.
- Guessing a shooting outcome in `status` before any footage exists.
- Omitting `ref_shot_id`, so entries cannot be traced to storyboard shots.
- Reporting completion without running `validate-research-plan.mjs`.
