# Puppeteer capture workers evidence

This directory contains a deterministic 1920×1080, 30 fps, 120-second karaoke-caption fixture,
reproducible benchmarks, and retained results from production multi-process Chrome.

## Reproduce

```sh
cd packages/render-cut
node evidence/capture-workers/generate-fixture.mjs /tmp/capture-workers-fixture
node evidence/capture-workers/benchmark.mjs \
  --work /tmp/capture-workers-benchmark \
  --result evidence/capture-workers/benchmark-results.json \
  --keep
node evidence/capture-workers/compare-sha256.mjs \
  /tmp/capture-workers-benchmark/workers-1 \
  /tmp/capture-workers-benchmark/workers-4
node evidence/capture-workers/probe-page-mode.mjs \
  --result evidence/capture-workers/page-mode-results.json
node evidence/capture-workers/benchmark-3d.mjs \
  --result evidence/capture-workers/benchmark-3d-results.json
```

The normal path above uses the same multi-process Chrome launch behavior as render-cut. A managed
sandbox that denies DevTools TCP binds or macOS child-process rendezvous may set
`AKARI_CAPTURE_SINGLE_PROCESS=1`; that opt-in adds pipe transport, `--single-process`, and
`--no-zygote`. Results produced in that fallback mode must not be used to choose between the page
and browser concurrency models.

## Synthetic fixture results

The retained run used darwin/arm64 with 8 available processors, Node v26.3.0, ffmpeg 8.1.1, and
multi-process Chromium headless shell from the Playwright cache directory
`chromium_headless_shell-1234`. Here, `1234` is a Playwright cache build identifier, not a Chrome
version number. Starting load averages were 5.51 / 4.28 / 6.23.

| workers | frame_loop_ms | total_ms | total / 120 s | frame-loop ms/frame | peak Chrome tree RSS |
|---:|---:|---:|---:|---:|---:|
| 1 | 187,553.920 | 197,665.362 | 1.6472× | 52.0983 | 411,729,920 B (392.7 MiB) |
| 2 | 95,718.279 | 105,567.873 | 0.8797× | 26.5884 | 801,275,904 B (764.2 MiB) |
| 4 | 54,736.586 | 64,698.254 | 0.5392× | 15.2046 | 1,509,769,216 B (1.406 GiB) |

workers=4 / workers=1 frame-loop ratio is **0.2918** (3.43× speedup), below the required one-third
threshold. Peak RSS at four workers is well below 4 GiB, so the automatic upper bound remains 4.
`benchmark-results.json` contains aggregate and per-worker seek/screenshot timings and RSS sample
counts.

The independent comparison covered all 3,600 filenames with zero missing or mismatched PNGs.
All retained MOV outputs have SHA-256
`cd81b65d82b3a545708e71978c583d11460b4ad7abc1341445c54f2e3b8b189f`; this also matches the prior
single-process diagnostic output.

## Implementation choice

The first-choice one-browser/multiple-page mode and the implemented one-browser-per-worker mode
were measured twice under true multi-process Chrome on the same 1080p, four-second, 120-frame
fixture:

| run | one browser / 1 page | one browser / 4 pages | page-mode speedup | 4 browsers | browser-mode speedup |
|---|---:|---:|---:|---:|---:|
| A | 5,999.0868 ms | 6,084.4015 ms | 0.9860× | 1,962.4453 ms | 3.0569× |
| B | 6,148.9340 ms | 6,471.8470 ms | 0.9501× | 2,041.4605 ms | 3.0120× |

Run A began at load averages 6.23 / 7.72 / 8.41; run B at 5.93 / 7.43 / 8.27. Four pages in one
browser do not approach the 2× switch threshold, while four isolated browsers exceed 3× in both
runs. This agrees with Puppeteer's BrowserContext screenshot mutex: `page.screenshot()` calls in a
single browser are serialized. The implementation therefore uses one browser and isolated
`chrome-profile-<i>` directory per worker.

