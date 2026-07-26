**English** | [日本語](./README.ja.md)

# kaisetsu-short — Explainer Short Template

A 3-scene (title / diagram / ending) vertical-short explainer video template.
The design goal: **"swap the script JSON and the next video is done."**

A character talks with lip-sync, expressions, and idle sway while diagram cards reveal
step by step — VOICEVOX-narration-driven deterministic rendering
(browser composition → frame capture → mux).

## One-command usage

```bash
node tools/build.mjs <projectDir>
```

- Starting from `<projectDir>/project.json`, it runs (1) VOICEVOX synthesis if narration
  is missing, (2) `timeline.json` generation, (3) render, (4) QA screenshot capture —
  all in one command
- Skip synthesis: `--no-synthesize` (auto-skipped when narration already exists)
- Skip individual stages: `--no-qa` / `--no-render`
- Alternate aspect config: `--project project.landscape.json`

To try it out, use the bundled `sample-project/` (dummy script + placeholder character;
narration is included so VOICEVOX is not required):

```bash
node tools/build.mjs sample-project --no-synthesize
```

Each tool under `tools/` can also be run standalone:

- `synthesize.mjs <projectDir> [--only <beatId>] [--speaker <id>]` — VOICEVOX synthesis
- `generate-timeline.mjs <projectDir> [--out <path>] [--project <file>]` — timeline.json generation
- `render.mjs <projectDir> [--timeline <path>] [--out <path>] [--spotframes t1,t2,...]` — mp4 render
- `qa-capture.mjs <projectDir> [--safezone] [--times t1,t2,...]` — QA screenshots (see `qa/CHECKLIST.md`)

## Prerequisites

