

# L2 keyframe candidates and visual review

## Principles

Read this file only when L2 is explicitly requested. Use `akari media filmstrip|grab` to generate candidates, then inspect the actual images before recording findings. The [`akari media` contract §1.1 / §2.2 / §2.3](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-29-media-inspect-cli-v0.md) governs commands and image limits.

## 1. Scan the source coarsely

Begin with one contact sheet containing the default 12 frames.
```bash
akari media filmstrip "$SOURCE" --count 12
```
If that establishes the overall visual content, stop extracting frames. Use `--every <sec>` only when a long source needs denser review, and keep the candidate count small enough to inspect.

| Source duration | Initial interval guideline |
|---|---|
| Up to 10 minutes | 10 seconds |
| 10–30 minutes | 30–60 seconds |
| Over 30 minutes | 120 seconds |
```bash
akari media filmstrip "$SOURCE" --every 120
```
These are starting values, not fixed thresholds. Report any changed interval and why it changed.

## 2. Add scene candidates only for relevant screen changes

Use scene detection when the request requires cut points, brief error screens, screen-share switches, or similar changes.
```bash
akari media filmstrip "$SOURCE" --scenes
```
Set an explicit scene threshold only if there are too many candidates. For exit 1, report the stderr reason; do not reinterpret internal logs or media-backend exit codes here. Use the stdout and exit-code contract to distinguish zero candidates from command failure.

Scene and interval sampling are not always both needed. Run only the method that can answer the request.

## 3. Sample selected transcript windows

For a confirmed highlight or hook whose visual context matters, use `grab` at representative source times. Do not turn every transcript segment into images.
```bash
akari media grab "$SOURCE" -t 312 315.25 318.5
```
Start at the center of the spoken interval. If that lands on a screen transition, shift and capture again within the same event interval; do not sample outside it.

## 4. Merge candidates and extract selected images

Use `times_s` from each command's stdout as the source of timing; filenames and sequence numbers are not timestamps. Merge scene, interval, and transcript candidates by source time. Compare same-time or visually redundant neighbors and retain the image with more useful information.

After selecting times, extract individual 720p-high PNGs to a stable destination.
```bash
akari media grab "$SOURCE" -t 12 315.25 --separate --out "$OUT_DIR/keyframes"
```
Record the mapping from output filename to stdout `times_s`; use `keyframes[].t` as the authoritative time. Record selection provenance as `origin: "scene" | "interval" | "transcript"`. Neither `grab` nor `filmstrip` writes a `note`; the generated image is recorded only in `observations[]`.

## 5. Inspect every selected image

Once the final file list is known, open every image with Read or the harness's image viewer. Never write `note` for an unseen image. Immediately verify its stdout time and path, then briefly record:

- Main subject, such as a person, screen, or document.
- Visible UI, slide, title, or error state.
- Visual change from the previous candidate.
- Composition, face visibility, and text legibility relevant to later editing.

Do not infer speech or intent from an image alone. Enlarge small UI text before describing it. Recheck near-duplicate groups against both images and notes. After all notes are written, compare each `note[i]` with its `path[i]` once more.

If an image cannot be opened, do not invent a note. Retry at another time or in another output format. If inspection still fails, leave `keyframes: []` and report the degraded result. The same empty form is valid when L2 was not requested; use `observations[]` to distinguish that case from an unsuccessful inspection.

## 6. Record person information

Record face boxes only at times confirmed by visual review or local detection. Normalize `[x, y, width, height]` to 0–1. If a face cannot be matched to a speaker, leave `tracks.faces: []`; appearance alone does not establish speaker identity.
Do not generate person mattes or detailed tracks automatically in L2. Read the relevant L3 leaf only when L3 is explicitly requested.

## Common mistakes

- Running full-length scene or interval sampling without an L2 request.
- Treating sequence numbers or filenames as source seconds.
- Writing image notes from the transcript without opening the contact sheet.
- Capturing every transcript segment indiscriminately.
- Keeping many duplicate images as keyframes.
- Assuming `grab` writes keyframe notes automatically.
