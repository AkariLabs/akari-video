**English** | [日本語](./export.ja.md)

# Export

Renders the final MP4 from an approved `edit.json`. The skill is `render-cut`.

## Prerequisites

- `edit.json` is finalized
- [edit-lint](./review-and-fix.md) has passed (render-cut checks `.akari/lint.json` for
  `verdict: pass`)

## How to ask

"export it" / "make the delivery MP4"

In the app you can also start from the export button ("Export") in the top bar. It opens
the export screen and shows progress while it runs. If it can't export, it tells you why.

## Flow — approve, then run

1. **validate** — confirm the inputs are valid
2. **plan** — present a plan for what and how to render (estimated duration, processing
   steps, the engine to be used)
3. **approve** — a human gives the OK (the second checkpoint)
4. **render** — renders locally with ffmpeg. Video is cut and encoded from the source
   footage; expression (titles, captions, motion parts, 3D) is composited from the same HTML
   as the preview
5. **verify** — checks the container with ffprobe, then compares declared content with measured output (audio level, camera-work motion, and blank frames)

## Export engine — `--engine`

| Value | Behavior |
|---|---|
| `auto` (default) | GPU when the content can be drawn on the GPU, OSR otherwise. Same rule on macOS, Windows, and Linux |
| `gpu` | Direct GPU path (fast). If something can't be drawn, it stops and says why |
| `osr` | Draws the whole page off-screen. Handles free-form HTML too |

**Whether the GPU can draw it** is decided mechanically before export, from the declarations
(HTML, captions, and edit declarations).

- Static HTML, and HTML that moves only through CSS animation / transition / `@keyframes` /
  Web Animations / `@property`
- Declarative 3D (including 3D animated with keyframes such as rotation) and WebGPU layers
- Caption motion (karaoke, pop, reveal, word-by-word reveal) and per-word emphasis

HTML that loads external URLs, HTML driven by scripts, or a caption that stacks karaoke color
interpolation on a geometric transform can't be drawn on the GPU. `auto` switches to OSR; with
an explicit `gpu` it stops and gives the reason. Which engine was requested and which one
actually ran are recorded in `.akari/render.json` as `engine_requested` and `engine`, and a
switch is recorded in `engine_fallback` with its reason.

Run edit-lint with `--engine auto` (or `gpu` / `osr`) before exporting to find fields the chosen
engine doesn't read. Contracts:
[GPU export](../contract-2026-08-28-gpu-export-v0.md) and
[OSR export](../contract-2026-08-28-osr-export-v0.md) (both in Japanese).

## Verification after export

Besides the container checks (duration, frame count, decoding every frame, resolution, fps,
codec), it measures the final MP4 to confirm that what you declared actually shows up.

| Check | What it does |
|---|---|
| `verify.audio-level` | FAIL if declared audio is silent in every sampled interval, or can't be measured |
| `verify.motion-static` | Warns if declared camera work barely moves in the output |
| `verify.blank-frames` | Finds stretches of 0.3 s or more of blank frames; warns when a declared part is active there (doesn't change the verdict) |

After that, a contact sheet of representative frames (`.akari/reports/contact-sheet.png`) is
generated and the agent inspects it by eye. A title card at the start keeps video, audio, and
captions in sync. If placeholder frames (slots with no footage yet) remain, the export includes
the same "replaced when you add footage" card. Contract:
[declared vs measured](../contract-2026-09-02-export-verify-declared-vs-measured-v0.md) (in Japanese).

## What it produces

| File | Contents |
|---|---|
| `exports/<name>.mp4` | Final output |
| `.akari/render.json` | Canonical export plan and execution result (command sequence, engine used, provenance) |
| `.akari/reports/render-report.html` | Human-readable report (includes verification results) |
| `.akari/reports/contact-sheet.png` | Contact sheet of representative frames |

The **Output** band in the app's left panel lists up to the 3 newest exports, with "Open" and
"Show in Finder" right there. Drag the band's top edge to change its height.

## To another editor — NLE export (BETA)

> **BETA** — implemented and tested, but the output has not yet been imported into actual
> Final Cut Pro, DaVinci Resolve, or Premiere Pro to verify it. If it fails to import or comes
> out misaligned, please tell us in an issue.

The `export-nle` skill writes `edit.json` (v2) one way, as an exit for people who want to finish
in a professional tool. Ask "open it in Premiere", "export for Resolve", or "give me an SRT".

| Format | Target | File |
|---|---|---|
| FCPXML 1.11 | Final Cut Pro / DaVinci Resolve | `<project>.fcpxml` |
| FCP7 XML (xmeml v5) | Premiere Pro | `<project>.premiere.xml` |
| SRT | Any NLE (only when captions exist) | `<project>.srt` |

- Output goes to `exports/nle/`. Media is written as references (absolute paths), so after you
  move the project, reconnect it with the NLE's relink
- What can't transfer (ducking, master audio processing, LUT, chroma key, caption styling, etc.)
  is listed in `dropped[]` of `exports/nle/export-report.json`. Nothing is dropped silently
- There is no way back from an NLE into `edit.json`

## Why the preview and the output match

The preview runs on proxies + a live DOM (immediate, touchable); export runs on the source
footage + per-frame compositing (frame-accurate). Both pass through **the same HTML and the
same save data**, so what you saw is exactly what comes out.

## If something goes wrong

- **Doesn't start because of a lint FAIL** → [QA, review, and fix](./review-and-fix.md).
  The report shows FAIL reasons with counts
- **verify FAIL** → check the stderr summary in the report. You can ask "investigate the
  render failure" for diagnosis
- **`verify.audio-level` FAIL** → declared audio was silent in every sampled interval, or its
  level could not be measured; check the declared BGM/SFX/narration/source audio and the report
- **Stops with `--engine gpu`** → the reason names the HTML or caption motion that can't be drawn. Fix it or switch to `--engine auto`
- **`OSR Electron` / `GPU Electron` with `SIGABRT`** → the export may have started without access to a logged-in GUI session. Export from a terminal in the logged-in desktop session or from the AKARI Video app.
- **`node` is not on PATH** → use the actual paths shown by `akari doctor` and run `ELECTRON_RUN_AS_NODE=1 "<Electron executable>" "<path to render-cut.mjs>" <project-root>` from a terminal in the logged-in desktop session. This setting runs the parent as Node; it does not fix a missing GUI session.

## Next steps

- Save a well-made deliverable for next time → [Grow your asset library](./asset-library.md)
