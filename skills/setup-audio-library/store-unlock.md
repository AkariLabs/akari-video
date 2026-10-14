# store-unlock — Install purchased declaration packs

The library defaults to the workspace's `library/`. Without a workspace, use the legacy `~/.akari/assets/`.
Check the first line of `akari-assets list` (or `akari assets list`) for the actual location.
Below, `<ライブラリの置き場>` is the existing library-location placeholder; audio belongs in its `audio/` subdirectory.

Use when the user asks to set up purchased assets or install a declaration pack, or requests library maintenance
with audio purchases in AKARI Store. The `akari store` CLI handles all mechanical work; this leaf only wires and verifies it.

## Procedure

1. **Check connection**: Run `akari store status`.
   - If disconnected, guide the user to `akari store connect` (browser opens → store login → approval button;
     no manual token copy/paste).
   - If connected, purchased assets are listed. Without `sounds-declaration-pack`, point to the store product page
     and stop (do not make the user purchase on your own initiative).
2. **Install**: `akari store install sounds-declaration-pack`.
   - Placed in `<ライブラリの置き場>/audio/declarations.json` (existing library-location placeholder;
     existing files are automatically backed up).
3. **Verify** (always before claiming completion):
   - `declarations.json` parses as JSON.
   - Track count matches the pack's displayed count (`node -e` with `Object.keys(...).length`).
   - Every entry has `bpm` / `beat_offset_s` / `hit_points` / `sections`.
4. **Report**: Give the track count and explain that automatic BGM suggestions (suggest-bgm) now prioritize
   these tracks with measured BPM and chorus cueing.

## Prohibited actions

- Do not manually edit declarations.json (store-distributed data is canonical; corrections arrive in the next pack version).
- Do not paste declaration contents (measured values) for users who have not purchased it (prevent paid-layer leakage).
