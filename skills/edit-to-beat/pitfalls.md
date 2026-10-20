# Pitfalls found in production

Source: beat-driven promo production on August 3–4, 2026 (six versions and three owner-review rounds). These are cases where something expected to move or appear did not, and the cause was easy to misjudge.

## Overlays

| Symptom | Cause | Remedy |
|---|---|---|
| The image is missing; only its frame or path text appears | Render sheets live under `<project>/.akari/render-tmp/`, so relative paths in a fragment resolve from there. | Embed the image as a **JPEG(q3) data URI**. 3D models and textures are an exception because the runtime embeds them as base64. |
| An element is invisible throughout its window | A second comma-separated fade(forwards) animation makes an element with an entrance animation disappear. | Put entrance, hold, and exit into **one animation: 0% → visible → held → 100% exit**. |
| A fixed label overlaps the main text | In a centered wrapper, `bottom: 60px` is measured from the wrapper's bottom, so the label occupies the central band of the screen rather than the screen bottom. | Position the label immediately below the stage so it has its own band. |
| Variable-length text runs underneath a button | The button is absolutely positioned at the input's right edge. | Reserve the button's width on the parent with `padding-right`. |
| Settings disappear when the same image is used in two windows | Generated filenames collide, and the later file wins. | Add sequence numbers in the generator. |
| Rendering is extremely slow | Full-screen `filter: blur()` dominates CPU rasterization time. | Use a radial gradient instead of blur. |

## 3D

See [author-scene3d/live.md](../author-scene3d/live.md) for details. In brief:

- **A window longer than its clip loops and breaks** because the default is LoopRepeat. Recreate the clip at the window's duration.
- **The default pose may not be neutral.** In one case, 0° meant "flat at 180°" rather than "closed." Inspect three points in the production render before interpreting an angle.
- **Blender's `frame_set()` cannot be used to freeze a pose because the animation is not evaluated.** Edit the glb directly.
- **A material without UVs or emissive settings will not show its texture.** Bake UVs and emissive settings in Blender. Trying the four orientations is faster than guessing.

## Audio

| Symptom | Cause | Remedy |
|---|---|---|
| Lint reports `audio.sfx.track-overlap` | Two effects occur on the same track at the same time. | Layering different sounds is informational: the mix plays both regardless of track. If intentional, put them on separate tracks for NLE export. Duplicate placement of the same sound is a warning; remove one copy. |
| Sound effects are inaudible | The effects are too far apart, such as typing sounds two beats apart. | Match the action's real pace; for typing, try 0.16-second steps with slight jitter. |
| Peak exceeds 0 dB | Multiple impact sounds are layered at 0 dB. | Start heavy effects around −2 dB. |

## Rendering

| Symptom | Cause | Remedy |
|---|---|---|
| `execution error: capturing frame N timeout` | On a busy machine, a frame exceeds the default 60-second timeout. | Set `RENDER_CUT_CAPTURE_TIMEOUT_MS=300000` and wait for the machine to be free. |
| 3D export times out | The GPU or off-screen renderer is congested. | Inspect the execution record in the report HTML. |
| Export is slow | Another ffmpeg session competes for CPU time. | Avoid concurrent exports; waiting is faster. |

## Verification

- **Preview and Blender appearance do not match the runtime. Always confirm pose, texture, and color with the production renderer.**
- **One still frame cannot prove motion.** It may conceal a static or reversed animation.
- If captures at several times all show the same image, check whether the animation was applied.

## Data-contract pitfalls

- `intake.json` v1 has strict vocabulary: `autonomy` is `full-auto`, `checkpoint`, or `collaborative`; `tasks` accepts known IDs only; and `target.duration_s` is mutually exclusive with `keep_length: true`.
- For a multi-source edit, `captions.json` requires `src`. Without it, every caption is skipped and you silently get zero subtitles.
