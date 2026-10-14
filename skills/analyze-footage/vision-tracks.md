# Generate face, hand, and 3D body-pose tracks (optional)

## Contents

- [Decide whether to execute first](#decide-whether-to-execute-first)
- [Check tools](#check-tools)
- [Generate](#generate)
- [Update analysis.json](#update-analysisjson)
- [body-pose-3d (3D body pose)](#body-pose-3d-3d-body-pose)
- [face-expression (head posture + facial expression 52)](#face-expression-head-posture-facial-expression-52)
- [Use tracks for an eye bar](#use-tracks-for-an-eye-bar)
- [Use tracks for pose-skeleton](#use-tracks-for-pose-skeleton)
- [Degraded operation](#degraded-operation)
- [Use tracks for finger-frame](#use-tracks-for-finger-frame)

## Principles

Generate vision tracks **only for selected footage and intervals** that will use positions of eyes, fingertips, or body joints—for example, eye-bar, finger-frame, or pose-skeleton effects. By default, omit the `tracks.face_landmarks`, `tracks.hand_pose`, and `tracks.body_pose_3d` keys entirely. An ungenerated vision track has no key; this differs from person_matte, whose required key has a null value. Follow the [vision-track data contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-11-analysis-vision-tracks-v0.md).
**Keep analysis pull-driven** as required by contract §0 principle 1. If only facial data is needed, request `--kinds face` and do not generate hand or 3D body-pose tracks. The `node bin/...` commands below are the public L3 sidecar-generator interface; each generator handles its own decoding and validation rather than exposing the media backend directly to this skill.

## Decide whether to execute first

Do not run this on every source. For a 26.3-second 1280×720 clip at 24 fps on a loaded machine with `--kinds face,hand`, measurements were:

| Process | Actual measurement | Notes |
|---|---|---|
| Vision face + hand detection in one pass | 13.5 ms/frame | One `perform()` detects both when requested together. |
| Total, including bundled decoder | **About 0.45× real time** (26.3 seconds → 11.9 seconds) | Much less than person-matte's roughly 7.7× because no video is encoded. |

Unlike a person matte, a vision track is JSON rather than video and needs no VP9 alpha encoding. The measured face-and-hand pass finished faster than real time, but that is not a reason to run it on unrelated footage.

**Body-pose-3d is much slower:** measured at 15.3× real time, or about three minutes for 12 seconds of footage, compared with about 0.45× for face and hand. Generate it only for intervals chosen for a body-pose effect such as pose-skeleton. For long sources, consider lowering `--fps` to sample less often.

- Run only when an effect using eye, fingertip, or joint positions—such as eye-bar, finger-frame, or pose-skeleton—has been chosen.
- Limit the request to `--kinds face`, `--kinds hand`, or `--kinds body-pose-3d` when only one kind is needed. Do not generate other kinds preemptively.

## Check tools

```bash
node bin/vision-tracks/vision-tracks.mjs --check
```

Unless the result is `{"available":true}`, report `reason` and continue without generating the track or its key. Generation needs macOS, `swiftc`, and the bundled decoder and prober. Unlike person-matte, it does not need `libvpx-vp9` because it exports no video. Do not install tools from the network. `--check` tests only the requested `--kinds`; on macOS older than 14, `body-pose-3d` alone is unavailable while `face` and `hand` remain available. The Swift helper builds itself with `swiftc -O` on first use; do not commit the binary (see [.gitignore](.gitignore)).

## Generate

Pass an existing, finalized analysis.json to `--analysis`. Unlike person-matte, this tool **reads and updates analysis.json itself**; there is no step where the agent pastes track pointers into `tracks` by hand.

```bash
node bin/vision-tracks/vision-tracks.mjs \
  --input "$SOURCE" \
  --analysis "$OUT_DIR/analysis.json"
```

Optional overrides (omit them to use defaults):

- `--kinds face,hand` defaults to `face,hand`. Combine `face`, `hand`, and `body-pose-3d` with commas, or request just one, such as `--kinds body-pose-3d`. The generator decodes and runs Vision detection once, then writes only the requested track files.
- `--fps <n>` defaults to 24 samples per second and need not match the source frame rate.
- `--decode-width <n>` defaults to 1280. As with person-matte, use the source width rather than upscaling when it is narrower than 1280.
- `--joint-confidence <0..1>` defaults to 0.3. Omit hand joints below that confidence under contract §2.2's "no invented joints" rule. Face landmarks have no equivalent per-region threshold; omit a whole face detection if any of the six required regions is unavailable.
- `--metrics <path>` writes measured frames, elapsed_seconds, realtime_ratio, detection_counts, and related values as JSON.

Pass the **original footage** to `--input`. A proxy can work, but never use one whose times no longer correspond to the source.

On success, stdout contains one JSON line with `ok`, `tracks` pointers written to analysis.json (`face_landmarks`, `hand_pose`, or `body_pose_3d`), `frames`, per-kind `detection_counts`, `elapsed_seconds`, and `realtime_ratio`. The tool has **already rewritten analysis.json** via an atomic `.tmp` replacement.

For `ok: false`, report `reason`, omit the track key, and continue analysis. **Failure to generate a track does not fail the whole analysis.**

### Frames with incomplete face or hand detections

- **Hands:** Omit the key for each joint below `--joint-confidence`. If none passes, keep the hand detection with `joints: {}`. It records that a hand was detected but no joint was reliable; do not erase the detection.
- **Faces:** If Vision cannot calculate even one of the required landmark regions, including pupils, eyes, or lips, omit that face detection entirely from that time's `detections`. v0 never writes a partial six-region face. In a measured 26.3-second clip with one mostly visible face, no detections were excluded (see report.md); backlighting or a sustained profile view may produce exclusions.

### Coordinates

Face and hand coordinates and body-pose-3d `projection` use **0–1 normalization with a top-left origin**, per contract §2. Vision itself uses a bottom-left origin, but the helper already flips y. Body-pose-3d `position` uses model coordinates in meters relative to the root or hip. **The agent must not flip or transform these coordinates again.**

## Update analysis.json

Unlike person-matte, the agent does not paste a returned value into `tracks`. `vision-tracks.mjs` reads analysis.json, makes these changes, and atomically replaces the file:

1. Write only the requested kinds among `<analysis-dir>/vision/face-landmarks.json`, `<analysis-dir>/vision/hand-pose.json`, and `<analysis-dir>/vision/body-pose-3d.json`.
2. Add pointers in `analysis.json` under `tracks.face_landmarks`, `tracks.hand_pose`, or `tracks.body_pose_3d`. Each pointer includes `path` relative to the analysis.json directory, plus `sample_fps`, `provider`, `tool`, and `generated_at`.

```json
"face_landmarks": {
  "path": "vision/face-landmarks.json",
  "sample_fps": 24,
  "provider": "apple-vision",
  "tool": "vision-tracks.mjs v0",
  "generated_at": "2026-08-11T12:00:00Z"
}
```

**Rerunning with `--kinds face` leaves an existing `hand_pose` pointer unchanged.** This pull-driven operation updates only requested kinds, unlike replacing a single person-matte artifact. Because the tool operates on finalized analysis.json, pass the schema and semantic checks in [analysis-json.md](analysis-json.md) **before** running it.

## body-pose-3d (3D body pose)

To generate only body-pose-3d, run this against finalized analysis.json:

```bash
node bin/vision-tracks/vision-tracks.mjs --input <video> --analysis <analysis.json> --kinds body-pose-3d
```

On macOS 14 or later, `VNDetectHumanBodyPose3DRequest` revision 1 returns 17 joints. Save each joint's `position` in root/hip-relative meters and its 2D `projection`. If even one joint is unavailable, omit the entire detection: this is an all-or-nothing track, with no partial output or invented interpolation (contract §2.4). In v0, each joint's `conf` repeats the observation-wide `VNHumanBodyPose3DObservation.confidence`; it is not joint-specific.

## face-expression (head posture + facial expression 52)

Only for footage chosen to drive an avatar using the speaker's head motion and expressions, generate the separate `face-expression` kind alongside the three existing Vision kinds. It uses **MediaPipe Face Landmarker** through vendored Apache-2.0 `@mediapipe/tasks-vision@0.10.17` JS/WASM in the existing headless Chromium path; it adds no Python or Swift sidecar. It does not replace the existing vowel-based lip-sync track. Wiring the consumer effect is a separate stage.

### Check tools and models

```bash
node bin/face-expression/face-expression.mjs --check
```

This optional feature requires Chrome and the workspace's existing `puppeteer-core` dependency. If Chrome is missing, stop and report the CLI message ``この機能には Chrome が必要です（`AKARI_CHROME_BIN` で指定）`` ("this feature requires Chrome; specify it with `AKARI_CHROME_BIN`"). Check SHA-256 hashes for the bundled decoder, prober, and vendored runtime. A missing model does not make the runtime unavailable: fetch it from the official versioned URL only on first generation.

- Save to: `${AKARI_HOME:-~/.akari}/models/mediapipe/face-landmarker/float16-1/face_landmarker.task`
- URL: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`
- SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`

Download to `.tmp-<pid>` and rename only after the SHA-256 matches. If an existing model has the wrong hash, fail immediately rather than silently downloading another copy. Do not commit models, real footage, or demo outputs.

### Generate

```bash
node bin/face-expression/face-expression.mjs \
  --input "$SOURCE" \
  --analysis "$OUT_DIR/analysis.json" \
  --fps 24 \
  --metrics "$OUT_DIR/face-expression-metrics.json"
```

- `--fps <n>` defaults to 24. The generator decodes at regular intervals; each sample's `t` is `index / fps`.
- `--decode-width <n>` defaults to 1280; smaller inputs are not upscaled.
- Write only `<analysis-dir>/vision/face-expression.json`. Each sample has `t` and `detections[]`. A detection contains `head.{yaw,pitch,roll}` in radians, 52 fixed MediaPipe `blendshapes` raw scores from 0 to 1, and `conf`. Do not smooth or interpolate.
- On success, add `tracks.face_expression` without replacing other pointers. Replace both the track file and analysis.json atomically through temporary-file rename.

### Measure performance

The fieldtest owner measures a twelve-second window of real footage. Never write unmeasured performance values by guesswork. Use CPU time as the primary measure and wall time and real-time ratio as secondary measures. On macOS, record `user + sys` as CPU seconds, and inspect `detected_frames / frames`, representative `mouthSmileLeft/Right` values, and the yaw sign in the metrics.

```bash
/usr/bin/time -p node bin/face-expression/face-expression.mjs \
  --input "$TWELVE_SECOND_COPY" \
  --analysis "$OUT_DIR/analysis.json" \
  --fps 24 \
  --metrics "$OUT_DIR/face-expression-metrics.json"
```

Record the Chrome version, CPU seconds, wall seconds, `elapsed_seconds / 12`, detection rate, and rate of valid 52-key results. MediaPipe's Web API does not expose a face-presence score in this result, so v0 `conf` is the maximum raw score among the 52 blendshapes. Do not interpret it as face-detection confidence.

## Use tracks for an eye bar

Do not read all of `edit.json` or `captions.json`; grep by ID and read only the matching lines, following [the edit.json access guide](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md). Write with the Edit operation or edit-store script API for those lines.

Generating `face_landmarks` alone does not add a visual effect. The separate deterministic converter `packages/akari-tools/bin/eye-bar.mjs`, also available as `akari internal eye-bar`, draws a criminal-style black eye bar. It is outside this skill; see the [vision-track contract §4](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-11-analysis-vision-tracks-v0.md). Divide responsibilities as follows:

- **This skill (vision-tracks.mjs):** Detect eye positions in footage and record them as factual track data.
- **eye-bar.mjs**: Calculate the black bar's position, angle, and size from the track, then add `layers[].keyframes` to `edit.json`. This consumes analysis data to create a visual effect.

For an eye-bar effect, generate only `--kinds face`; `hand` is unnecessary. Then apply the converter to an approved `edit.json` with finalized cuts. Eye-bar maps source to timeline seconds using each cut's in, out, at, and speed; editing cuts afterward misaligns the bar.

```bash
node packages/akari-tools/bin/eye-bar.mjs \
  --analysis "$OUT_DIR/analysis.json" --edit "$OUT_DIR/edit.json" --apply
```

- Defaults usually suffice: bar length is interpupillary distance × 1.6, thickness ratio 0.22, smoothing uses a five-sample moving average, and samples are decimated every 0.2 seconds. For all parameters, see the header documentation corresponding to `eye-bar.mjs --help`.
- Without `--apply`, stdout shows the proposed JSON and `edit.json` remains unchanged.
- Use `--face <index>` to choose a target when multiple people appear. v0 follows one person only; simultaneous multi-person tracking is unsupported.
- The alpha-MOV bar asset is generated under `.akari/cache/eye-bar/`, a recreatable project cache. It can be rebuilt after deletion.
- If the target disappears during a cutaway, the converter adds several `layers[]` entries, one per visible interval. This intentionally prevents the bar from floating above unrelated footage.
- Measurements show that blinking can make Vision swap left and right eyes for a few frames even when confidence remains 1.0, producing an impossible angle jump. Eye-bar rejects jumps over 45° from the last accepted value and fills the gap with a hold. Usually no manual correction is needed; `--outlier-max-angle-jump` can change or disable the threshold.

## Use tracks for pose-skeleton

Generating `body_pose_3d` alone does not add a visual effect. `packages/akari-tools/bin/pose-skeleton.mjs` deterministically bakes an alpha stick-figure overlay from the 17 joints' 2D `projection` and outputs `kind: "baked"` entries in `layers[]`.

```bash
node packages/akari-tools/bin/pose-skeleton.mjs \
  --analysis "$OUT_DIR/analysis.json" --edit "$OUT_DIR/edit.json" \
  --stroke-width 4 --color "#00e5ff" --joint-radius 6 \
  --smoothing 5 --min-confidence 0.3 --apply
```

- `--stroke-width` controls bone-line thickness; `--color` colors lines and joints; `--joint-radius` sets joint-circle radius. `--smoothing` is the moving-average window (default 5; `1` disables smoothing). `--min-confidence` sets the minimum confidence for displaying a bone (default 0.3).
- Without `--apply`, return proposed `layers[]` and baked-asset information as stdout JSON without changing `edit.json`. With it, append to existing `layers[]`.
- v0 uses `bodyIndex=0` in every frame, consuming only the first person; it does not support multiple people.

## Degraded operation

If tools are unavailable or generation fails, omit the `tracks.face_landmarks`, `tracks.hand_pose`, or `tracks.body_pose_3d` key for the failed kind, finalize the rest of the analysis, and report why. Unlike person_matte, whose required key takes a null value, these keys are optional; presence indicates generation.

## Use tracks for finger-frame

This CLI deterministically maps `tracks.hand_pose` (the `thumb_tip` and `index_tip` on both hands, four points total) to a perspective four-corner pin in `layers[].keyframes`. It is the second consumer in §4 of the [vision-track contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-11-analysis-vision-tracks-v0.md). That contract allocates conversion responsibilities; it does not add a new three-surface implementation under §0 principle 3.

```bash
akari internal vision-finger-frame <project> \
  --media <貼る映像のパス> [--kind video|baked] \
  [--analysis <path>] [--edit <path>] \
  [--open-threshold <0..1>] [--close-threshold <0..1>] [--min-open-duration <sec>] \
  [--apply]
```

- **Activation:** Correct thumb-to-index distances for the source video's actual pixel aspect. A window opens when both hands exceed `--open-threshold` (default 0.16). It closes when either distance falls below `--close-threshold` (default 0.11) or one hand disappears. Fixed hysteresis prevents rapid toggling; see `bin/finger-frame/gesture.mjs`.
- **Geometry:** Normalize the four points to `[TL,TR,BL,BR]` for #layerPerspective regardless of which finger initially occupies a corner. Sort points by angle around their centroid to resolve twisted or self-intersecting quads; the derivation is in `bin/finger-frame/corners.mjs`. Within a window, choose the rotation nearest the prior frame's corner assignment to prevent visual jumps.
- **Time mapping:** Hand poses use source seconds; layers use timeline seconds. Convert using `cuts[]` `in`, `out`, `at`, and `speed`, reusing render-cut's `cut-timeline.mjs` read-only. If a cut declares `framing` or `transform`, the default letterbox assumption no longer holds: skip that interval and record a warning rather than output wrong coordinates.
- **v0 boundary:** Analysis remains optional and pull-driven; this consumer adds no blanket analysis rule. For detailed finger-frame design decisions and measurements, see the private internal records.

## Common mistakes

- Running vision detection on unspecified footage before an eye, fingertip, or joint-based effect is chosen.
- Requesting `--kinds face,hand,body-pose-3d` every time and paying for unneeded heavy tracks.
- Flipping coordinates again because Vision uses a bottom-left origin; the helper has already flipped them.
- Treating a `joints: {}` hand detection as a failed hand detection. The hand was seen; only reliable joints were absent.
- Running vision-tracks.mjs before validating `analysis.json` and adding tracks to an invalid ledger.
- Withholding `analysis.json` because one optional track could not be generated.
