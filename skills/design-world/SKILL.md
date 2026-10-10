---
name: design-world
description: Design, inspect, and assemble a flat world that connects multiple settings and stops with a continuous camera. Use for a world-building video, a map-based video, or a transition from paper into a browser.
---

# Design World

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

## Hard rules

- Run world operations only through `akari world check|build|preview|overview`; do not call repository implementation files directly.
- Treat `planning/world-map.json` as authoritative. Put only the generated output on the existing visual track without adding fields to `edit.json`.
- Create `planning/world-map.json` with `expand-template.mjs`, never by adding keys manually. The world runtime rejects unknown keys.
- v0 supports only `kind: flat`; do not design or build `spatial` worlds.
- Derive coordinates from the script and template layout. Do not copy coordinates from another project.
- Use `move` within one world and `portal` by default between worlds. If you choose `cut`, set `transition.kind: mist`.
- Every edge crossing a world boundary needs a non-empty `carry`; include every carried element in `retainedNodes`.
- Put at least two stops in each world, and match the IDs in zones and cameraStops.
- `edit.json` needs a **base video**: one entry in `sources` and one base item on a visual track. Without it, `render-cut` fails; a world overlay alone cannot be exported.

## Ask three questions first

1. How many worlds are there, and what is each one: paper, browser, street, room, or something else?
2. Which stops should viewers see in each world?
3. Which objects should carry across world boundaries?

## Procedure

0. Prepare the project and a plain 15-second base video. If using existing footage instead, register it in both `sources` and a visual item.

   ```sh
   PROJECT=<project>
   SKILL_DIR=<このスキルのディレクトリの絶対パス>
   mkdir -p "$PROJECT/planning" "$PROJECT/sources"
   ffmpeg -y -f lavfi -i "color=c=#101418:s=1920x1080:r=30:d=15" \
     -pix_fmt yuv420p "$PROJECT/sources/base.mp4"
   ```

Use the following v2 skeleton for `$PROJECT/edit.json`. At 30 fps, 15 seconds gives a `duration` of 450 frames. `akari world build` adds or updates the visual item whose ID is `world`. It overlaps the base item in time, so the build places it on a separate visual track.

   ```json
   {
     "version": 2,
     "output": { "width": 1920, "height": 1080, "fps": 30 },
     "sources": [{ "id": "base", "path": "sources/base.mp4" }],
     "tracks": [
       { "id": "v1", "lane": "visual", "items": [
         { "id": "base", "at": 0, "duration": 450, "source": { "kind": "media", "src": "base", "in": 0, "out": 15 } }
       ] }
     ]
   }
   ```

1. Choose a layout from `$SKILL_DIR/templates/`: `paper-to-browser` for entering a screen from paper, `browser-to-chat` for moving from a browser into a conversation, or `street-to-room` for walking into a room.
2. Copy the chosen JSON `sampleScript` into `$PROJECT/planning/script.json`. Adapt each stop's `label`, `dwell` in seconds, `asset`, per-world overrides, and `carry` to the brief. Total duration is `Σ dwell + Σ 辺の尺` (stop dwell times plus edge durations). Default edge durations are 0.75 seconds for `move`, 1.2 for `portal`, and 0.8 for `cut`. Set a display name through `script.worlds.<worldId>.label`, and override `background`, `dots`, `accent`, or `haze` through `.palette`. World and stop IDs are internal keys; change display wording through `label`, but do not change the number of stops or internal IDs in a template world.
3. Keep the script in the project rather than the skill directory, and expand it as follows.

   ```sh
   PROJECT=<project>
   SKILL_DIR=<このスキルのディレクトリの絶対パス>
   node "$SKILL_DIR/bin/expand-template.mjs" \
     "$SKILL_DIR/templates/paper-to-browser.json" \
     "$PROJECT/planning/script.json" \
     --out "$PROJECT/planning/world-map.json"
   ```

The expansion inserts **finite provisional `cover` values** of 0.18 seconds for a portal and 0.24 seconds for a cut so the first build can run. You may override `edges[].cover` in the template within 0–0.4 seconds, but the measured preview value is final.
4. Run `akari world check "$PROJECT"`; correct the script and expand it again until no errors remain.
5. Plan assets in three layers from a coordinated world-style bundle (for example, the world-compatible Pop Motion bundle): **background, entrance, and motif**. The background establishes each world's visual material, the entrance makes the portal crossing legible, and a motif gives each stop something to show. Fetch assets with `akari assets fetch <category/id>` as needed; `akari world build` resolves them within the project.
6. Create `planning/world-items.json` to associate assets with zones. Always write `asset` as `overlay/<id>`; `offset`, `scale`, and `vars` are optional. A non-negative delay such as `delay: 0.5` starts the asset clock at the `at + delay` of the stop with the same zone ID; omission means zero delay. For a world-sized background, `role: "background"` prevents the zone from being culled off-screen. Without a role, `world-width` or `world-height` in `vars` (optionally with a `--` prefix) also identifies a background.

   ```json
   {
     "schemaVersion": 1,
     "items": [
       {
         "id": "arrival-motif",
         "zone": "paper-note",
         "asset": "overlay/<使う素材の id>",
         "offset": [-240, -180],
         "scale": 0.85,
         "vars": { "accent": "#4285f4" }
       }
     ]
   }
   ```

Replace `<使う素材の id>` in `asset` with the actual asset ID. Match `zone` to the zone ID in `planning/world-map.json`. Items in one zone stack in array order, with later items above earlier ones. Measure each asset's anchor point and default size from `meta.json` and `fragment.html` before choosing `offset`; see the [composition guidance](world.md#composition-guidelines).
7. Run `akari world build "$PROJECT"` to generate `overlays/world.html` and the world item in `edit.json`.
8. Run `akari world preview "$PROJECT" --measure` and replace cover values in `planning/world-map.json` with measurements. The existing `overlays/world.html` still has provisional values, so run `akari world build "$PROJECT"` again and then `akari world check "$PROJECT" --strict`. Keep this order: **build → preview --measure → build → check --strict**.
9. Run `akari world overview "$PROJECT"` and show the person a bird's-eye map with the actual assets at the same time. Verify stop order, world boundaries, carried objects, and portal or cut positions.

Use the decision patterns in [world.md](world.md) when uncertain. See [guide.md](guide.md) for concepts and how to read the map tab.
