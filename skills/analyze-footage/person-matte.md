# Generate a person matte (optional)

## Contents

- [Decide whether to execute first](#decide-whether-to-execute-first)
- [Check tools](#check-tools)
- [Generate](#generate)
- [Route a matte to a cut](#route-a-matte-to-a-cut)
- [Write to analysis.json](#write-to-analysisjson)
- [Use a grayscale mask](#use-a-grayscale-mask)
- [Install the RVM runtime](#install-the-rvm-runtime)
- [Verify on a Windows machine](#verify-on-a-windows-machine)
- [Degraded operation](#degraded-operation)

## Principles

Generate a matte only for footage selected for a person-based effect, such as text behind a person. The default analysis produces no matte and records `null` in `tracks.person_matte`. Follow the [person-matte data contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-23-analysis-person-matte.md).
The `$PERSON_MATTE_BIN/...` commands below are the public L3 sidecar-generator interface. They are not direct media-backend calls from this skill; the generator handles decoding and validation internally.

## Decide whether to execute first

Do not run matte generation on every source. Measured cost for an eight-second, 1280×720, 24 fps clip at `balanced` quality on a loaded machine:

| Process | Actual time ratio | Notes |
|---|---|---|
| Vision segmentation | About 1.7× source duration | 58 ms/frame; matte fixed at 512×384 |
| VP9 alpha encoding | Remaining time | **Dominates wall-clock cost** |
| Total | **About 7.7×** (8 seconds → 62 seconds) | A ten-minute source may take over an hour |

Run it only when every condition holds:

- A person appears in the footage, and a cutout effect has been chosen.
- The estimated processing time from the footage duration and measured ratio is acceptable.
- Seeing a face in the footage is insufficient: a face track in `tracks.faces` can be generated without a matte.

Choose quality by purpose:

| Quality | Use | Measured result |
|---|---|---|
| `fast` | Rough pass and preliminary check only to see whether this source can be cut out | 256×192 matte with stepped edges; **not for final output** |
| `balanced` (default) | **Production** text-behind-person or cutout | 512×384 matte, 58 ms/frame, usable edges |
| `accurate` | Close shots or final finishing | 2016×1512 matte, 135 ms/frame, 638 MB peak |
| `best` | Only when hair detail must be preserved clearly | RVM mobilenetv3; about 1–1.5 minutes for ten seconds of footage |
| `best --model resnet50` | Higher-cost option when more processing time is acceptable | RVM resnet50, substantially slower than mobilenetv3 |

On Windows, all quality levels use RVM mobilenetv3. Follow [Windows verification](#verify-on-a-windows-machine).

Do not record a `fast` output as a production matte in `analysis.json`.

## Check tools

```bash
PERSON_MATTE_BIN=".claude/skills/analyze-footage/bin/person-matte"
[ -d "$PERSON_MATTE_BIN" ] || PERSON_MATTE_BIN="skills/analyze-footage/bin/person-matte"
node "$PERSON_MATTE_BIN/person-matte.mjs" --check
```

Unless the check returns `available:true`, report `reason` and continue with a `null` matte. The result also includes `rvm_model`, indicating whether the default RVM model is deployed. macOS needs `swiftc`, the bundled media tools, and a VP9 alpha encoder. Windows needs the same media tools plus the RVM runtime and mobilenetv3 model, but not swiftc. Let the sidecar generator resolve the media tools.
Never install tools from the network. On Mac, the Swift helper builds automatically with `swiftc -O` on first use; do not commit the binary (see [.gitignore](.gitignore)).

## Generate

Write `matte/person-matte.webm` relative to the directory containing analysis.json.

```bash
node "$PERSON_MATTE_BIN/person-matte.mjs" \
  --input "$SOURCE" \
  --out "$OUT_DIR/matte/person-matte.webm"
```

Optional overrides (omit them to use defaults):

- `--quality fast|balanced|accurate|best` (default `balanced`).
- `--model mobilenetv3|resnet50` only with `--quality best` (default `mobilenetv3`). Fetch `resnet50` explicitly with `cd packages/matte-rvm && node scripts/fetch-models.mjs --model resnet50`.
- `--fps <n>` (default 24) sets the matte video's frame rate, which need not match the source.
- `--decode-width <n>` (default 1280) normally need not change: Vision matte resolution depends on quality rather than input resolution. For a source narrower than 1280, use its native width instead of upscaling.

Pass the **original footage** to `--input`. A proxy such as `proxy.mp4` is allowed, but its matte RGB will reflect the 720p proxy. Never use an input whose timing no longer matches the original.

On success, the command returns one JSON line with `ok`, `frames`, `bytes`, `elapsed_seconds`, `engine`, either `vision_ms_per_frame` or `rvm_ms_per_frame`, `alpha_transparent_ratio` (fraction of fully transparent pixels), and `probe` (measurements from the bundled prober). The helper checks the WebM for `codec_name = vp9` and `alpha_mode = 1` before returning success, so `ok: true` also confirms alpha was retained.

If the result is `ok: false`, report `reason`, keep the matte `null`, and continue the analysis. **A missing matte alone does not fail the whole analysis.**

## Route a matte to a cut

Choose the command by use case:

- To populate `tracks.person_matte` in `analysis.json` for the full source, use `person-matte.mjs` above. Source time zero and matte time zero must match.
- To place one edited cut on a person layer, use `person-cutout.mjs`. It resolves cut `in`, `out`, and `speed`, creates a speed-adjusted matte for that interval, and wires it into v2 `edit.json`.

```bash
node "$PERSON_MATTE_BIN/person-cutout.mjs" \
  --project /path/to/project \
  --cut 0
```

`--cut` indexes visual media items from zero by traversing v2 `tracks` bottom to top and each track's `items` in declared order. A comma-separated selection such as `0,2,4` is allowed. Automatically created `person-N` items do not count.
For this cutout command, use `--quality fast|balanced|accurate|best` (default `balanced`); set `--model mobilenetv3|resnet50` only with `best`.

The output is `<project>/assets/matte/person-<cut index>.webm`. v2 does not use the old `layers[]` or `timeline.tracks` fields; top-level `tracks[]` defines z-order from bottom to top. The command registers the matte in `sources[]` and puts its media item on a `person-cutout` visual track. That track moves to the front without changing the relative order of other tracks, so the person appears above HTML overlays and captions.

Rerunning for the same cut updates its `person-cutout-N` source and `person-N` item without duplicating source, item, or track. The command validates the candidate `edit.json` with both the v2 reader and `validate-edit.mjs` before an atomic rename. On failure, it leaves the original file unchanged.

Use `--dry-run` to inspect planned changes only. It creates no matte or directories and does not rewrite edit.json; stdout contains one JSON line describing the planned matte, layer-compatibility view, and track order.

```bash
node "$PERSON_MATTE_BIN/person-cutout.mjs" \
  --project /path/to/project \
  --cut 1,3 \
  --quality best \
  --model resnet50 \
  --dry-run
```

## Write to analysis.json

Use the returned `person_matte` object, but **rewrite `path` relative to the directory containing analysis.json**. The helper returns an absolute path for the call. Use `/` separators in the recorded path.

```json
"person_matte": {
  "path": "matte/person-matte.webm",
  "fps": 24,
  "quality": "balanced",
  "generated_at": "2026-07-23T01:33:30.069Z",
  "tool": "vision-person-segmentation"
}
```

`path` and `fps` are required; `quality`, `generated_at`, and `tool` are optional. Before finalizing, check the semantic constraints in [analysis-json.md](analysis-json.md#semantic-constraints-beyond-the-schema).

- Matte time zero matches source time zero; do not use an interval-trimmed matte here.
- `fps` matches the frame rate of the actual matte video.
- `path` resolves from analysis.json to an existing file.

## Use a grayscale mask

`person-matte.mjs` still produces VP9 alpha WebM and also makes `<basename>.mask.mp4` from the same inference's raw BGRA data. A successful `person_matte` result includes `mask_path` and `mask_format: "gray-h264-fullrange"`. If only mask generation fails, the WebM remains successful and the result records the degraded reason in `mask.reason`.

For an existing VP9 alpha WebM without a mask, run this idempotent conversion. It skips an output newer than the input; use `--force` only to regenerate it.

```bash
node "$PERSON_MATTE_BIN/mask-from-alpha.mjs" \
  --input "$OUT_DIR/matte/person-matte.webm"
```

Compare round-trip accuracy across all frames with:

```bash
node "$PERSON_MATTE_BIN/mask-roundtrip.mjs" --alpha <webm> --mask <mp4>
```

The pass/fail threshold treats alpha WebM as ground truth for an imported conversion. Comparing two outputs generated together measures the sum of their separate encoding losses. Therefore `ok:false` at that threshold does not by itself prove the sibling mask conversion is inaccurate.

## Install the RVM runtime

From the repository root, run the following command to make mattes on Windows or to use `--quality best` on Mac. It also addresses `rvm_runtime.available` reported as `false` by `--check`.

```bash
cd packages/matte-rvm && npm install
```

Install the model separately. After the runtime is ready, run `npm run fetch:models` in the same directory for the default model. Do not commit model files.

## Verify on a Windows machine

On Windows, `fast`, `balanced`, `accurate`, and `best` all use RVM mobilenetv3. Run these PowerShell commands from the repository root. Check for Node.js 20 or later, then explicitly install dependencies and the default model in `packages/matte-rvm`.

```powershell
node --version
cd packages\matte-rvm
npm install
npm run fetch:models
cd ..\..
$PersonMatteBin = if (Test-Path ".claude\skills\analyze-footage\bin\person-matte") { ".claude\skills\analyze-footage\bin\person-matte" } else { "skills\analyze-footage\bin\person-matte" }
```

Check the tools and installed model:

```powershell
node "$PersonMatteBin\person-matte.mjs" --check
```

Expect a one-line JSON result with `available` set to `true`, `rvm_model.missing` set to `false`, and `rvm_runtime.available` set to `true`.

```json
{"available":true,"rvm_model":{"model":"mobilenetv3","path":"C:\\...\\rvm_mobilenetv3_fp32.onnx","missing":false,"fetchHint":"cd packages/matte-rvm && node scripts/fetch-models.mjs"},"rvm_runtime":{"available":true,"reason":null,"installHint":"cd packages/matte-rvm && npm install"}}
```

Put one real clip containing a person at `C:\Users\owner\Videos\person-input.mp4`, then generate a `balanced` matte. Change the output path if needed.

```powershell
$SOURCE = "C:\Users\owner\Videos\person-input.mp4"
$OUT = "C:\Users\owner\Videos\person-matte-balanced.webm"
node "$PersonMatteBin\person-matte.mjs" --input "$SOURCE" --out "$OUT" --quality balanced
```

In the returned one-line JSON, check for `ok:true`, `engine:"rvm"`, `model:"mobilenetv3"`, and `probe.alpha_mode:"1"`. The selected `quality` should remain `person_matte.quality:"balanced"`.

```json
{"ok":true,"engine":"rvm","model":"mobilenetv3","person_matte":{"path":"C:\\Users\\owner\\Videos\\person-matte-balanced.webm","fps":24,"quality":"balanced","tool":"rvm-person-matting"},"probe":{"codec_name":"vp9","alpha_mode":"1"}}
```

Use `rvm_ms_per_frame` for RVM inference time in milliseconds per frame. Existing Mac measurements are **137–271 ms/frame**; compare Windows in the same unit. That value excludes VP9 encoding, so also report total `elapsed_seconds`.

Record the measurement:

- Windows PC: CPU ______ / RAM ______ GB / GPU ______ / Windows ______
- Source: resolution ______ / fps ______ / duration ______ seconds
- `rvm_ms_per_frame`: ______ ms/frame (compared to Mac 137-271 ms/frame)
- `elapsed_seconds`: ______ seconds

For a failure, read `reason` first:

- Missing runtime: Confirm `rvm_runtime.available:false`, run the one command in [Install the RVM runtime](#install-the-rvm-runtime), then check again.

- Missing model: Check `rvm_model.missing:true` or the `fetchHint` in the reason. Fetch mobilenetv3 and check again:

  ```powershell
  cd packages\matte-rvm
  node scripts\fetch-models.mjs
  cd ..\..
  node "$PersonMatteBin\person-matte.mjs" --check
  ```

- Missing bundled media tools: Re-run the `packages/media-bin` postinstall by reinstalling the package, then rerun `--check`:

  ```powershell
  cd packages\media-bin
  npm install
  cd ..\..
  node "$PersonMatteBin\person-matte.mjs" --check
  ```

- Missing `libvpx-vp9`: The resolved encoder cannot write VP9 alpha. Follow `reason` and check the media-bin installation and encoder resolution path.

## Degraded operation

If tools are unavailable, generation fails, or quality is unusable, set `tracks.person_matte` to `null`, finalize the rest of the analysis, and explain why in the completion report. Do not represent an ungenerated matte with an empty string or missing path.

Vision segmentation cannot separate individual fine hair strands; it is segmentation rather than detailed matting. For backlit footage or hair edges where that detail is required, even a generated matte may be too poor to use. In that case choose `null` and record the quality decision in the completion report.

## Common mistakes

- Running matte generation on unspecified footage merely because person-based effects might be used, multiplying analysis time.
- Accepting a `fast` matte as the final cutout.
- Re-encoding the matte with another media command and silently losing alpha.
- Trimming the matte to a mid-source interval, breaking the time-zero alignment.
- Changing `--fps` without updating `fps` in `analysis.json`.
- Writing the helper's absolute path directly to `path`.
- Withholding `analysis.json` entirely because the matte could not be created.
