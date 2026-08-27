# Person matte decode benchmark

Electron / 320x180 / 30fps / 30 seconds. The H.264 phase runs first; every phase has an independent timeout.

The current and v2 timing columns use different instruments and their absolute values are not directly comparable. The comparable outcomes are issued seek operations and dropped/failed frames.

| path | codecs | UA processing p50 / p95 ms¹ | v2 decode-stage p50 / p95 ms² | wall color+mask p50 / p95 ms³ | currentTime assignments⁴ | seeking / seek operations⁵ | total frames⁶ | dropped / failed⁶ |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| current tolerant | vp9-alpha + vp9-alpha | 0.400 / 1.000 | — | — | 0 | 0 | 1810 | 0 |
| current strict | vp9-alpha + vp9-alpha | 0.300 / 0.700 | — | — | 1818 | 1816 | 36112 | 160 |
| v2 time-specified | h264 + h264 | — | 0.000 / 0.200 | 0.000 / 16.300 | — | 0 | 1800 | 0 |

1. UA processing is `requestVideoFrameCallback.processingDuration` for each VP9-alpha video callback.
2. v2 decode-stage is `FrameMetrics.decode` for each H.264 source decode.
3. Wall color+mask is the elapsed wall time for the parallel color and mask request pair.
4. Assignment count records writes to `HTMLVideoElement.currentTime`; tolerant writes only beyond one-frame drift, strict writes every tick.
5. Current rows count actual `seeking` events. v2 counts backwards time requests plus decoder-runtime-error recreations observed by its counting decorator.
6. Current rows come from `getVideoPlaybackQuality()`. v2 totals completed time-specified source requests and counts failed requests as dropped.

v2 seek instrumentation: backwards requests=0, decoder-runtime recreations=0, software fallbacks=0.

Cold and steady state are kept separate: tolerant cold UA=1.100 ms, steady p50/p95=0.400/1.000 ms; strict cold UA=0.400 ms, steady p50/p95=0.300/0.700 ms; v2 cold wall=193.900 ms, steady wall p50/p95=0.000/16.300 ms.

Skipped phases retain their reason in `test/benchmark/.generated/matte-benchmark-results.json`.
