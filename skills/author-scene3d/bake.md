
# Bake a 3D recipe (scene.py) to MP4

This leaf is the exception path. Choose it only under the conditions in [SKILL.md](SKILL.md).

## Hard rules

1. **Never report that a bake succeeded without running it.** Do not treat it as complete until you check the output MP4 with ffprobe, extract frames, and inspect them visually.
2. **Do not introduce undeclared external inputs to scene.py.** Environment variables, wall-clock time, random numbers without an explicit seed, and network fetches are forbidden. Preserve: same recipe + same params + same Blender version → same video.
3. **Do not leave image sequences behind.** Write directly to MP4. If an intermediate sequence was necessary, always delete it after compositing.
4. **Do not modify source assets such as models or HDRIs.** Adjust only through parameter knobs. Do not bundle assets of unknown license with the recipe (inherit [harvest-asset](../harvest-asset/SKILL.md) rules).
5. **Do not install Blender without the user's approval** (same rule as [setup-library/tools-check.md](../setup-library/tools-check.md)).
6. **Do not report library intake as verified without passing `node packages/schemas/bin/validate-asset.mjs`.**

## Contract

Canonical source: [`docs/contract-2026-07-14-3d-bake-recipe.md`](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-14-3d-bake-recipe.md).
Recipe = SSOT (scene.py + parameters + asset references); baked output = reproducible cache.
Treat the baked MP4 as an ordinary edit.json clip (no engine or viewer changes).

## 1. Find Blender

```sh
BLENDER="${AKARI_BLENDER_BIN:-}"
[ -z "$BLENDER" ] && BLENDER="$(command -v blender || true)"
[ -z "$BLENDER" ] && BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
test -x "$BLENDER" && "$BLENDER" --version | head -1
```

If unavailable, suggest `brew install --cask blender` and stop; do not run it without approval.

## 2. scene.py authoring contract

Reference implementation: [`assets/scene3d/vintage-camera-turntable/scene.py`](https://github.com/AkariLabs/akari-video/blob/main/assets/scene3d/vintage-camera-turntable/scene.py)

- **Self-contained**: The recipe directory must work when copied alone into a project. Do not import other files from this repository. Resolve assets relative to `os.path.dirname(os.path.abspath(__file__))`.
- **Argument contract** (parse after `--` with argparse): `--out <path>.mp4` / `--profile draft|final` / `--fps N` / `--frame-start N` / `--frame-end N` / `--set key=value` (repeatable).
- **The PARAM_DEFAULTS dictionary must map 1:1 to meta.json knobs**. An undeclared `--set` key must be an error.
- **Time must be a pure function of the frame number**. Express animation with Blender's safe driver expression subset (`frame` plus arithmetic) or linear keyframes; never use wall-clock time.
- **Two quality profiles**: draft = lower-resolution EEVEE for knob iterations; final = output resolution. The same scene.py must support both.
- **Blender 5.x API caution** (measured on 5.1.2): engine ID is `BLENDER_EEVEE` (`_NEXT` is obsolete). For video, set `image_settings.media_type = "VIDEO"` before `file_format = "FFMPEG"` (4.x has no media_type; branch with hasattr).
- Blender may append the frame range to the output name. After rendering, normalize it to the `--out` name (follow the reference implementation's `render()`).

## 3. Run the bake

```sh
"$BLENDER" -b -P scene.py -- \
  --out bakes/<id>-draft.mp4 --profile draft \
  --fps 30 --frame-start 1 --frame-end 120 \
  --set orbit_start_deg=205
```

- Measured guide (M-series Mac / EEVEE / 720p / 16 samples): about 0.5–0.6 seconds per frame. A four-second draft takes about one minute.
- Baked outputs go in `bakes/` (already gitignored: `*.mp4`) and may be deleted. Bake final only immediately before project export.

## 4. Verification (required)

1. Use `ffprobe` to confirm resolution, fps, and frame count match the requested values.
2. Extract and visually inspect the first, middle, and last frames with `ffmpeg -ss <t> -frames:v 1` (composition, lighting, and animation direction).
3. For library intake, make `preview.png` from a middle frame and pass `node packages/schemas/bin/validate-asset.mjs assets/scene3d/<id>`.

## 5. Library intake / project use

- Use the asset-library intake standard: admit only recipes with high design cost in scene construction, lighting, or camera work.
- Declare meta.json knobs as `param` and `requires: ["blender"]`. Record asset source, license, and packaging procedure in provenance.
- Project use = copy the full recipe to `<project>/assets/scene3d/<id>/` → override params → bake → place the MP4 as a clip in edit.json. Record recipe ID, version, params, and Blender version in provenance.

## Common mistakes

- Reporting that headless EEVEE can bake without testing it (GPU environment dependent; always execute it).
- Writing animation that depends on wall-clock time or `random()`, as if using `THREE.Clock`.
- Declaring knobs as cssVar (bake recipes use param; cssVar is for overlay assets).
- Putting fragment.html and scene.py in the same asset directory (validate-asset.mjs rejects this).
- Packing textures into a bloated .blend or leaving an EXR sequence that consumes disk space.
- Baking final immediately without checking draft first, wasting iteration time.
