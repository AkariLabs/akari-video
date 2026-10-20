# Listening gallery (keep / drop)

The library defaults to the workspace's `library/`. Without a workspace, use the legacy `~/.akari/assets/`.
Check the first line of `akari-assets list` (or `akari assets list`) for the actual location.
Below, `<ライブラリの置き場>` is the existing library-location placeholder; audio belongs in its `audio/` subdirectory.

A local gallery for listening to audio registered through [audio-drop-folder.md](audio-drop-folder.md) and deciding keep/drop.
Same pattern as decision-cards / intake-form: `127.0.0.1` only, zero external npm dependencies, atomic state writes to JSON sidecars.

## 1. Start

```sh
akari assets audio gallery
```

Prints `HELPER: http://localhost:<port>/` to stdout on launch. Present it unchanged and ask the user to open it in a browser.

## 2. What the screen shows

- Registered entries with `<ライブラリの置き場>/audio/<id>/meta.json` (existing library-location placeholder).
  Entries with `meta.json` but no playable audio files are omitted.
- Each entry's audio files play inline via `<audio controls>`.
  Served only through `/media/<id>/<filename>`; never serve files outside the library.
- License badges (credit required / no credit required / AI training prohibited), plus `mood[]` / `tempo`
  badges if present in `meta.json` (added in 2026-07-22 tasks/audio-fetch-gallery).
- Top input filters by ID / title.
- The copy-keep-list button copies currently kept IDs to the clipboard as a JSON array
  (for owner feedback pasted into other tools).
- Keep/drop buttons record decisions immediately in `<ライブラリの置き場>/audio/_gallery-state.json`
  (existing library-location placeholder; survives closing the page). Press the same button again to clear the decision.

## 3. After keeping a track (declarations)

Mark a kept track's chorus, hit points, and beats so automatic BGM suggestions prioritize it and can **start at the chorus**.
Use the sibling [declare-audio](../declare-audio/SKILL.md) skill (human listening and marking in a browser timeline).
This skill covers intake and keep/drop only; delegate declarations there.

## 4. Handling keep / drop

This skill only **records** keep/drop. Deleting actual `drop` files or updating `assets/audio/INDEX.md`
requires a separate human decision. Do not delete automatically or perform irreversible actions on possibly mistaken decisions.

## Common mistakes

- Binding the gallery server to a nonlocal address such as `0.0.0.0`.
- Manually editing `_gallery-state.json` and breaking consistency; use only atomic writes through the server.
- Claiming library organization complete from keep/drop records alone (file deletion and INDEX updates are separate stages).
