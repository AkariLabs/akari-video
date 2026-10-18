**English** | [日本語](./asset-library.ja.md)

# Grow your asset library

Assets, styles, and templates are managed as a library that's reusable across projects.
The Library in the app's left panel is a single shelf for everything you drop onto the
timeline. Three skills are involved: `setup-library` (initial setup),
`setup-audio-library` (audio), and `harvest-asset` (adding new assets).

## The Library shelves

| Shelf | What's in it |
|---|---|
| Assets | Audio, video, images, motion parts, 3D and avatars, and so on. Things you add (place or apply), adjustable with knobs |
| Styles | Caption styles, text motion, fonts, LUTs, transitions, and so on. Things you apply; they have no duration |
| My styles | Styles you tuned and saved yourself, added through "Save your own styles" |
| Templates | One ready-made unit with duration, text, slots, and sound already decided. Local, channel, and Lab templates are listed here; drag one onto the timeline (see [Export a template](#export-a-template--akari-template-export)) |
| Import together from a kit | Imports the assets inside a kit all at once |

- The filter next to the search box narrows by source, tier (Free / Pro), license, and status
  (not downloaded / downloaded). You can also filter by "commercial use OK" and "attribution required"
- Every asset carries a source mark (yours / Lab / bundled). Pro assets from Lab work only while you hold the key
- An asset you haven't downloaded yet is fetched when you use it, and only the part you need.
  You can also drag files or folders onto the Library to import them
- Playbooks don't appear in the Library. Pick one from "Start from a playbook" on Home

## Initial setup — `setup-library`

**When to use**: The first time you use AKARI Video. When you don't have enough usable
assets.

**How to ask**: "set up the asset library" / "I don't have enough usable assets"

1. Checks required tools (ffmpeg, whisper-cli, headless Chrome, etc.)
2. Suggests a starter pack from `catalog/` (the curated catalog: 3D, audio,
   B-roll, fonts)
3. Approve → fetch, place, and verify

Nothing is fetched, purchased, or logged into without your approval, and assets whose
license can't be confirmed are not placed.

**Where assets live**: assets are placed under `assets/<category>/<id>/`, alongside a
declaration of provenance and usage (`meta.json`) and a preview image. Categories describe
the **shape of the artifact**, not its subject — six of them: `overlay` (timed HTML fragment;
called "motion parts" on screen), `still` (HTML sheet baked to an image), `scene3d` (3D model +
fragment or bake recipe), `audio`, `broll`, `font`. Subjects such as lower thirds, chalkboards,
or thumbnails are tags.

The catalog is **distributed by reference** — the catalog itself holds only links and
metadata; the actual files are downloaded and verified when fetched.

You can also work with the assets your account can use (free ones, plus Pro ones the key unlocks)
directly:

```sh
akari assets list [--category <c>] [--tag <t>] [--query <s>]
akari assets fetch <category/id> --project .
akari assets show <category/id>
```

In the list, ☁ means not downloaded, ✓ downloaded, and 🔒 Pro.

## Lab — Free and Pro

[Lab](https://akari.video/lab/) is where assets, styles, templates, and kits are distributed.
There are only two tiers: **Free** and **Pro**.

| | Free | Pro |
|---|---|---|
| Who can use it | Anyone | Anyone holding the Lab Pro (Lifetime) key |
| License | `CC0-1.0` | `LicenseRef-AKARI-Assets-v0` (no standalone redistribution, resale, or inclusion in other asset collections) |
| How it shows up | Downloads as is | Visible with a lock icon; with the key you can download it one item at a time |

- Connect the app with `akari store connect`; you approve the AKARI account connection in your browser
  (check the connection with `akari store status`)
- Assets you've already downloaded keep working
- Copies you downloaded as CC0 before a tier change stay CC0
- Tier and license rules: [Asset tier contract v1](../contract-2026-10-04-asset-tier-v1.md) and
  [Asset license axes v0](../contract-2026-09-25-asset-license-axes-v0.md) (both in Japanese).
  Commercial use and attribution are flagged before you export

### Install a kit

A kit is a bundle that ships skills, playbooks, templates, and assets together
(contract: [Extension kit v0](../contract-2026-09-13-extension-kit-v0.md), in Japanese).

```sh
akari store install <id>
akari store uninstall <id>
```

The 10 example playbooks Lab gives away for free (film, short drama, music video, explainer,
product intro, vlog, commercial, education, clip cut-down, and logo) also arrive as kits.
Once installed, they appear in Home's "Start from a playbook" list with the source "Lab".

### Assets in English

Bundled assets carry an English name, description, use case, and knob names under `i18n.en` in
`meta.json`. The English UI shows these (the Japanese UI shows the base fields).
You can add `i18n.en` to assets you bring in yourself; any field you leave out falls back to the base Japanese field.

## Add more audio — `setup-audio-library`

**How to ask**: "I want more BGM / sound effects"

The default is to bulk-download the official **AKARI Sounds** (BGM, jingles, and sound effects; free).

```sh
akari sounds              # bulk download (mp3)
akari sounds --dry-run    # just show what would be downloaded
akari sounds --variant wav
```

For families the official library doesn't cover (applause, failure sounds, Japanese-style impacts),
a semi-automatic flow fills the gap: preview candidates in an HTML list → match and place your picks
via a drop folder → confirm in a listening gallery. Downloads from outside sites happen only when you ask for them, one item at a time.

## Add finished work to the library — `harvest-asset`

**When to use**: When you want to reuse a costly, high-value deliverable made for a
project (motion parts, 3D, motion, titles, audio, B-roll) in future work.

**How to ask**: "add this title to the library"

Adding to the library attaches a `meta.json` (provenance, license, **a declaration of
adjustable knobs**) and a preview, so on the next project the agent can mechanically
discover what's available and what can be tuned. Things that are easy to regenerate (plain captions,
color variations, basic fades) are not added.

By default, assets go to your own local library. They go into the public repository's `assets/`
(bundled) only when you've decided to bundle them.

### Export a template — `akari template export`

A finished unit (one group) with sound, text, motion, and duration worked out can be exported as a template.
This is a separate path from `harvest-asset`.

```sh
akari template export <project> --item <group-item-id> --id <template-id> [--name <name>] [--out <dir>] [--license-own <license>]
akari template list [--json] [--category <c>] [--tag <t>] [--channel <ch>]
```

The v1.5.0 build has no `akari template`; export with `akari playbook template <project> --item … --id …`. From the next release, `akari template export|list` is available, and the old name stays as an alias.

Exported templates appear on the Library's Templates shelf. Drag one onto the timeline to place it as a single group,
and drop an asset onto an empty slot to swap the contents while keeping the slot's duration.
You can also start from one with `akari new --from`.
Spec: [Template v0](../contract-2026-10-16-template-v0.md) (Japanese)

## Scope — where assets get placed

| Scope | Location | Use |
|---|---|---|
| local | project's own `assets/` | this project only |
| shared | shared parent directory (`.akari/assets/`) | shared across multiple projects |
| user | the workspace's `library/` (the legacy `~/.akari/assets/` when there's no workspace) | your personal go-tos |
| builtin | bundled with the app / repo | usable out of the box |

The first line of `akari assets list` shows the actual location.

## Next steps

- Create 3D assets → [Bake a 3D scene](./bake-3d.md)
- Spec for the asset declaration format (meta.json) → [Reference](../README.md#reference)