A fresh Chrome text layer initially produced different antialiasing bytes at a mid-overlay chunk
boundary even though computed styles and WAAPI times matched. Replaying at most the first two
rendered states of only overlays already active at that boundary into discarded in-memory
screenshots initializes the raster layer identically. This warmup is included in frame-loop time;
only the worker's assigned absolute frame numbers are written to disk.

## 3D reference

The existing `3d-text-extrude` carousel fixture was captured through production multi-process
Chrome at 1280×720, 30 fps, two seconds:

| explicit workers | page_setup_ms | frame_loop_ms | total_ms |
|---:|---:|---:|---:|
| 1 | 2,802.057 | 6,707.812 | 10,263.248 |
| 2 | 5,153.855 | 5,041.518 | 10,820.174 |
| 4 | 7,286.035 | 3,706.466 | 11,726.546 |

All 60 PNGs and the MOV match between workers=1 and workers=4; the MOV SHA-256 is
`dc3acdee3502205311b27ea47a4043fec6d501f6233d0415c8f783026a7e322b`. Four workers improve the
frame loop by only 1.81×, increase page setup by 2.60×, and make total time worse. Automatic
resolution therefore remains workers=1/source=`auto` for a declared 3D scene; an explicit setting
is still honored.

## Field material

An external 3D field project was rendered from a temporary copy at 1920×1080, 30 fps, 100.9 seconds
(3,027 frames). Its declared 3D scene means every current path below uses one capture worker.

| run | start load averages | wall clock | final MP4 SHA-256 |
|---|---|---:|---|
| previous implementation | 5.66 / 4.55 / 5.53 | 2,884.880 s | `2fb396b9336ec02cb4dbfbb4f0991990825da1b4cdfa36f356823f23287fc44a` |
| `--capture-workers 1` | 10.01 / 12.23 / 15.38 | 3,078.604 s | `2fb396b9336ec02cb4dbfbb4f0991990825da1b4cdfa36f356823f23287fc44a` |
| automatic → 1 | 7.74 / 11.02 / 16.02 | 2,349.771 s | `2fb396b9336ec02cb4dbfbb4f0991990825da1b4cdfa36f356823f23287fc44a` |

Because all three runs execute the same one-worker capture path, the roughly ±15% spread around
their central wall-clock level is host-load noise, not a worker-count speedup. The final MP4 is
byte-identical in all runs. Compared with the previous implementation, render.json changes only by
the new `workers` / `workers_source` plan fields and the receipt hash covering those fields;
`provenance.rasterizer` is unchanged. Full data is in `field-material-results.json`.

## 2D CLI end-to-end

A 1280×720, 30 fps, ten-second karaoke project (300 frames, no 3D scene) was rendered through the
CLI for every selection route:

| run | workers | source | wall clock | final MP4 SHA-256 |
|---|---:|---|---:|---|
| previous implementation | — | — | 17.437 s | `ad19f239ed8ae0db000e4d69a361895869cc0056a102046be3cd099294949db5` |
| `--capture-workers 1` | 1 | cli | 17.150 s | `ad19f239ed8ae0db000e4d69a361895869cc0056a102046be3cd099294949db5` |
| automatic | 4 | auto | 8.813 s | `ad19f239ed8ae0db000e4d69a361895869cc0056a102046be3cd099294949db5` |
| `--capture-workers=4` | 4 | cli | 8.850 s | `ad19f239ed8ae0db000e4d69a361895869cc0056a102046be3cd099294949db5` |
| `AKARI_CAPTURE_WORKERS=2` | 2 | env | 11.476 s | `ad19f239ed8ae0db000e4d69a361895869cc0056a102046be3cd099294949db5` |

All five final MP4 files are byte-identical, proving that the 2D automatic value of four preserves
the previous implementation's output while shortening this end-to-end run. Full data is in
`two-dimensional-cli-results.json`.
