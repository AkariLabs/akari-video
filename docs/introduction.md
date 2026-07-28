**English** | [日本語](./introduction.ja.md)

# Introduction — what is AKARI Video?

AKARI Video is a video editor where **an AI agent is the one doing the editing**.

Hand over your footage and the agent assembles the edit — analysis, cut decisions, titles
and captions, narration, BGM. The human does exactly two things: **say what you want to
make**, and **check that the result matches your intent**. The app is not a place to edit;
it is a place to review and fix.

## Three principles

### 1. Nearly finished when you open it

There is no screen for building a timeline from scratch. You open an edit the agent has
already finished and fix only what bothers you, with a drag and a sentence. Ninety percent
of adjustments are timing and placement, and those complete as data operations
(`data-start` / `data-duration` / CSS variables).

### 2. The save file is everything (SSOT)

The canonical edit state is `edit.json` plus overlay HTML fragments.

- The agent does not stack tool calls — it **reads and writes the save data directly**.
  Fast, robust, traceable with git diff
- Human actions (drags, value changes, text edits) are always written back to the same
  data. Humans and AI share the same files without colliding
- Whichever entrance you touch it from (terminal / opencode session / Claude Code session / app),
  everything converges on the same file contracts

### 3. No presets for expression

Captions, titles, shapes, and 3D are drawn freely by AI in HTML/CSS/Three.js.
It is not a combination of templates, so the range of expression is effectively
unlimited. In exchange, the engine's job is narrowed down to time sync and compositing.

Agents follow a convention of **declaring adjustable values as CSS variables**, so the
viewer can discover those variables and auto-generate sliders and color pickers.
"AI draws freely" and "humans fine-tune in a GUI" coexist.

## Architecture at a glance — a three-layer sandwich, plus hands

```
┌─────────────────────────────────────────────┐
│ Expression plane (Web)                      │ ← captions, titles, shapes, 3D
│  HTML/CSS/SVG/Three.js, time-synced         │    written by AI, touchable by humans
├─────────────────────────────────────────────┤
│ Video plane (native)                        │ ← gapless playback of the cut list
│  sample-accurate sync, HW decode            │
├─────────────────────────────────────────────┤
│ Hands (CLI)                                 │ ← ffmpeg / whisper.cpp /
│  cuts, proxies, encode, export              │    HyperFrames / generation APIs
└─────────────────────────────────────────────┘
```

- **Leave video to native code** — no hitches at cut boundaries, 4K hardware decode
- **Push expression to the Web** — AI draws in the languages LLMs are best at
  (HTML/CSS/Three.js), so no presets are needed
- **Export is frame-accurate** — preview is a live DOM for immediacy; export runs the
  same HTML through per-frame capture, guaranteeing WYSIWYG

For the full design and rationale, see
[design-2026-07-13-agent-native-architecture.md](./design-2026-07-13-agent-native-architecture.md)
(Japanese).

## Workflow — stages and skills

Each stage of production is an independent skill, usable from wherever you need it.

```
[Plan]         research-plan       ideas → research → brief → storyboard → shot list
   ↓
[Analyze]      analyze-footage     per-clip proxies, transcription, keyframe extraction
               analyze-project     cross-reads multiple clips into an interpretation report
   ↓
[Edit plan]    edit-plan           direction → asset plan → execution: three approval
                                   steps into edit.json
               overlay-authoring   titles, captions, figures, 3D, thumbnails
               generate-narration  narration (free local / voice clone)
   ↓
[QA & review]  edit-lint           deterministic CLI checks + frame inspection
               compile-review-session / address-review   spoken review → tickets → fixes
   ↓
[Export]       render-cut          plan → approval → render → verify
   ↓
[Harvest]      harvest-asset / bake-3d   store deliverables in the library, bake 3D
```

Each stage milestone is recorded in `.akari/events/`, one entry at a time, and the next
session you open offers to continue from where you left off.

## Human checkpoints (approval gates)

It is not fully automatic. By default, human approval is required at these milestones:

1. **Approve the editing direction** — look at the analysis report and OK the direction
2. **Approve the export** — confirm lint PASS and OK the render

The delegation level (`autonomy` in `.akari/intake.json`) can be `full-auto` /
`checkpoint` (default) / `collaborative`.

## Read next

- First time here → [Getting Started](./getting-started.md)
- Task-based usage → [Guides](./README.md#guides)
- File contract specs → [Reference](./README.md#reference) (Japanese)
