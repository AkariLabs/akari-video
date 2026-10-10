

# Verification loop

**Never use a full render as the verification method.** At 40 minutes per iteration, you can test only about ten times a day. A mini-project lasting a few seconds takes about 40 seconds per iteration and allows 60 times as many checks.

## 1. Render a short verification project by default

Create a project lasting only a few seconds and containing just the suspect fragment. Render it with the production renderer, then inspect the result visually.
```sh
mkdir -p .akari/work/mini/{assets,overlays}
cp overlays/<疑わしい断片>.html .akari/work/mini/overlays/
ffmpeg -f lavfi -i color=black:s=1920x1080:r=30:d=3 -c:v libx264 -pix_fmt yuv420p \
  -y .akari/work/mini/assets/base.mp4
# edit.json は base + 対象断片だけ
node packages/edit-lint/bin/edit-lint.mjs .akari/work/mini
node packages/render-cut/bin/render-cut.mjs .akari/work/mini
ffmpeg -ss 1.6 -i .akari/work/mini/exports/*.mp4 -frames:v 1 -y check.png
```
- **Use the production renderer**: previews and Blender do not match runtime output.
- **Always** decide 3D pose, texture orientation, and color through this path.
- To compare two ideas, place them side by side in one frame so a single render answers the question.

## 2. Probe individual frames for a faster check

Capture frames at selected times from the same sheet used in production without starting a full render:
```sh
akari internal beat-sync-probe-frame <project> 6.5 45.5 103.2
# → <project>/.akari/probe/t-<秒>.png（アルファ保持）
```
Two observed pitfalls matter here:

1. Use Chrome arguments **identical** to those in `packages/render-cut/src/rasterize.mjs`, including `--enable-unsafe-swiftshader`. Without that flag, a 3D sheet capture can take minutes or time out.
2. Preserve alpha in the screenshot with `omitBackground: true`, then composite it on black for inspection. Otherwise a white background can make the result appear entirely white.

## 3. Run the full render

Long renders depend on machine load. Another heavy process can push a frame beyond the default 60-second timeout and fail the entire render.
```sh
RENDER_CUT_CAPTURE_TIMEOUT_MS=300000 \
  node packages/render-cut/bin/render-cut.mjs <project>
```
- Set `RENDER_CUT_CAPTURE_TIMEOUT_MS` to allow five minutes per frame.
- On a busy machine, wait until it is free with `akari internal beat-sync-render-when-idle <project>`; waiting is faster than restarting a failed render. On Windows, load cannot be measured by this helper, so it starts the render without waiting.
- Monitor progress by comparing the number of files under `<project>/.akari/render-tmp/*/frames` with the expected frame count.

## 4. Inspect the export

**A `PASS` log entry alone does not establish completion.** Check all three:

1. **File:** Confirm the export exists in `exports/`; use `ffprobe` to check duration, resolution, frame rate, and audio streams.
2. **Picture:** Extract and view frames around every highlight. A contact sheet can make this faster.
3. **Sound:** Measure with `ffmpeg -af ebur128=peak=true`. Around −14 LUFS with peaks no higher than 0 dB is the appropriate range for social media.
```sh
ffmpeg -i out.mp4 -af ebur128=peak=true -f null - 2>&1 | tail -12 | grep -E "^\s+(I|LRA|Peak):"
```
**Check motion at three or more consecutive times.** A single still can conceal a static or reversed animation.

## 5. Apply review feedback

Fix the relevant part of the generator and rerun it. Do not edit `edit.json` or generated HTML directly.

- Preserve the reviewer's wording in the record so the reason for the change remains clear.
- Apply all feedback from one round before rendering again; rendering after every individual fix wastes time.
- Inspect both the requested locations and any other locations the changes could affect.
- State explicitly which items could not be fixed; never silently drop them.
