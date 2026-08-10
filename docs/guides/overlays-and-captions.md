**English** | [日本語](./overlays-and-captions.ja.md)

# Make titles, captions, figures, and 3D

Everything shown on top of the footage is drawn by AI in HTML/CSS/Three.js. There are no
presets. The skill is `overlay-authoring` (called from edit-plan's execution stage, and also
usable on its own).

## When to use it

- "Put a caption here" / "Show this number as a table" / "Spin the title in 3D"
- When you want to change the caption style
- When you want to make a thumbnail

## What it can make

| Type | Examples |
|---|---|
| Titles | Headlines, chapter cards, emphasis words |
| Captions | Spoken-word captions (karaoke display, emphasis support) |
| Tables & charts | Visualizing numbers |
| 3D | Title and object effects via Three.js |
| Motion graphics | Shape animation |
| Thumbnails | Static thumbnail images |
| text-behind-person | Text wrapped behind a person (works with person matte extraction) |
| Backgrounds | Full-frame background boards swapped per section (see [Background overlays](#background-overlays-role-background)) |

Caption `style` accepts four values:

| Style | Behavior |
|---|---|
| `karaoke` | Highlights each word as it is spoken |
| `pop` | Pops each word as it is spoken |
| `reveal` | Reveals one line at a time |
| `reveal-word` | Keeps each word hidden until it is spoken, then leaves it visible |

## How it works — touchable overlays

What gets generated is an HTML fragment, referenced from `edit.json`'s `overlays[]`. There
are two conventions:

1. **Timing lives in data attributes** — declared via `data-start` / `data-duration`.
   Dragging on the timeline lands as a rewrite of these values
2. **Adjustable values are CSS variables** — colors, sizes, positions, and anything else you
   want as a knob are declared as CSS variables. The viewer discovers these variables and
   auto-generates sliders / color pickers

In other words, even something "the AI drew freely" can be fine-tuned by humans through a GUI
without reading the HTML. Text can be edited directly with a double-click, and the change is
written back into the data.

## Background overlays (`role: "background"`)

An overlay declared with `"role": "background"` in `overlays[]` becomes a background board:
it always fills the frame, cannot be moved, and is meant to be swapped per section. The
position and scale knobs (`--x` / `--y` / `--scale` / `--rotate`) are locked — the runtime
pins the fragment to the output frame — and a background overlay cannot carry a `transform`.
Use it for solid colors, gradients, and patterned boards behind captions and figures.
Overlays without `role` behave exactly as before. What the schema cannot express
(locked-knob overrides via `vars`, overlapping background intervals) is checked by
`edit-lint`.

## Example requests

- "A title card at the start, TV-show style — white knockout text, sliding in from below"
- "Make the captions in this range an emphasis style, with only the keywords changing color"
- "Turn the sales trend into a bar chart overlay, from 12 seconds for 5 seconds"
- "I want big text behind the person saying 'START'" (text-behind-person)

Even a full visual overhaul can be requested in natural language and the AI will rewrite the
HTML. Small tweaks go through the knobs (CSS variables); big overhauls go through words —
that's the division of labor.

## Next steps

- Inspect the result → [QA, review, and fix](./review-and-fix.md)
- Reuse a good overlay next time → [Grow your asset library](./asset-library.md)
- Bake 3D into video footage → [Bake a 3D scene](./bake-3d.md)
