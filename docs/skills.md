**English** | [日本語](./skills.ja.md)

# Skills Catalog

The agent-side workflow of AKARI Video is split into **17 skills** (one per production stage, plus two cross-cutting ones). This page is the single map: what each skill owns, when it triggers, and which external tools and runtimes it connects to.

The canonical source for each skill is its `skills/<name>/SKILL.md`. This page is an index; for procedures and hard rules, follow each SKILL.md and the related contracts ([Reference](./README.md#reference)).

## Skills in production-flow order

### Planning

| Skill | Owns | External tools / connections |
|---|---|---|
| [research-plan](../skills/research-plan/SKILL.md) | Ideas → target / competitor / trend research → brief, outline, storyboard, shot list. Topic and structure are confirmed through decision-card approval gates | Web research |

### Project & asset setup

| Skill | Owns | External tools / connections |
|---|---|---|
| [create-project](../skills/create-project/SKILL.md) | Headless project creation (template copy, creation report) | git (initialized only when safe) |
| [setup-library](../skills/setup-library/SKILL.md) | First-run setup: tool checks → starter-pack proposal → fetch, place, verify | ffmpeg / whisper-cli / headless Chrome (presence checks) |
| [setup-audio-library](../skills/setup-audio-library/SKILL.md) | Semi-automated BGM / SFX intake (candidate list → manual-download matching → listen and keep/drop) | Free audio sources (humans download) |
| [harvest-asset](../skills/harvest-asset/SKILL.md) | Harvesting high-cost deliverables into the asset library | — |
| [bake-3d](../skills/bake-3d/SKILL.md) | Baking 3D scenes into footage (clips). Creating, tuning, and re-baking `scene.py` recipes | **Blender** (headless, bpy) |

### Analysis

| Skill | Owns | External tools / connections |
|---|---|---|
| [analyze-footage](../skills/analyze-footage/SKILL.md) | Pre-edit analysis of a single clip (720p proxy, transcription, keyframes, edit events) → analysis.json | ffmpeg; three-layer STT (macOS SpeechAnalyzer / whisper.cpp / cloud behind approval) |
| [analyze-project](../skills/analyze-project/SKILL.md) | Cross-clip interpretation layer (interpretation.json) and a read-only analysis report | — |

### Editing

| Skill | Owns | External tools / connections |
|---|---|---|
| [edit-plan](../skills/edit-plan/SKILL.md) | Reads the analysis report as primary evidence; direction, asset plan, and execution confirmed by explicit approval, landing in edit.json v0 + overlays | — |
| [overlay-authoring](../skills/overlay-authoring/SKILL.md) | Authoring router for overlay HTML (captions, tables & charts, 3D, motion graphics, thumbnails, text-behind-person) | CSS keyframes / WAAPI; Three.js + glTF (declarative only — see [Supported animation runtimes](#supported-animation-runtimes)) |
| [generate-narration](../skills/generate-narration/SKILL.md) | Script text → narration audio → `audio.narration[]` in edit.json | VOICEVOX (local, free) / fal Qwen3-TTS (cloud voice clone, behind approval) |

### QA & review

| Skill | Owns | External tools / connections |
|---|---|---|
| [edit-lint](../skills/edit-lint/SKILL.md) | Deterministic checks of edit.json plus analysis.json / captions.json / media; frame inspection after PASS | Bundled deterministic CLI |
| [compile-review-session](../skills/compile-review-session/SKILL.md) | Compiling recorded review sessions — transcription → reference resolution → open tickets in review.json | Three-layer STT (same as analyze-footage) |
| [address-review](../skills/address-review/SKILL.md) | Executing open tickets by the book: fix → edit-lint → ticket update (state machine) | Bundled `bin/respond.mjs` |

### Export

| Skill | Owns | External tools / connections |
|---|---|---|
| [render-cut](../skills/render-cut/SKILL.md) | From approved edit.json: plan → explicit approval → local export → verification → keyframe inspection | ffmpeg / ffprobe |

### Cross-cutting

| Skill | Owns | External tools / connections |
|---|---|---|
| [manage-connections](../skills/manage-connections/SKILL.md) | Single registry for generation providers, SNS, memory connections, API-key references, model selection, and cost-approval policy. **The only gateway to paid generation and external publishing** | `.akari/connections.json` + a free, read-only doctor |
| [verify](../skills/verify/SKILL.md) | The verification ladder (L0 / L1 / L2) required by task contracts | Build & tests of the current Theia stack |

## 3D comes in two paths

"3D" is not one skill — it splits into two paths by purpose. The canonical routing rule lives in the [3D bake recipe contract](./contract-2026-07-14-3d-bake-recipe.md) (Japanese).

| Path | Purpose | Runtime | Entry point |
|---|---|---|---|
| A: Three.js overlay | Live 3D **layered on top of** footage (spinning logos, VideoTexture screens, …) | Transparent canvas + declarative JSON + bundled Three.js | [overlay-authoring/3d.md](../skills/overlay-authoring/3d.md) |
| B: Blender bake | Animating a 3D scene to produce **footage (a clip) itself** | None (the baked mp4 is ordinary footage) | [bake-3d](../skills/bake-3d/SKILL.md) |

Routing rule: **if it sits on the timeline as a clip, it's B; if it layers on top of footage, it's A.**

Why path B uses Blender (from the contract):

1. The baked mp4 passes through preview / export as ordinary footage with zero engine changes. The video itself is the truth, so WYSIWYG holds structurally
2. No 3D authoring feature inside the editor (no home-grown mini-DCC). Authoring lives in bpy scripts, which agents write
3. The recipe (scene.py + params) is the SSOT; the bake output is a regenerable cache — the same determinism discipline as edit.json

## Supported animation runtimes

Overlay fragments have two design gates:

- **No arbitrary JavaScript execution** (a trusted runtime reads non-executable declarations)
- **Deterministic seek** — seeking to the same timeline time reproduces the same picture (no wall-clock; time is injected externally via `currentTime`)

Only runtimes that pass both gates are on board.

| Runtime | Status | Shape |
|---|---|---|
| CSS keyframes | ✅ primary path | The runtime pauses animations and sets `currentTime = localTime * 1000` |
| Web Animations API (WAAPI) | ✅ primary path | Same, via `getAnimations()` |
| Three.js + glTF | ✅ declarative only | Non-executable `<script type="application/json">` declaration + bundled pinned runtime. No arbitrary JS in fragments |
| Blender | ✅ (bake, not a runtime) | Baked into mp4 and brought in as ordinary footage (path B) |
| Lottie / Anime.js / GSAP / TypeGPU / others | ❌ not supported | No generic JS seek hook yet. Any addition is expected to follow the "declarative + trusted runtime" shape (same as the Three.js overlay) |

Note: among the unsupported group, Lottie fits the shape best (assets carry their own timeline and expose an externally controllable playhead). No adoption timeline is set.

## Related pages

- [Guides](./README.md#guides) — task-based guides for each skill (how to use them)
- [Reference](./README.md#reference) — canonical data contracts (schemas)
- Root [README](../README.md) — the workflow at a glance
