**English** | [日本語](./generation-models.ja.md)

# Generation models

This table is a facts-only band containing model facts about price, duration, inputs, audio, and calibration.
Check each row's `price_url` manually for current pricing.
`as_of` is the date on which that row was checked.

Treat a row as WARN after 90 days from `as_of`, and manually revisit its `source_url`.
Price is outside drift detection, so check `price_url` manually.

<!-- BEGIN GENERATED generation-models — scripts/gen-generation-models-doc.mjs が生成。手で編集しない -->

## Video models

| id | family | provider | First frame | Last frame | Reference images max | Reference videos max | Reference audio max | Duration | Resolution | Audio output | seed | Price | as_of | verified | Calibration |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fal:h3-i2v | MiniMax H3 | fal | △ | △ | 0 | 0 | 0 | 5〜15（step 1）; format: integer; default: 5 | resolutions: 480P, 768P, 2K, 4K; aspects: not specified | always included | yes | 480P: 0.05 $/second; 768P: 0.06 $/second; 2K: 0.13 $/second; 4K: 0.16 $/second | 2026-09-12 | documented | 2 entries: calibration/2026-08-23-camera-direction, lab/2026-09-13-w0-spikes |
| fal:h3-ref | MiniMax H3 | fal | − | − | 9 | 3 | 3 | 5〜15（step 1）; format: integer; default: 5 | resolutions: 480P, 768P, 2K, 4K; aspects: adaptive, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | always included | yes | 480P: 0.05 $/second; 768P: 0.06 $/second; 2K: 0.13 $/second; 4K: 0.16 $/second | 2026-09-12 | documented | 1 entry: lab/2026-09-13-w0-spikes |
| fal:kling-v3-standard-i2v | Kling Video v3 Standard | fal | ○ | △ | ? | ? | 0 | 3/4/5/6/7/8/9/10/11/12/13/14/15; format: string; default: 5 | resolutions: not specified; aspects: not specified | switchable | no | — | 2026-09-12 | documented | 0 entries |
| fal:kling-v3-pro-i2v | Kling Video v3 Pro | fal | ○ | △ | ? | ? | 0 | 3/4/5/6/7/8/9/10/11/12/13/14/15; format: string; default: 5 | resolutions: not specified; aspects: not specified | switchable | no | 0.112 $/second; audio ×1.5 | 2026-09-12 | documented | 0 entries |
| fal:veo-3.1-flf | Veo 3.1 | fal | ○ | ○ | 0 | 0 | 0 | 4/6/8; format: string (8s format); default: 8 | resolutions: 720p, 1080p, 4k; aspects: auto, 16:9, 9:16 | switchable | yes | 720p: 0.2 $/second; 1080p: 0.2 $/second; 4k: 0.4 $/second; audio ×2 | 2026-09-12 | documented | 0 entries |
| fal:veo-3.1-ref | Veo 3.1 | fal | − | − | ? | 0 | 0 | 8; format: string (8s format); default: 8 | resolutions: 720p, 1080p, 4k; aspects: 16:9, 9:16 | switchable | no | 720p: 0.2 $/second; 1080p: 0.2 $/second; 4k: 0.4 $/second; audio ×2 | 2026-09-12 | documented | 0 entries |
| fal:seedance-2.0-i2v | Seedance 2.0 | fal | ○ | △ | 0 | 0 | 0 | 4〜15（step 1）; format: string (auto allowed); no default | resolutions: 480p, 720p, 1080p, 4k; aspects: auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | switchable | no | 720p: 0.3034 $/second; 1080p: 0.682 $/second | 2026-09-12 | documented | 0 entries |
| fal:seedance-2.0-ref | Seedance 2.0 | fal | − | − | 9 | 3 | 3 | 4〜15（step 1）; format: string (auto allowed); no default | resolutions: 480p, 720p, 1080p, 4k; aspects: auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | switchable | no | 720p: 0.3034 $/second; 1080p: 0.682 $/second | 2026-09-12 | documented | 0 entries |
| fal:seedance-2.5-i2v | Seedance 2.5 | fal | ○ | △ | 0 | 0 | 0 | 4〜30（step 1）; format: string (auto allowed); no default | resolutions: 480p, 720p, 1080p; aspects: auto | switchable | no | — | 2026-09-12 | documented | 0 entries |
| fal:wan-2.7-i2v | Wan 2.7 | fal | △ | △ | 0 | 0 | 0 | 2〜15（step 1）; format: integer; default: 5 | resolutions: 720p, 1080p; aspects: not specified | none | yes | 0.1 $/second | 2026-09-12 | documented | 0 entries |
| fal:grok-imagine-i2v | Grok Imagine Video | fal | ○ | − | 0 | 0 | 0 | 1〜15（step 1）; format: integer; default: 6 | resolutions: 480p, 720p; aspects: auto, 16:9, 4:3, 3:2, 1:1, 2:3, 3:4, 9:16 | none | no | — | 2026-09-12 | documented | 0 entries |
| fal:vidu-q3-i2v | Vidu Q3 | fal | ○ | △ | 0 | 0 | 0 | 1〜16（step 1）; format: integer; default: 5 | resolutions: 360p, 540p, 720p, 1080p; aspects: not specified | switchable | yes | — | 2026-09-12 | documented | 0 entries |

## Image models

| id | family | provider | Reference images max | Resolution | Price | as_of | verified |
|---|---|---|---|---|---|---|---|
| codex:image | OpenAI GPT Image | codex | 1 | resolutions: not specified; aspects: not specified | — | 2026-09-12 | documented |
| fal:nano-banana-pro-edit | Nano Banana Pro | fal | 14 | resolutions: 1K, 2K, 4K; aspects: auto, 21:9, 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 3:4, 2:3, 9:16 | — | 2026-09-12 | documented |

<!-- END GENERATED generation-models -->

## Updating the list

Run `npm run gen:generation-models` to regenerate the list.
In CI, `npm run check:generation-models` detects drift.
