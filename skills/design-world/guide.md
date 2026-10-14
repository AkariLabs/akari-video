

# Build a world and inspect its map

A world plan defines the video's backgrounds, stops, and camera travel on one map. `planning/world-map.json` is authoritative. The camera path and overview map come from that same file, so a video change cannot leave the map behind. v0 supports planar `flat` worlds.

A world shares one visual material and coordinate system. Give each world at least two stops with content viewers should pause to read. Start a new world when the background or governing rules change; connect stops within a world by moving the camera.

Choose assets in three layers from a coordinated world-style bundle (for example, the world-compatible Pop Motion bundle): **background, entrance, and motif**. The background establishes the world's appearance, the entrance explains a boundary crossing, and the motif supplies content at each stop.

## Three edge types

`move` travels continuously within one world. `portal` is the default world-crossing edge and enters through a visible opening, such as a window, door, or hole in paper. `cut` jumps between worlds to shorten time; always switch while mist covers the view. Declare people, cards, or other objects that remain visible across a boundary in `carry`.

`cover` is the time for which the transition hides the world switch. Expansion inserts provisional finite values of 0.18 seconds for a portal and 0.24 seconds for a cut so the first build can run. After `build` → `preview --measure`, run `build` again to apply the measured value, then pass `check --strict`. The measured value is authoritative and must be within 0–0.4 seconds. A move always uses `cover: 0`.


## What to check on the map tab

Check each world's area, stop order, edge type, and camera-stop times. Confirm an entrance and exit in every world, `move` edges within worlds, and `portal` or mist-covered `cut` edges at world boundaries. Keep only the objects needed on both sides in `carry`. The map is read-only; make corrections in the script or `planning/world-map.json`.
