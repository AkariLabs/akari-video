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
(`data-start` / `data-duration` / CSS variables). Intent is yours; hands are the AI's.

### 2. The save file is everything (SSOT)

The canonical edit state is `edit.json` plus overlay HTML fragments.

- The agent does not stack tool calls — it **reads and writes the save data directly**.
  Fast, robust, traceable with git diff
- Human actions (drags, value changes, text edits) are always written back to the same
  data. Humans and AI share the same files without colliding
- Whichever entrance you touch it from (terminal / opencode session / Claude Code session / app),
  everything converges on the same file contracts

### 3. Expression is drawn, not picked from a fixed list

Captions, titles, shapes, and 3D are drawn freely by AI in HTML/CSS/Three.js, so the range
of expression is effectively unlimited. Styles and templates you keep are shortcuts you
choose to reuse, never a ceiling. In exchange, the engine's job is narrowed down to time
sync and compositing.

Agents follow a convention of **declaring adjustable values as CSS variables**, so the
viewer can discover those variables and auto-generate knobs: sliders and color pickers.
"AI draws freely" and "humans fine-tune in a GUI" coexist.

Everything also runs **headless-first**: each step is a CLI command or a skill that works
without the app, and the app is one more way to look at the same files.

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
[Start]        akari new --from    a playbook, or a blank project
   ↓
[Plan]         research-plan       ideas → research → brief → storyboard → shot list
   ↓
[Analyze]      analyze-footage     per-clip proxies, transcription, keyframe extraction
               analyze-project     cross-reads multiple clips into an interpretation report
   ↓
[Edit plan]    edit-plan           proposals into the timeline → review in preview
                                   → one stamp at export
               overlay-authoring   2D motion parts: titles, captions, figures, thumbnails
               author-scene3d      3D scenes (live Three.js by default / Blender bake)
               generate-narration  narration (free local / voice clone)
   ↓
[QA & review]  edit-lint           deterministic CLI checks + frame inspection
               compile-review-session / address-review   spoken review → tickets → fixes
   ↓
[Export]       render-cut          plan → approval → render → verify
   ↓
[Harvest]      harvest-asset       store deliverables in the library
               record-playbook     keep how this video was made as a playbook
```

Each stage milestone is recorded in `.akari/events/`, one entry at a time, and the next
session you open offers to continue from where you left off.

## How a video gets made

The words below are what you see on screen. Each one is named by what you can do with it.

- **Asset** — something you add and tweak with knobs: footage, images, sound, 3D, motion
  parts, fonts, your own shots.
- **Style** — something you apply: a caption look, a LUT, a transition, a motion. Styles you
  like are kept as your own styles.
- **Template** — a ready-made chunk with length, text, frames, and sound decided. Drop it
  from the library onto the timeline and drop your footage into its slots.
- **Playbook** — how a finished project was made: steps, checkpoints, settings, and
  placeholder slots. Record one from a project you like, then start a new project from it
  (`akari new --from`, or "Start from a playbook" on the home screen). It is a plan to read, so
  nothing is applied behind your back.

Around that, a few parts of the app do most of the work:

- **Home and the project panel.** Home lists recent projects and starts a new one, blank or
  from a playbook. The project panel on the left groups what you have (assets, filtered by
  kind), the record, and the output.
- **Annotations.** Draw, pin, mark a range, or attach a file right on the preview. The notes
  collect in the right panel, ready to hand to the AI, and are saved to `review.json`.
- **Script panel and timeline.** The top lane of the timeline is the script. Caption looks
  apply to all captions or only the words you select.
- **Scenes.** A project can hold scenes. Scene, structure, and relation tabs show how the
  parts connect, and `.akari/manifest.json` keeps that list of dependencies
  (`akari project sync` / `check` / `scene add`).
- **AI partners.** The app runs the agent you already use. Claude Code and Codex are the
  recommended pair; opencode, Cursor Agent, and Muse Code CLI also work. You can update
  these CLI agents from settings.
- **Lab.** More assets, styles, and templates come from the Lab, in two tiers: free
  (CC0) and Pro. Connect with `akari store connect`.

## One stamp, at export

The default is **With suggestions** (`checkpoint`). Requested items and promising additions go
into the timeline, with no intermediate approvals. Review the preview, remove or adjust
anything unwanted, and export. You give just one stamp, at export.

**Fully automatic** (`full-auto`) adds exactly what you asked for and exports without preview
review, with zero stamps. It then attaches 1–2 captures and lint results in `.akari/reports/`.

Only **Create together** (`collaborative`) confirms three stages — direction → asset plan →
execution — with a stamp at each stage.

Switch modes in the intake form (`autonomy` in `.akari/intake.json`). On Home, it is under "How to proceed",
in "How much to delegate".

Approval for billing and external sends is independent of the mode. The `connections.json` cost
approval policy takes priority ([Connections and API keys](./how-to/connections.md)).

Skills are discovered automatically from the Claude Code plugin, opencode, Cursor Agent,
and Codex. See the [Skills Catalog](./skills.md) for all 29.

## Read next

- First time here → [Getting Started](./getting-started.md)
- Task-based usage → [Guides](./README.md#guides)
- File contract specs → [Reference](./README.md#reference) (Japanese)

<!-- BEGIN GENERATED facts:stamp -->
This page describes AKARI Video v1.5.1 (released 2026-10-19).
<!-- END GENERATED facts:stamp -->
