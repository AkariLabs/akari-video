**English** | [日本語](./overlays-and-captions.ja.md)

# Make titles, captions, figures, and 3D

What appears on top of the footage is made of two things: "motion parts" (HTML assets) that AI
draws in HTML/CSS/Three.js, and captions, text, and shapes held as data. You can ask in words,
apply a style from the library, or fine-tune with knobs.
The skill is `overlay-authoring` (called from edit-plan's execution stage, and also usable on
its own).

## When to use it

- "Put a caption here" / "Show this number as a table" / "Spin the title in 3D"
- When you want to change the caption style, or make only some words stand out
- When you want to add shapes, speech bubbles, or arrows
- When you want to make a thumbnail

## What it can make

| Type | Examples |
|---|---|
| Titles | Headlines, chapter cards, emphasis words |
| Captions | Spoken-word captions (karaoke display, emphasis support). The look applies to the whole caption or only to selected characters |
| Text styles | Layered outlines, gradient or pattern fills, offset shadows (see [Text styles](#text-styles)) |
| Telop bases | Decorative plates behind text (see [Telop bases](#telop-bases)) |
| Tables & charts | Visualizing numbers |
| Shapes | Basic shapes, lines, arrows, speech bubbles (see [Shapes](#shapes)) |
| 3D | Title and object effects via Three.js (see [3D](#3d)) |
| Motion graphics | In / emphasis / out motion and keyframes |
| Thumbnails | Static thumbnail images |
| text-behind-person | Text wrapped behind a person (works with person matte extraction) |
| Backgrounds | Full-frame background boards swapped per section (see [Backgrounds](#backgrounds-role-background)) |

Caption `style` accepts five values (`plain` shows the caption without motion):

| Style | Behavior |
|---|---|
| `plain` | Shown without motion |
| `karaoke` | Highlights each word as it is spoken |
| `pop` | Pops each word as it is spoken |
| `reveal` | Reveals one line at a time |
| `reveal-word` | Keeps each word hidden until it is spoken, then leaves it visible |

## How it works — touchable motion parts

What gets generated is an HTML fragment, referenced by an HTML clip in `tracks[].items[]`. There
are two conventions:

1. **Timing lives in `edit.json`** — a clip's start and duration come from its timeline item.
   Do not put `data-start` or `data-duration` on the fragment root. If the asset has a natural
   length, record it in seconds as `data-akari-natural-duration`; dragging on the timeline updates
   `edit.json`. Animation inside the fragment uses local seconds from the clip's start.
2. **Adjustable values are CSS variables** — colors, sizes, positions, and anything else you
   want as a knob are declared as CSS variables. The viewer discovers these variables and
   auto-generates sliders / color pickers. `--x` / `--y` / `--scale` / `--rotate` are
   runtime-reserved on every motion part (not just `role: "background"` ones) — the runtime always
   sets them inline on the container, so referencing or redefining them for a custom knob
   silently loses the fallback; use a non-reserved name instead (`edit-lint` warns via
   `overlays.reserved-css-var-reference`)

In other words, even something "the AI drew freely" can be fine-tuned by humans through a GUI
without reading the HTML. Text can be edited directly with a double-click, and the change is
written back into the data.

Click inside a motion part in the preview to select the element under the pointer (Enter steps
into the inner element, Esc returns to the whole part). Elements with an id or class can be
selected, and moved by dragging or with the arrow keys. The moved amount is saved only in the
project; the original HTML file is not rewritten.

## Backgrounds (`role: "background"`)

An HTML clip whose variables declare `"role": "background"` becomes a background board:
it always fills the frame, cannot be moved, and is meant to be swapped per section. The
position and scale knobs (`--x` / `--y` / `--scale` / `--rotate`) are locked — the runtime
pins the fragment to the output frame — and a background cannot carry a `transform`.
Use it for solid colors, gradients, and patterned boards behind captions and figures.
Motion parts without `role` behave exactly as before. What the schema cannot express
(locked-knob overrides via `vars`, overlapping background intervals) is checked by
`edit-lint`.

## Create captions (akari captions)

Run this in a project that has already been transcribed.

```sh
akari captions <project-dir>
```

- Preserve gaps: use word timestamps without filling silent gaps with captions.
- Reading allowance: add 0.3 seconds to the final word's end by default, capped at the next caption's start.
- Minimum duration: extend short captions to 1.0 second where the next caption permits; otherwise return a warning.
- Split at phrases: prioritize sentence endings, pauses, commas, then character / duration limits (defaults: 20 characters and 7 seconds; `--split none` restores legacy splitting).
- Cap at source duration: when probe duration is available, cap each end and drop captions shorter than 0.2 seconds with a warning.
- Apply the word book: use resolved entries by default (`--word-book <path>` adds a book; `--no-word-book` disables application).

Make corrections in the script panel or edit `captions.json` directly.

During transcription, words stretched into detected silence are snapped to the actual speech regions by
default. Apply the same correction later with `akari captions <project-dir> --retime` or the
“⏱ Align to speech” button in the script header. This preserves the text and keeps the row-level
`start` / `end` of manually edited (`edited: true`) captions unchanged.
When adjacent row display windows would overlap, speech alignment shares their boundary while keeping manually edited rows fixed.
For manually edited rows, it also fits every word inside the row's display window.
Pass `--no-snap` to `akari media transcribe` to disable automatic speech alignment.
End-of-row silence chips, the range editor (silence bands, waveform, and neighboring word bands), silence candidates in “Refine cuts,” and each row's output time all resolve against the source (`src`) that owns the row, so multi-source projects never mix sources up, and source boundaries are treated as word gaps.
`speaker` is filled in by cloud diarization (such as ElevenLabs Scribe); local engines (SpeechAnalyzer / whisper.cpp) leave it `null`.

## Lines, wrapping, scale and rotation

An object-form `captions.json` can set `display_policy.lines` from 1 through 6; the default is
1. `display_policy.wrap` controls how those lines are populated. The default, `multi`, displays
up to N sequential fragments at the same time. `fold` instead keeps one fragment and folds it
into up to N lines using `max_line_units` as the per-line budget.
Manual line breaks (／) placed in the script panel affect previews and exports even when the project has no `display_policy`.
Timeline caption bands are split into the same display fragments as the preview, and fragment visibility can be toggled from the caption track header.

Use `text_style.scale` for proportional plate scaling (0.4 through 3, default 1) and
`text_style.rotate` for rotation in degrees (-180 through 180, default 0). Both transforms use
the caption position as their center. `scale` and `rotate` are resolved once by the shared
caption kernel, so previews and exports read the same declared values.

## Caption looks — whole caption or selected characters

A caption's look is applied as a "caption style". Applying one from the library's caption
styles, from <!-- F ui.library.myStyles -->My styles<!-- /F -->, or from the inspector gives the same result, and applying a style never
changes the caption's size. When you change the size, the outline, shadow, glow, and plate
padding scale by the same ratio.

- **Whole caption**: select a line and apply a style. In the script panel, choose it from the
  line's "<!-- F ui.library.captionStyleSingular -->Caption style<!-- /F -->"
- **Selected characters only**: select words in the script panel and apply from "✦ Selected words".
  The output preview marks the selected characters with a dotted frame. To undo, use
  "Restore whole-caption appearance"
- The same action also appears under a shorter label, "✦ Emphasis". Earlier emphasis words
  (`emphasis_words`) move to selected characters when you fix the look
- What can be applied to selected characters: color, weight, italic, underline, letter spacing,
  scale, vertical shift, rotation, outline, shadow, glow, and plate. Font and size apply only to
  the whole caption (items that cannot apply to a range are dropped, with a notice)
- Plates, shadows, and glows render identically in preview and export. A caption that combines
  per-word display or typewriter with a plate, shadow, or glow on selected characters switches
  automatically from the fast GPU export to the regular export (the export screen shows the reason)

Everything is saved in `captions.json`: the whole caption's look in `text_style`, and selected
characters in `runs[]` (a `look` and `motion` per character range), both as plain values.
Contracts: [caption look v1](../contract-2026-10-12-caption-look-v1.md),
[caption runs v0](../contract-2026-09-24-caption-runs-v0.md), and
[emphasis words v0](../contract-2026-08-23-captions-emphasis-words-v0.md).

### Fixing captions in the older form

When you open a project that still has captions in the older form, the app offers to "fix the
look" once. It writes nothing until you confirm, records one history entry, and a single undo
restores it. From the command line you can check the difference and save:

```sh
akari captions migrate-look <project-dir> --dry-run   # show the difference only
akari captions migrate-look <project-dir>             # fix and save
```

## Text styles

Caption and text looks can be built up in layers.

- **Outlines**: stack several layers (outer to inner, back to front). Each layer has its own color,
  width, and offset (right / down), so an offset outline makes an offset shadow
- **Fill**: a solid color, a gradient (two or more color stops and an angle), or a pattern.
  Patterns are `diamond`, `dot`, `stripe`, `gingham`, `skull`, `hazard`, `night`, `heart`, and `thunder`
- Also shadow, glow, plate (backing), letter spacing, and uppercase
- Every color and width is a knob. Make a variant by changing a base style with the knobs

Save a finished style to <!-- F ui.library.myStyles -->My styles<!-- /F --> to reuse it in other projects. Contract:
[textstyle v1](../contract-2026-10-02-textstyle-v1-rich.md).

## Telop bases

A telop base is a decorative plate (a frame, a badge, and so on) laid behind text. They are
motion parts from the Lab; once placed they come with text and color knobs. Double-click the text
on the base to retype it, and use the same base with different text as many times as you like.

To make your own, ask the AI for the base you want. The plate is drawn in SVG, and the text goes
in an element marked `data-akari-slot` (retyped text is saved in `source.params` in `edit.json`,
and the original HTML is not rewritten).

## Motion and keyframes

- **In, emphasis, and out**: pick a preset under "Motion" in the inspector and change its
  duration, easing, and amount. A looping motion with a period can be added too
- **Keyframes**: set position, scale, rotation, and opacity per time. After moving something in
  the preview, "◆ Add keyframe" above the selection sets a key at that time. Click a diamond to jump
  to its time
- **Draw motion**: the path you drag in the preview becomes keyframes for the element's position

Contracts: [motion and keyframes](../contract-2026-08-30-motion-and-keyframes-v0.md) and
[motion layers](../contract-2026-09-25-motion-layers-v0.md).

## Shapes

From the library's "Shapes" shelf you can place basic shapes, polygons, arrows, lines, comic
speech bubbles, clouds, hearts, drops, gears, flowcharts, banners, and more. A placed shape is a
copy of the shelf shape and its defaults, so later changes to the shelf do not affect it.

- Fill and outline are a solid color or a gradient (2 to 5 colors); opacity is held per color
- Lines can be solid, dashed, or dotted, with end parts (triangle, arrowhead, circle, and others)
- Speech bubbles offer shapes (ellipse, rounded, jagged, cloud, and others) and a tail with
  adjustable direction and length

Contract: [shape item v1](../contract-2026-09-25-shape-item-v1.md).

## 3D

3D is built with Three.js + glTF. The fragment the AI writes holds a JSON declaration that is not
executed (model, camera, lights, environment).

- Select a 3D part and the inspector shows a "3D" section. Rotation can be set numerically and
  animated with keyframes
- In the preview, press the body to move it and grab a colored ring to rotate it
- Click or drag a 3D mockup from the library to place it. Drop a video or image onto the 3D
  object and it plays on the screen (a screen asset that is too large can fail to export, and a
  warning appears)
- A 3D scene that declares color sets lets you switch material colors with one knob
- 3D animated with keyframes also renders in the fast GPU export
- 3D text (`texts[]`) can face the camera with `billboard: true` and keep a constant on-screen size
  with `screenSpace: true`; both default to `false`, so existing declarations look the same
- With `screenSpace`, `size` is the em height in CSS pixels of the rendered canvas. The runtime
  scales the text by the camera's view depth and uses the canvas CSS height (not the export buffer),
  so the declared pixel size stays the same at any distance and at any preview resolution

For images the declarative runtime cannot express (depth of field, ray tracing, and the like), or
for a clip you will reuse, bake it into video with [Bake a 3D scene](./bake-3d.md).

## Thumbnails

A thumbnail is made by baking an HTML sheet into an image. There are three routes:

- **Real frame + HTML text**: use a frame from the video, and set text, numbers, logos, and UI in HTML
- **Image generation**: generate the background or motif
- **Hybrid**: a generated background with the final text set in HTML on top

Do not let image generation draw Japanese text, logos, or numbers; set them in HTML to avoid
misspellings and distortion. A thumbnail sheet is not a motion part in the video, so it needs no
timing data.

## Bringing in fonts

Drop font files onto the library (dropping them together with video and audio is fine; everything
appears in the import list).

- After import the preview reloads at once and the card opens under "Text › Fonts". You do not need to reopen the app
- Fonts are listed by typeface name, not file name, and merge into one card with the same catalog typeface. In the inspector's font list they appear as "Added by you"
- From the card you can "Show location" or "Remove from library"
- Typefaces you do not have carry a "Available", "Download", or "Download required" mark. A free typeface starts downloading as soon as you press it.
  For one that cannot be obtained, the app shows where to get it and "Apply with a substitute font"
- When a character used by a motion-part fragment is missing from every font it references,
  `edit-lint` reports `overlays.fragment-font-glyphs`. When the fragment's script creates
  characters, declare them on the fragment root with `data-akari-font-chars`

## Content language and asset translation

Each work can have its own language. In an English work, caption layout (characters per line,
line breaks, reading speed), disfluency detection, and narration voices follow English, and the
default caption typeface is Noto Sans.

An asset's `meta.json` (motion parts, styles, and so on) can carry an optional `i18n.en` with an
English `title`, `description`, `when_to_use`, `knobs`, `groups`, and `aliases`. The Japanese
fields are the base, and with an English interface each field is chosen in the order UI language,
en, base. Bundled assets and style names already carry English names and descriptions.

## Example requests

- "A title card at the start, TV-show style — white knockout text, sliding in from below"
- "Make the captions in this range an emphasis style, with only the keywords changing color"
- "Turn the sales trend into a bar chart motion part, from 12 seconds for 5 seconds"
- "I want big text behind the person saying 'START'" (text-behind-person)
- "Add an arrow and a speech bubble here"
- "Show my screen recording on this phone mockup and spin it"

Even a full visual overhaul can be requested in natural language and the AI will rewrite the
HTML. Small tweaks go through the knobs (CSS variables); big overhauls go through words —
that's the division of labor.

## Next steps

- Inspect the result → [QA, review, and fix](./review-and-fix.md)
- Reuse a good motion part next time → [Grow your asset library](./asset-library.md)
- Bake 3D into video footage → [Bake a 3D scene](./bake-3d.md)

<!-- BEGIN GENERATED facts:stamp -->
This page describes AKARI Video v1.5.1 (released 2026-10-19).
<!-- END GENERATED facts:stamp -->
