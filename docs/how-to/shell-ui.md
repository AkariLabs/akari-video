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
- **Rename** / **Delete** — both run a reference check against `edit.json` /
  `captions.json` first; delete moves the file to the Trash
- **Ask the agent** — hands the file to the connected partner agent
- **Move to assets** (unsorted items only)

Destructive items (rename / delete) and "ask the agent" are limited to assets,
unsorted items, and exports; data / plan / report rows only get the open-style items.

## Drag & drop onto the timeline

Drag an asset card onto the timeline to place it: a duration ghost previews the span
and you pick the target track while dragging. Video and image assets land in
`layers[]`; audio lands in `audio.sfx[]`.

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
