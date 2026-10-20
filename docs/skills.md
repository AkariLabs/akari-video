**English** | [日本語](./skills.ja.md)

# Skills Catalog

The agent-side workflow of AKARI Video is split into **27 skills** (one per production stage, plus cross-cutting skills). This page is the single map: what each skill owns, when it triggers, and which external tools and runtimes it connects to.

The canonical source for each skill is its `skills/<name>/SKILL.md`. This page is an index; for procedures and hard rules, follow each SKILL.md and the related contracts ([Reference](./README.md#reference)).

## Renaming a skill

- Add one row to `skills/renames.json` (`from` / `to` / `since`); the app and the project sync resolve old names to the new one.
- Append `（旧名: <from>）` once to the end of the renamed SKILL.md's description.
- Leave no old-name references under `skills/`, `docs/`, `AGENTS.md`, `README*`, `plugin/`, or `templates/` (tests check this; CHANGELOG and release notes are excluded).

## Skills in production-flow order

The order follows a video from idea to delivery: plan → prepare → analyze → edit plan → expression → QA & review → export → turn the result into assets or a playbook.

### Planning

| Skill | Owns | External tools / connections |
|---|---|---|
| [research-plan](../skills/research-plan/SKILL.md) | Ideas → target / competitor / trend research → brief, outline, storyboard, shot list. Topic and structure are confirmed through decision-card approval gates | Web research |

### Preparation

| Skill | Owns | External tools / connections |
|---|---|---|
| [akari](../skills/akari/SKILL.md) | Entry point: create, open, or resume a project. Also recommends up to three playbooks that fit the footage and applies the one the user picks, and routes work that needs external tools through recipes | akari CLI (`init` / `new` / `status` / `playbook` / `recipe`) |
| [create-project](../skills/create-project/SKILL.md) | Headless project creation: copy the scaffold (the empty project structure), record its version, and write a creation report. `--from` starts from a playbook | akari CLI (`new`); git (initialized only when safe) |
| [setup-library](../skills/setup-library/SKILL.md) | First-run setup: tool checks → starter-pack proposal → fetch, place, verify. Also fetches the free assets and purchased Pro assets of the connected Lab account, and covers the audio library (BGM / SFX): first-party AKARI Sounds from GitHub Releases, then candidate list → manual-download matching → listen and keep/drop for missing families | ffmpeg / whisper-cli; `akari assets`, `akari store connect`; GitHub Releases (AKARI Sounds) / free audio sources (humans download) |
| [declare-audio](../skills/declare-audio/SKILL.md) | Declaring "where the chorus, hits, and beats are" on your own audio, by ear (a browser timeline UI → `declarations.json`). The BGM auto-suggester reads these declarations and cues the chorus | Browser (a human decides the declarations) |
| [setup-remote](../skills/setup-remote/SKILL.md) | Remote setup: Tailscale doctor → guided install (human-in-the-loop) → tailnet-only HTTPS for the preview server → Taildrop delivery into the workspace inbox → end-to-end check. Never exposes anything to the public internet by default | Tailscale / Taildrop (install & login are done by the human) |
| [setup-chat-approval](../skills/setup-chat-approval/SKILL.md) | Chat approval setup: doctor → BotFather token issued and stored in credentials.env (human-in-the-loop) → chat-ID allow-list → notification with buttons → a tap updates `decisions.json`. Long polling only: no public endpoint, and free-text messages are never treated as instructions | Telegram Bot API (the token is issued and stored by the human) |

### Analysis

| Skill | Owns | External tools / connections |
|---|---|---|
| [analyze-footage](../skills/analyze-footage/SKILL.md) | Pull-driven analysis of one clip up to the requested level (L0 metadata, L1 audio, L2 visuals, L3 person tracks); defaults to L0 + L1 → analysis.json | `akari media` (local speech recognition; cloud transcription only with approval) |
| [analyze-project](../skills/analyze-project/SKILL.md) | Cross-clip interpretation layer (interpretation.json) and a read-only analysis report with images | — |

### Edit plan

| Skill | Owns | External tools / connections |
|---|---|---|
| [edit-plan](../skills/edit-plan/SKILL.md) | Reads the analysis report as primary evidence; direction, asset plan, and execution confirmed by explicit chat approval, landing in edit.json v2 and its motion parts. Also plans from no media through questions and a provisional plan | — |
| [beat-sync-edit](../skills/beat-sync-edit/SKILL.md) | Machine-generating a beat-snapped edit.json plus its motion parts from a "generator", using the declared beats / hits / sections of the audio as the only time source (PVs and showcases where the picture moves with the music) | ffmpeg / ffprobe (declarations are made by a human via declare-audio) |
| [design-world](../skills/design-world/SKILL.md) | Brief → scaffold → script → `world-map.json` → checked, built, measured flat-world video and overview | Bundled `akari world` CLI |

### Expression

| Skill | Owns | External tools / connections |
|---|---|---|
| [overlay-authoring](../skills/overlay-authoring/SKILL.md) | Authoring router for 2D motion parts (HTML assets: captions, tables & charts, glass, motion graphics, thumbnails, text-behind-person). 3D is routed to author-scene3d | CSS keyframes / WAAPI; declarative glass, WebGPU, and Canvas 2D world runtimes (see [Supported animation runtimes](#supported-animation-runtimes)) |
| [author-scene3d](../skills/author-scene3d/SKILL.md) | One entrance for 3D: live Three.js + glTF scenes by default, and a Blender bake (`scene.py` → mp4) only for looks the declarative runtime cannot produce. The decision table lives in the skill | **Blender** (headless, bpy) only for the bake path |
| [generate-narration](../skills/generate-narration/SKILL.md) | Script text → narration audio → `audio.narration[]` in edit.json. Local engines are free; cloud engines (including cloning your own voice) run only after cost approval | VOICEVOX / Irodori (local, free) / fal, Google AI Gemini TTS, Fish Audio (cloud, behind approval) |
| [generate-image](../skills/generate-image/SKILL.md) | Prompt → still image on the timeline as an asset or placeholder. A thin skill that generate-video references; it does not own timing or the video chain | Allowed image models from setup-connections (cost approval when paid) |
| [generate-video](../skills/generate-video/SKILL.md) | Still or text-card placeholder clips → one-clip-at-a-time video generation → resumable retrieval and in-place timeline replacement | Allowed video providers from setup-connections (cost approval) |

### QA & review

| Skill | Owns | External tools / connections |
|---|---|---|
| [critique-cut](../skills/critique-cut/SKILL.md) | Reads a human-assembled edit.json, observes only the source ranges actually used, and returns a read-only critique of the current cut | `akari media` / `akari capture` |
| [edit-lint](../skills/edit-lint/SKILL.md) | Deterministic checks of edit.json plus analysis.json / captions.json / media; frame inspection after PASS | Bundled deterministic CLI |
| [compile-review-session](../skills/compile-review-session/SKILL.md) | Transcribing review recordings → resolving references → open comments in review.json | Three-layer STT (same as analyze-footage) |
| [address-review](../skills/address-review/SKILL.md) | Executing open comments (the notes made in the app's annotation panel are in review.json too) by the book: fix → edit-lint → comment update (state machine) | Bundled `bin/respond.mjs` |

### Export

| Skill | Owns | External tools / connections |
|---|---|---|
| [render-cut](../skills/render-cut/SKILL.md) | From approved edit.json: plan → explicit approval → local export (`--engine auto` uses the GPU when the work is eligible, otherwise OSR) → verification → keyframe inspection | ffmpeg / ffprobe |
| [export-nle](../skills/export-nle/SKILL.md) | **BETA (untested against real NLEs)**: one-way export of edit.json to FCPXML (Final Cut / Resolve), FCP7 XML (Premiere) and SRT. Non-portable fields are reported in dropped[] | bundled deterministic CLI (ffprobe optional) |

### Assets and playbooks

| Skill | Owns | External tools / connections |
|---|---|---|
| [harvest-asset](../skills/harvest-asset/SKILL.md) | Harvesting high-cost deliverables into the asset library: admission check, `meta.json` with knobs, previews, INDEX, validation | — |
| [record-playbook](../skills/record-playbook/SKILL.md) | Record a finished project's steps, settings, role placeholders, parts, and required tools as a playbook (`planning/playbook.md` + `playbook.json`), attach key scene frames, and copy it to the local shelf | Bundled deterministic helper and playbook validator; ffmpeg / ffprobe for preview frames |

### Cross-cutting

| Skill | Owns | External tools / connections |
|---|---|---|
| [setup-connections](../skills/setup-connections/SKILL.md) | The single entrance for connection setup and inspection: generation providers, SNS, memory connections, API-key references, allowed models, cost-approval policy, and what is usable now (tools, media services, 3D). **The only gateway to paid generation and external publishing**; choosing a model from the allowed set belongs to the production skills | `.akari/connections.json` + a free, read-only doctor; `akari connect list` / `akari connect exec` |
| [verify](../skills/verify/SKILL.md) | The verification ladder (L0 / L1 / L2) required by task contracts | Build & tests of the current Theia stack |

## 3D comes in two paths

`author-scene3d` is one skill with two paths. The decision table — which path, and the conditions that justify a bake — is written once in [author-scene3d/SKILL.md](../skills/author-scene3d/SKILL.md). The [3D bake recipe contract](./contract-2026-07-14-3d-bake-recipe.md) (Japanese) remains the canonical spec for the bake path.

| Path | Purpose | Runtime | Leaf |
|---|---|---|---|
| Live 3D (**default**) | 3D in general — composites transparently, can play video on a screen, animates via clips baked into the glb | Transparent canvas + declarative JSON + bundled Three.js | [live.md](../skills/author-scene3d/live.md) |
| Blender bake (exception) | Looks live 3D cannot produce, cutting the simultaneous scene count, delivering a reusable library clip | None (the baked mp4 is ordinary footage) | [bake.md](../skills/author-scene3d/bake.md) |

Why the bake path uses Blender (from the contract):

1. The baked mp4 passes through preview / export as ordinary footage with zero engine changes. The video itself is the truth, so WYSIWYG holds structurally
2. No 3D authoring feature inside the editor (no home-grown mini-DCC). Authoring lives in bpy scripts, which agents write
3. The recipe (scene.py + params) is the SSOT; the bake output is a regenerable cache — the same determinism discipline as edit.json

## Supported animation runtimes

Motion parts (HTML assets) have two design gates:

- **No arbitrary JavaScript execution** (a trusted runtime reads non-executable declarations)
- **Deterministic seek** — seeking to the same timeline time reproduces the same picture (no wall-clock; time is injected externally via `currentTime`)

Only runtimes that pass both gates are on board.

| Runtime | Status | Shape |
|---|---|---|
| CSS keyframes | ✅ primary path | The runtime pauses animations and sets `currentTime = localTime * 1000` |
| Web Animations API (WAAPI) | ✅ primary path | Same, via `getAnimations()` |
| Three.js + glTF | ✅ declarative only | Non-executable `<script type="application/json">` declaration + bundled pinned runtime. No arbitrary JS in fragments |
| Glass refraction | ✅ declarative only | `data-akari-glass-scene` declaration + bundled runtime. The backdrop is a still image; it does not capture the video below ([glass.md](../skills/overlay-authoring/glass.md)) |
| WebGPU layer (vgpu) | ✅ declarative only | `data-akari-vgpu-scene` full-screen fragment passes, drawn at the injected time ([vgpu layer contract](./contract-2026-09-06-vgpu-layer-v0.md), Japanese) |
| Canvas 2D world | ✅ declarative only | `data-akari-world-scene` flat worlds with a pure `camera(t)`; used by [design-world](../skills/design-world/SKILL.md) ([world.md](../skills/overlay-authoring/world.md)) |
| Blender | ✅ (bake, not a runtime) | Baked into mp4 and brought in as ordinary footage (author-scene3d bake path) |
| Lottie / Anime.js / GSAP / TypeGPU / others | ❌ not supported | No generic JS seek hook yet. Any addition is expected to follow the "declarative + trusted runtime" shape (same as the Three.js motion part; procedure in the overlay-runtime package README) |

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

<!-- BEGIN GENERATED facts:stamp -->
This page describes AKARI Video v1.5.1 (released 2026-10-19).
<!-- END GENERATED facts:stamp -->
