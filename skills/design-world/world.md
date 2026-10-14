

# World-design decisions

## Define world boundaries

A world boundary belongs where the background's physical rules, the screen's material, or the sense of time and place changes. A tour of one desk is one world; moving from a paper page into a browser screen calls for two. Before adding another world, state in one sentence what changes: background, coordinates, or which objects persist.

Each world needs at least two stops, serving as entrance and exit. A stop is a composition worth pausing the camera to read. Do not create stops for decoration alone.

## Choose an edge

- `move`: Continuous travel in one world that conveys distance; default 0.75 seconds.
- `portal`: Continuous entry into another world; the default when you want to show the entrance's shape or material. Default duration 1.2 seconds with `transition.kind` set to `dive`.
- `cut`: A semantic jump to another world. Use it only when time must be compressed; switch while mist covers the view. Default duration 0.8 seconds with `transition.kind` set to `mist`.

For a portal, `via` must be a non-empty logical name for the visible passage, such as a window, door, or hole. If the entrance asset ID is `paper-portal`, that name can also be `via`. For a cut, use the logical name of the asset or effect that creates the mist.

## Choose what carries across

Carry only objects needed to connect the story across a world boundary: perhaps the protagonist, a card in hand, or a visual cue guiding the eye. Every crossing needs a non-empty carry; collect all its IDs in `retainedNodes`. Do not carry backgrounds or props intentionally left behind.


## Time and cover

Allow roughly 1.5–2.0 seconds for a simple visual, 2.0–3.0 seconds for a heading, and 3.0–4.0 seconds for several elements. Give viewers enough reading time first, then shorten travel to meet the total duration.

Expansion sets a provisional `transition.cover` of 0.18 seconds for a portal and 0.24 seconds for a cut so the first build can run. The value measured by `akari world preview --measure` is authoritative and must be within 0–0.4 seconds. Then rerun `akari world build` to update `overlays/world.html`. A move always uses `{ "kind": "none", "cover": 0 }`.

## Composition guidelines

An asset's `delay: 0.5` starts its clock 0.5 seconds after the stop's `at`. Delay must be non-negative and defaults to zero; before arrival, the asset clock remains at zero.
Adding `role: "background"` to a background item prevents its zone from being culled. Without that role, `world-width` or `world-height` in `vars` (with an optional `--` prefix) also identifies a background.

For output width `W`, height `H`, and a stop camera `c` at `[x, y, scale]`, the visible frame in world pixels is:
```text
frame = [x - (W/2)/scale, y - (H/2)/scale, W/scale, H/scale]
```
For the default output of `W=1920` and `H=1080`:

| Scale | Frame width | Frame height | Half width | Half height |
|---:|---:|---:|---:|---:|
| 1.0 | 1920 | 1080 | 960 | 540 |
| 1.1 | 1745.5 | 981.8 | 872.7 | 490.9 |
| 1.2 | 1600 | 900 | 800 | 450 |
| 1.3 | 1476.9 | 830.8 | 738.5 | 415.4 |

Each asset's CSS variables in `meta.json` or `fragment.html` determine its default size. Measure its width, height, and transform origin before calculating `offset`. As a starting guide, place two or three visual elements at each stop.

### Offset anchor point

In `world-items.json`, `offset` is measured in world pixels from the stop center. For an asset anchored at its center, use the intended center position directly. For a top-left anchor, let its width be `w`, height `h`, scale `s`, and desired center `[cx, cy]`, then convert:
```text
offset = [cx - w * s / 2, cy - h * s / 2]
```
For a safe margin, let `c` be the asset center, `half` its scaled half-width and half-height, and `cameraScale` the stop camera's magnification. Require `|c.x| + half.width <= (960/cameraScale) - 120` horizontally and `|c.y| + half.height <= (540/cameraScale) - 120` vertically. The 120 world-pixel deduction is the edge margin. If the asset does not fit, shrink it through a CSS variable or `scale`.

The template layout leaves 140 world pixels between the visible frame and world bounds even at minimum scale 1.0. If you change `padding`, `worldHeight`, or `stopOffsetY`, choose margin `M` and satisfy `padding >= (W/2)/scaleMin + M` and `worldHeight/2 >= stopOffsetY + (H/2)/scaleMin + M`. Otherwise a white strip outside the world appears at a stop's screen edge. `bin/test` checks that every stop's visible frame remains within bounds.

### Keep neighboring stops out of frame

The visible frame is `1920/scale` wide. If that exceeds `stopSpacing`, an asset at the next stop enters the frame. Default `stopSpacing = 2000` exceeds the 1920-pixel frame at minimum scale 1.0. Keep each stop's assets within `±(stopSpacing/2) = ±1000` of its center to avoid showing its neighbors; reduce that reach by the same amount if you reduce `stopSpacing`.
Placing an explainer around −400 to the left and the main subject around +400 to the right guides the eye from left to right. Convert top-left anchors to `offset` with the formula above, and match color variables to that world's `palette.accent`.
