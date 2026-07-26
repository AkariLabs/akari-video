**English** | [日本語](./export.ja.md)

# Export

Renders the final MP4 from an approved `edit.json`. The skill is `render-cut`.

## Prerequisites

- `edit.json` is finalized
- [edit-lint](./review-and-fix.md) has passed (render-cut checks `.akari/lint.json` for
  `verdict: pass`)

## How to ask

"export it" / "make the delivery MP4"

## Flow — approve, then run

1. **validate** — confirm the inputs are valid
2. **plan** — present a plan for what and how to render (estimated duration, processing
   steps)
3. **approve** — a human gives the OK (the second checkpoint)
4. **render** — renders locally with ffmpeg. Video is cut and encoded from the source
   footage; expression (titles, captions) is composited from the same HTML as the preview
   via per-frame capture
5. **verify** — verifies the output with ffprobe, and the agent looks at keyframes

## What it produces

| File | Contents |
|---|---|
| `exports/<name>.mp4` | Final output |
| `.akari/render.json` | Canonical export plan and execution result (command sequence, provenance) |
| `.akari/reports/render-report.html` | Human-readable report (includes verification results) |

## Why the preview and the output match

The preview runs on proxies + a live DOM (immediate, touchable); export runs on the source
footage + per-frame capture (frame-accurate). Both pass through **the same HTML and the
same save data**, so what you saw is exactly what comes out.

## If something goes wrong

- **Doesn't start because of a lint FAIL** → [QA, review, and fix](./review-and-fix.md).
  The report shows FAIL reasons with counts
- **verify FAIL** → check the stderr summary in the report. You can ask "investigate the
  render failure" for diagnosis

## Next steps

- Save a well-made deliverable for next time → [Grow your asset library](./asset-library.md)
