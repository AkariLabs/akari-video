**English** | [日本語](./shell-ui.ja.md)

# Shell UI: assets and the timeline

The desktop shell is a place to review and fix, not to build from scratch — but the
frequent fixes have direct mouse paths. This page covers the operations around the
asset panel and the timeline.

## Asset panel: right-click menu

Right-click an asset card (including unsorted items) or a deliverable row
(edit data / planning memo / export / report) to get:

- **Open** / **Show in Finder** / **Copy file** (macOS only) / **Copy path**
- **Add to timeline** (video / audio assets) — inserts at the playhead
- **Show asset info** (items under `assets/`)
- **Transcribe** (video / audio assets) — opens the step popup so you can follow progress and cancel midway
- **Rename** / **Delete** — both run a reference check against `edit.json` /
  `captions.json` first; delete moves the file to the Trash
- **Ask the agent** — hands the file to the connected partner agent
- **Move to assets** (unsorted items only)

Destructive items (rename / delete) and "ask the agent" are limited to assets,
unsorted items, and exports; data / plan / report rows only get the open-style items.

## Library: sources and recent assets

Use **All / Mine / Asset sites / Lab** above the search field to filter by source.
The same selection applies to home category counts and category contents, and stays
selected when you return home. Categories with no matches appear dimmed and can still
be opened. Text styles, text animations, LUTs, and transitions belong to Lab.

**Recently added** on the home page shows up to eight of your own and asset-site
assets, newest first. Assets from the same folder share one chip; clicking it opens
the category filtered to that folder. Click × beside the folder name to clear the
filter. Clicking an individual asset reveals its card.

Assets in your library appear as regular cards, and audio can be auditioned.
External index cards are included under Asset sites and keep their existing
Import and Ask actions.

## Drag & drop onto the timeline

Drag an asset card onto the timeline to place it: a duration ghost previews the span
and you pick the target track while dragging. Depending on the row you drop onto, video
and image assets land either in `layers[]` (stacked visuals) or in `cuts` (the main
cut track); audio lands in `audio.sfx[]`.

If an asset overlaps an existing clip on the target row, it goes onto a new track immediately above that row for video or images, or below it for audio; an insertion line and a message preview this while dragging.
Placement checks again using the actual duration, and one Undo removes both the new track and the added asset.

You can also **drop files straight from Finder onto the timeline**. Video files are
imported into `assets/` first and then placed at the position and row you dropped them
on. Dropping outside the timeline (asset panel, home) only imports them; place them
afterwards by right-clicking the asset card and choosing "Add to timeline".

## Timeline: clip right-click menu

Right-click a clip for **Copy / Paste / Split / Delete** — the same operations as the
existing keyboard handlers, surfaced as a menu.

## Everything lands in the save file

All of these operations write to the same file contracts (`edit.json` and friends)
that agents read and write. There is no UI-only state: anything you do by mouse can
be continued conversationally, and vice versa.

## Related

- What each file under `.akari/` means → [Project structure](./project-structure.md)
- The preview behavior spec → [contract-2026-08-02-preview-parity.md](../contract-2026-08-02-preview-parity.md) (Japanese)