- Node.js + ffmpeg
- Puppeteer: set env var `KAISETSU_PUPPETEER_PKG` (absolute path to a package.json whose
  tree has puppeteer) — otherwise the tools search upward from the template location for
  `node_modules/puppeteer` (this repo's root node_modules is found automatically)
- VOICEVOX (only for synthesis; local engine at `http://127.0.0.1:50021`)
- ImageMagick (only to regenerate the placeholder character)

## Directory layout

```
composition/index.html   Fixed-layer template shell (zero hardcoded personal/video-specific content)
tools/                   CLI suite (shared logic in lib/)
qa/CHECKLIST.md          Canonical 8-item QA checklist
channel-sample/          Dummy channel assets (8-state placeholder character, procedurally generated)
sample-project/          Sample project with a dummy script (samples/ = bundled sample renders;
                         out*/ is build output, not tracked by git)
```

## Layer separation

| Layer | Files | Change frequency |
|---|---|---|
| Fixed (template body) | `composition/index.html`, `tools/`, `qa/CHECKLIST.md` | Template revisions only |
| Channel assets | `<project>/channel.json` + image assets | Per channel |
| Variable | `<project>/script.json` + `<project>/project.json` | Per video |

## project.json schema

```jsonc
{
  "aspect": "portrait" | "landscape",   // default portrait
  "fps": 30,
  "script": "./script.json",
  "channel": "./channel.json",           // may point at another project or channel-sample
  "narrationDir": "./narration",         // expects <beat.id>.wav + <beat.id>.query.json
  "outDir": "./out",
  "timing": { "leadIn": 0.8, "beatGap": 1.4, "tailHold": 4.5 }  // optional
}
```

## channel.json schema

```jsonc
{
  "character": {
    "assetsDir": "./assets",             // relative to channel.json
    "files": {                            // 8-state file naming convention
      "neutral-closed": "fullbody-neutral-closed.png",
      "neutral-half": "fullbody-neutral-half.png",
      "neutral-open": "fullbody-neutral-open.png",
      "happy": "fullbody-happy.png", "sad": "fullbody-sad.png",
      "angry": "fullbody-angry.png", "surprised": "fullbody-surprised.png",
      "laugh": "fullbody-laugh.png"
    },
    "sourceSize": { "width": 1024, "height": 1536 },
    "personBBox": { "x": 0, "y": 0, "w": 0, "h": 0 }  // person-silhouette bbox, identical across all 8 states (measure with ImageMagick trim)
  },
  "background": { "src": "./assets/bg.png" },
  "brand": { "accent": "#..", "accentDark": "#..", "ink": "#..", "inkSoft": "#..", "line": "#.." },
  "sns": [ { "icon": "x" | "instagram" | "youtube", "caption": "@handle or call-to-action text (\\n for line break)" } ]
}
```

## script.json schema (essentials)

```jsonc
{
  "titleCard": { "kicker": "...", "main": "line1\\nline2", "sub": "..." },
  "beats": [
    {
      "id": "b1", "scene": "title" | "diagram" | "ending",
      "text": "Full narration text (synthesize.mjs passes it to VOICEVOX as-is)",
      "expression_plan": [
        { "expr": "surprised", "holdCap": 1.2 },  // default cap 2.5s: hold limit for reaction expressions
        { "expr": "neutral" },
        { "expr": "happy", "at": { "sentence": 3, "offset": 0.5 } }  // explicit sentence anchor also allowed
      ],
      "diagram": { /* scene: "diagram" only, see below */ },
      "endingReveal": { "at": { "sentence": 1 }, "dur": 0.5 },  // scene: "ending" only (SNS row reveal)
      "sentenceOverride": [ { "text": "...", "t0": 12.75, "t1": 19.7 } ]  // optional: inject measured timestamps directly
    }
  ]
}
```

### Sentence anchors

Never hardcode absolute seconds for staged reveals or expression switches. Declare
`{"sentence": n, "offset": 0.1}` — "speech start of the n-th sentence (0-based) in the
beat, plus offset seconds" — and `generate-timeline.mjs` resolves it to absolute seconds
from the measured narration (sentence boundaries derived from VOICEVOX audio_query mora
timings).

Sentence splitting is derived automatically from `text` by default (deterministic
algorithm, see `tools/lib/sentences.mjs`). Use `sentenceOverride` to inject measured
timestamps directly when needed.

### diagram schema (diagram component vocabulary)

```jsonc
"diagram": {
  "align": "start" | "center",          // .dg justify-content, default start
  "gap": 22,                             // .dg-stack gap px, CSS default 22
  "stackTop": 0,                         // .dg-stack top px override (CSS default 100)
  "eyebrow": { "text": "...", "reveal": { "at": {...}, "dur": 0.4 } },
  "blocks": [ Block, ... ],              // layout "stack" (default)
  // or the crossfade layout (verified with exactly 2 groups):
  "groups": [ { "id": "g1", "blocks": [Block,...] }, { "id": "g2", "blocks": [Block,...] } ],
  "crossfade": { "at": {...}, "dur": 0.5 }
}
```

Common Block fields: `id`, `type`, `reveal?: {at, dur}`, `fadeOut?: {at, dur}`,
`collapseWhenHidden?: bool` (true toggles display none/on, false toggles visibility),
`display?: string` (display value when collapseWhenHidden), `preRevealOpacity?: number`
(minimum opacity before reveal — for a faint "preview" of a block before its real reveal).

Per-type vocabulary (details in `tools/lib/diagram.mjs`):

| type | Type-specific fields |
|---|---|
| `eyebrow` | `text` |
| `tier-ladder` | `rows: [{variant: "small"\|"medium"\|"large"\|"highlight", text, tag?, reveal?, preRevealOpacity?}]` (variant is a generic size scale; `tag` only on `highlight` rows) |
| `date-badge` / `dg-note` / `view-badge` / `disclaimer` | `text` |
| `note-strip` | `text`, `position?: "flow" \| "absolute-bottom"` |
| `shot-card` | `frames: [{src, width, height, at?}]` (frames[0] is the default, later entries swap in) |
| `mini-timeline` | `nodes: [{label, state: "neutral"\|"bad"\|"good"}]` |
| `big-emph` | `texts: [{text, at?}]` (texts[0] is the default, later entries swap the text) |
| `vs-card` | `left:{title,desc,variant}`, `right:{...}`, `bridge` |
| `cond-row` | `tag:{text,variant}`, `desc` |
| `bullet-row` | `text`, `mark?` (default "✓") |

Image `src` may be relative to script.json (`generate-timeline.mjs` resolves it to an
absolute `file://` URL based on the project dir and builds the preload list automatically).

## Layout profiles

`tools/lib/layout-profiles.mjs` defines two profiles: `portrait` (1080×1920) and
`landscape` (1920×1080). The landscape profile has been polished through a first real
production run: the speech-bubble tail points downward (the avatar sits below the bubble
in 16:9), diagram components (`vs-card`, `mini-timeline`, SNS captions) are resized for
the wider card, and the ending avatar/SNS rows are rebalanced. All landscape-specific
styling lives behind a `body[data-aspect="landscape"]` CSS guard, so portrait output is
pixel-identical to the golden-verified original.

## Determinism contract

`composition/index.html` only runs when injected with `window.__TIMELINE_DATA__`
(the timeline.json produced by generate-timeline.mjs). `window.akariSetTime(t)` is a pure
function of t, `window.__akariReady` awaits preload completion, and
`window.akariSetSafeZoneGuide(bool)` is QA-only (never called from the render path).
Rendering uses JPEG frames + a page re-open every 200 frames + a separate mux step
(frames are preserved by default, so an interrupted run can re-mux without re-capturing).

## Credits

- Audio under `sample-project/narration/` was synthesized with VOICEVOX —
  **VOICEVOX:玄野武宏 (Kurono Takehiro)**.
  If you re-synthesize or replace voices, credit the character you use per the VOICEVOX
  character's terms of use
- Placeholder character images are procedurally generated with ImageMagick
  (`channel-sample/generate-placeholder.mjs`)
