# Canvas 2D world

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

A `kind: "flat"` world moves its Canvas background and DOM assets inside the fragment with the same pure `camera(t)`. Keep a single fragment root and put exactly 1 declaration inside it.

```html
<div class="world-fragment">
  <div class="akari-world-sheet" data-world="paper">
    <div class="akari-world-zone" data-zone="desk" style="left:10px;top:12px">
      <!-- 素材・テロップ -->
    </div>
  </div>
  <script type="application/json" data-akari-world-scene>{
    "schemaVersion": 1,
    "kind": "flat",
    "frame": { "width": 1920, "height": 1080 },
    "worlds": [], "zones": [], "cameraStops": [], "edges": [], "retainedNodes": [],
    "render": { "dotStep": 90, "margin": 0.25, "hazeAlpha": 0.92 }
  }</script>
</div>
```

Copy `worlds` / `zones` / `cameraStops` / `edges` / `retainedNodes` from `planning/world-map.json`, excluding `inventory`. Each `worlds[].flat` has `bounds`, `pattern` (`dots` / `grid` / `none`), and optionally distant layers `far: [{ z, color }]`; `palette` has `background` / `dots` / `accent` and optional `haze`.

Put the corresponding `.akari-world-sheet[data-world]` directly below the fragment root for each world. Place zones in px relative to the world's `bounds` origin and mark them `.akari-world-zone[data-zone]`. Each tick the runtime writes only the sheet's `transform` / `transform-origin` and a zone's `display` for offscreen culling; it never touches asset or telop content.

Take time only from `render(container, seconds)`; do not use randomness, wall-clock time, or accumulated deltas. The same declaration and seconds must produce identical Canvas, DOM transform, and culling results. Cover `switchTime ± transition.cover / 2` for cuts / portals with uniform haze.

Use `window.akari.worldRuntime.drawOverview(ctx, descriptor, view, seconds, options)` for a bird's-eye overview. `view` is a camera-independent world → screen affine `{ scale, ox, oy }` (`screen = ox + p * scale`). If `options.frame === true`, overlay the current camera frame in `#EE82DF`. Do not duplicate custom map rendering.

## Write-back from the map tab

In the map tab, a flat stop can be moved by Option-drag. Only `akari world move-stop <project-root> --stop <id> --c x,y[,scale]` writes it back; spatial is unsupported. `world-map.json` is outside edit.json history, so there is no undo / redo.

## Build / preview a spatial world

`kind: "spatial"` uses the same `planning/world-map.json` and `camera(t)` as flat. `akari world build <project-root>` bakes floors, distant panels, haze panels, and zone markers into `assets/world/world.glb`. It adds `TourCamera`, whose eye and target are interpolated separately, and a `Tour` clip. Bake a deterministic grid derived from `palette.dots` into the floor so even a world matching the background color retains a visible structure. At the same time, generate in `overlays/world.html` the declaration below, accepted by three-runtime, and upsert it with ID `world` into the edit.json visual lane.

```json
{
  "model": "assets/world/world.glb",
  "camera": { "fromModel": "TourCamera" },
  "animationClip": "Tour",
  "environment": { "intensity": 0, "exposure": 1 },
  "lights": [],
  "fog": { "color": "#ccd9e6", "near": 1, "far": 128 },
  "background": { "color": "#182235" }
}
```

Generate `fog` from the first world's `palette.haze` only when present, and `background` from that same first world's `palette.background` only when present. Do not add keys when values are absent. Keep telops and 2D assets out of this three fragment; layer them as separate overlay items.

`akari world preview <project-root>` captures representative stop and edge PNGs through the same rasterization path as flat. With `--measure`, it scans non-move edges at 30 Hz and writes to `transition.cover` the continuous period of uniform haze where whole-image RGB standard deviation is at most 2. A 3D cut must pass through haze or an occluding object, not become a planar wipe.

edit.json version 2 is required. With an older format, build stops without modifying files. First run `akari migrate <project-root>`, including that dedicated command's confirmation and backup.
