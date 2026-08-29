**English** | [日本語](./skills.ja.md)

# Skills Catalog

The agent-side workflow of AKARI Video is split into **23 skills** (one per production stage, plus two cross-cutting ones). This page is the single map: what each skill owns, when it triggers, and which external tools and runtimes it connects to.

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
| [declare-audio](../skills/declare-audio/SKILL.md) | Declaring "where the chorus, hits, and beats are" on your own audio, by ear (a browser timeline UI → `declarations.json`). The BGM auto-suggester reads these declarations and cues the chorus | Browser (a human decides the declarations) |
| [setup-remote](../skills/setup-remote/SKILL.md) | Remote setup: Tailscale doctor → guided install (human-in-the-loop) → tailnet-only HTTPS for the preview server → Taildrop delivery into the workspace inbox → end-to-end check. Never exposes anything to the public internet by default | Tailscale / Taildrop (install & login are done by the human) |
| [setup-chat-approval](../skills/setup-chat-approval/SKILL.md) | Chat approval setup: doctor → BotFather token issued and stored in credentials.env (human-in-the-loop) → chat-ID allow-list → notification with buttons → a tap updates `decisions.json`. Long polling only: no public endpoint, and free-text messages are never treated as instructions | Telegram Bot API (the token is issued and stored by the human) |
| [harvest-asset](../skills/harvest-asset/SKILL.md) | Harvesting high-cost deliverables into the asset library | — |
| [bake-3d](../skills/bake-3d/SKILL.md) | Baking 3D scenes into footage (clips). Creating, tuning, and re-baking `scene.py` recipes | **Blender** (headless, bpy) |
| [beat-sync-edit](../skills/beat-sync-edit/SKILL.md) | Machine-generating a beat-snapped edit.json plus its overlay set from a "generator", using the declared beats / hits / sections of the audio as the only time source (PVs and showcases where the picture moves with the music) | ffmpeg / ffprobe (declarations are made by a human via declare-audio) |

### Analysis

| Skill | Owns | External tools / connections |
|---|---|---|
| [analyze-footage](../skills/analyze-footage/SKILL.md) | Pull-driven analysis of one clip up to the requested level; defaults to L0 metadata + L1 audio → analysis.json | `akari media`; cloud transcription only with approval |
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
| [critique-cut](../skills/critique-cut/SKILL.md) | Reads a human-assembled edit.json, observes only the source ranges actually used, and returns a read-only critique of the current cut | `akari media` / `akari capture` |
| [edit-lint](../skills/edit-lint/SKILL.md) | Deterministic checks of edit.json plus analysis.json / captions.json / media; frame inspection after PASS | Bundled deterministic CLI |
| [compile-review-session](../skills/compile-review-session/SKILL.md) | Compiling recorded review sessions — transcription → reference resolution → open tickets in review.json | Three-layer STT (same as analyze-footage) |
| [address-review](../skills/address-review/SKILL.md) | Executing open tickets by the book: fix → edit-lint → ticket update (state machine) | Bundled `bin/respond.mjs` |

### Export

| Skill | Owns | External tools / connections |
|---|---|---|
| [render-cut](../skills/render-cut/SKILL.md) | From approved edit.json: plan → explicit approval → local export → verification → keyframe inspection | ffmpeg / ffprobe |
| [export-nle](../skills/export-nle/SKILL.md) | **BETA (untested against real NLEs)**: one-way export of edit.json to FCPXML (Final Cut / Resolve), FCP7 XML (Premiere) and SRT. Non-portable fields are reported in dropped[] | bundled deterministic CLI (ffprobe optional) |

### Cross-cutting

| Skill | Owns | External tools / connections |
|---|---|---|
| [manage-connections](../skills/manage-connections/SKILL.md) | Single registry for generation providers, SNS, memory connections, API-key references, model selection, and cost-approval policy. **The only gateway to paid generation and external publishing** | `.akari/connections.json` + a free, read-only doctor |
| [verify](../skills/verify/SKILL.md) | The verification ladder (L0 / L1 / L2) required by task contracts | Build & tests of the current Theia stack |

## 3D comes in two paths

"3D" is not one skill — it splits into two paths by purpose. The canonical routing rule lives in the [3D bake recipe contract](./contract-2026-07-14-3d-bake-recipe.md) (Japanese).

| Path | Purpose | Runtime | Entry point |
|---|---|---|---|
| A: Three.js overlay (**default**) | 3D in general — composites transparently, can play video on a screen, animates via clips baked into the glb | Transparent canvas + declarative JSON + bundled Three.js | [overlay-authoring/3d.md](../skills/overlay-authoring/3d.md) |
| B: Blender bake | Looks A cannot produce, cutting the simultaneous scene count, delivering a reusable library clip | None (the baked mp4 is ordinary footage) | [bake-3d](../skills/bake-3d/SKILL.md) |

Routing rule: **A is the default. Choose by the capability you need, not by where the result sits**
("I want it on the timeline as a clip" is not a reason for B). Pick B only when (1) you need a look the
declarative runtime cannot produce (depth of field, motion blur, ray-traced reflections, GI, particles),
(2) you must drop below ~2 simultaneous 3D scenes to stay inside the export's performance budget, or
(3) you are delivering a reusable clip to the asset library. A baked clip always carries an opaque
background and costs ~10 minutes to re-bake, so when in doubt start with A and fall back only once
you are stuck (confirmed in production on 2026-08-04).

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

## Search the shipped capability surface

Use `akari capability <query> --json` to search the actual tracked skill leaves, contracts, package
READMEs/manifests, and manifest-declared public CLI entries. Search includes nested Markdown leaves,
so a query such as `beat-sync` reaches `skills/edit-plan/beat-sync.md`, not only SKILL.md frontmatter.

When a query has zero text matches, `--record-miss` may record the inspected source-set hashes under
the current project's `.akari/reports/absence/`. Its fixed verdict requires review and always carries
`approved_to_build:false`; it is evidence of no text match, never permission to add a new capability.
The CLI works in a checkout and in the npm tarball. A copied Claude plugin without the CLI reports
capability search as unsupported instead of inventing a second catalog.

## Related pages

- [Guides](./README.md#guides) — task-based guides for each skill (how to use them)
- [Reference](./README.md#reference) — canonical data contracts (schemas)
- Root [README](../README.md) — the workflow at a glance
