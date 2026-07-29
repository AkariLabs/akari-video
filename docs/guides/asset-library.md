**English** | [日本語](./asset-library.ja.md)

# Grow your asset library

Titles, 3D, BGM, SFX, B-roll, and other assets are managed as a library that's reusable
across projects. Three skills are involved: `setup-library` (initial setup),
`setup-audio-library` (audio), and `harvest-asset` (adding new assets).

## Initial setup — `setup-library`

**When to use**: The first time you use AKARI Video. When you don't have enough usable
assets.

**How to ask**: "set up the asset library" / "I don't have enough usable assets"

1. Checks required tools (ffmpeg, whisper-cli, headless Chrome, etc.)
2. Suggests a starter pack from `catalog/` (the curated catalog: 3D, audio,
   B-roll, fonts)
3. Approve → fetch, place, and verify

**Where assets live**: assets are placed under `assets/<category>/<id>/`, alongside a
declaration of provenance and usage (`meta.json`) and a preview image. Categories describe
the **shape of the artifact**, not its subject — six of them: `overlay` (timed HTML fragment),
`still` (HTML sheet baked to an image), `scene3d` (3D model + fragment or bake recipe),
`audio`, `broll`, `font`. Subjects such as lower thirds, chalkboards, or thumbnails are tags.

The catalog is **distributed by reference** — the catalog itself holds only links and
metadata; the actual files are downloaded and verified when fetched.

## Add more audio — `setup-audio-library`

**How to ask**: "I want more BGM / sound effects"

A semi-automatic flow: preview candidates in an HTML list → match and place your picks
via a drop folder → confirm in a listening gallery.

## Add finished work to the library — `harvest-asset`

**When to use**: When you want to reuse a costly, high-value deliverable made for a
project (overlays, 3D, motion, titles, audio, B-roll) in future work.

**How to ask**: "add this title to the library"

Adding to the library attaches a `meta.json` (provenance, license, **a declaration of
adjustable knobs**) and a preview, so on the next project the agent can mechanically
discover what's available and what can be tuned.

## Scope — where assets get placed

| Scope | Location | Use |
|---|---|---|
| local | project's own `assets/` | this project only |
| shared | shared parent directory | shared across multiple projects |
| user | `~/.akari-video/assets/` | your personal go-tos |
| builtin | bundled with the repo | usable out of the box |

## Next steps

- Create 3D assets → [Bake a 3D scene](./bake-3d.md)
- Spec for the asset declaration format (meta.json) → [Reference](../README.md#reference)
