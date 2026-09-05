**English** | [日本語](./README.ja.md)

# AKARI Video Documentation

**Hand over your footage and it comes back edited. Open it, review it, fix only what matters.**

- First time here → [Introduction](./introduction.md) (philosophy and the big picture) →
  [Getting Started](./getting-started.md) (your first project)
- Have a task in mind → [Guides](#guides)
- Wondering which skill does what → [Skills Catalog](./skills.md)
- Want to know how things work → [How-to](#how-to)
- Looking for schemas and contracts → [Reference](#reference)

## Getting Started

| Page | Contents |
|---|---|
| [Introduction](./introduction.md) | What AKARI Video is — three principles, architecture at a glance, workflow |
| [Getting Started](./getting-started.md) | Three entrances, creating your first project, the intake form |

## Guides

Task-based guides, ordered by the flow of production.

| Page | Contents |
|---|---|
| [Plan from scratch](./guides/plan-from-scratch.md) | Ideas → research → brief → storyboard → shot list (research-plan) |
| [Analyze footage](./guides/analyze-footage.md) | Proxies, transcription, keyframe extraction, and cross-clip analysis (analyze-footage / analyze-project) |
| [Plan your edit](./guides/plan-your-edit.md) | Three approval steps into edit.json (edit-plan) |
| [Overlays and captions](./guides/overlays-and-captions.md) | AI-drawn expression and "touchable overlays" (overlay-authoring) |
| [Narration](./guides/narration.md) | Free local voices / voice cloning (generate-narration) |
| [Review and fix](./guides/review-and-fix.md) | Machine checks, ticketing spoken reviews, fixes (edit-lint / compile-review-session / address-review) |
| [Export](./guides/export.md) | Plan → approval → render → verify (render-cut) |
| [Grow the asset library](./guides/asset-library.md) | Setup, audio sources, harvesting deliverables (setup-library / setup-audio-library / harvest-asset) |
| [Bake 3D scenes](./guides/bake-3d.md) | Blender headless recipes into video assets (bake-3d) |
| [Declare your audio](./guides/declare-audio.md) | Pinning chorus / hits / beats on your music by ear → declarations.json (declare-audio) |
| [Beat-synced edits](./guides/beat-sync.md) | Beat-snapped PVs and showcases machine-generated from declared audio (beat-sync-edit) |
| [How the agent reads edit.json](./guides/edit-json-access.md) | Read by id without loading the whole file; write point edits or edit-store scripts |

## Skills

The workflow ships as 23 agent-side skills. The [Skills Catalog](./skills.md) is the
single map: what each skill owns, when it triggers, and which external tools and
animation runtimes it connects to — including the two 3D paths.

## How-to

| Page | Contents |
|---|---|
| [Connections & API keys](./how-to/connections.md) | Connection registry, doctor diagnostics, cost-approval policy (manage-connections) |
| [Shell UI: assets & timeline](./how-to/shell-ui.md) | Right-click menus on asset cards and timeline clips, drag & drop onto the timeline, show in Finder |
| [Project structure](./how-to/project-structure.md) | What each file under `.akari/` does and what is safe to delete |
| [Resume a session](./how-to/resume-session.md) | How `.akari/events/` and the SessionStart hook work |
| [FAQ & troubleshooting](./how-to/faq.md) | Common questions and error handling |

## Reference

Data contracts (schemas) and design documents. **This repository is the canonical source.**
All contracts follow the
[three versioning principles](./contract-2026-07-17-data-contract-versioning.md)
(mandatory version field, additive-only evolution, explicit migration).

> [!NOTE]
> Reference documents are currently Japanese-only. Open an issue if you need a
> specific contract in English.

### Design & cross-cutting conventions

| File | Contents |
|---|---|
| [design-2026-07-13-agent-native-architecture.md](./design-2026-07-13-agent-native-architecture.md) | The canonical agent-native architecture rationale (three-layer sandwich, editing model, MVP milestones) |
| [contract-2026-07-17-data-contract-versioning.md](./contract-2026-07-17-data-contract-versioning.md) | Versioning and migration principles for data contracts (cross-cutting) |
| [contract-2026-07-25-project-structure-v0.md](./contract-2026-07-25-project-structure-v0.md) | Where generated artifacts live (layer definitions, root-level principle, deletion safety) |
| [contract-2026-08-02-creator-root-v1.md](./contract-2026-08-02-creator-root-v1.md) | The workspace (CreatorRoot) contract — the layer above projects. Three locations, four ownership layers, first-run flow, portability |
| [contract-2026-08-02-setup-remote-v0.md](./contract-2026-08-02-setup-remote-v0.md) | setup-remote skill contract v0 — remote viewing/approval and footage hand-off (Tailscale / Taildrop, tailnet-only by default) |
| [contract-2026-08-12-chat-approval-v0.md](./contract-2026-08-12-chat-approval-v0.md) | chat-approval contract v0 — approval-gate notification and button-only approval over chat (Telegram, long polling, no public endpoint, no free-text instructions) |
| [contract-2026-08-03-status-integrity-v1.md](./contract-2026-08-03-status-integrity-v1.md) | Canonical status, immutable render receipts, human acceptance records, and capability absence receipts |
| [contract-2026-08-03-caption-display-encoding-qc-v1.md](./contract-2026-08-03-caption-display-encoding-qc-v1.md) | Shared caption display/layout, master encoding, audio QC evidence, and recipe boundaries |

### edit.json (the editing save file)

| File | Contents |
|---|---|
| [contract-2026-07-13-m1-m4.md](./contract-2026-07-13-m1-m4.md) | The settled edit.json schema v0 contract |
| [contract-2026-07-18-edit-json-v1-sources.md](./contract-2026-07-18-edit-json-v1-sources.md) | v1 sources (multiple clips; the iron rule of persisting (src, source seconds)) |
| [contract-2026-07-14-edit-json-v1-crop.md](./contract-2026-07-14-edit-json-v1-crop.md) | v1 crop (reframing) — **superseded** by `cuts[].framing.crop` (see [contract-2026-07-22-render-basics.md](./contract-2026-07-22-render-basics.md) #6) |
| [contract-2026-07-14-edit-json-v1-audio.md](./contract-2026-07-14-edit-json-v1-audio.md) | v1 audio (BGM / SFX) |
| [contract-2026-07-20-edit-json-v1-narration.md](./contract-2026-07-20-edit-json-v1-narration.md) | v1 narration |
| [contract-2026-07-22-edit-json-v1-beats.md](./contract-2026-07-22-edit-json-v1-beats.md) | v1 beats (music sync) |
| [contract-2026-07-23-edit-json-v1-direction.md](./contract-2026-07-23-edit-json-v1-direction.md) | v1 direction |
| [contract-2026-07-23-edit-json-v1-emphasis-words.md](./contract-2026-07-23-edit-json-v1-emphasis-words.md) | v1 emphasis words |
| [contract-2026-08-23-captions-emphasis-words-v0.md](./contract-2026-08-23-captions-emphasis-words-v0.md) | `emphasis_words[]` seat for word-level emphasis in the captions.json object root, with the edit.json v1 seat retained as a backward-compatible fallback |
| [contract-2026-09-02-captions-style-preset-v0.md](./contract-2026-09-02-captions-style-preset-v0.md) | `captions[].style_preset` id reference, resolution order, generated textstyle catalog, picker batch-apply RPC, row badges, and the three free caption presets (Japanese) |
| [contract-2026-07-22-render-basics.md](./contract-2026-07-22-render-basics.md) | Render basics (speed, chroma key, transitions, LUT, audio mastering) |
| [contract-2026-08-12-still-image-cut-source-v0.md](./contract-2026-08-12-still-image-cut-source-v0.md) | Still-image cut source v0 — allow still images (extension-based detection) as cuts[] sources, extending speed/freeze coverage |
| [contract-2026-07-25-r6-audio-tracks-and-trim.md](./contract-2026-07-25-r6-audio-tracks-and-trim.md) | Timeline placement principles, multiple audio tracks, audio trim, source trimmer |
| [contract-2026-08-05-fx-v0.md](./contract-2026-08-05-fx-v0.md) | Screen-FX small vocabulary v0 — **retired 2026-08-11** (see the notice at the top of the doc); `presets/fx/` remains as an empty registry |
| [contract-2026-08-12-region-filter-layer-v0.md](./contract-2026-08-12-region-filter-layer-v0.md) | kind:"filter" layers — region (perspective corners) confined look switch (invert / lut / saturation), no extra `-i` input |
| [contract-2026-08-12-color-range-normalization-v0.md](./contract-2026-08-12-color-range-normalization-v0.md) | Normalize full-range (pc) H.264 input to limited range (tv) output — pixel value conversion (scale=out_range=tv) paired with metadata tagging (-color_range tv) across every encode stage; adds verify.color-range |

### Analysis, plan, review

| File | Contents |
|---|---|
| [contract-2026-07-13-m5-analysis-report.md](./contract-2026-07-13-m5-analysis-report.md) | Analysis pipeline (analysis.json) + editorial-judgment report |
| [contract-2026-07-23-analysis-person-matte.md](./contract-2026-07-23-analysis-person-matte.md) | Person matte extraction (foundation for text-behind-person) |
| [contract-2026-08-11-analysis-vision-tracks-v0.md](./contract-2026-08-11-analysis-vision-tracks-v0.md) | Vision landmark tracks v0 (face-landmarks / hand-pose) — track data contract, sidecar I/O, consumption via `layers[].keyframes` |
| [contract-2026-07-20-plan-json-v0.md](./contract-2026-07-20-plan-json-v0.md) | plan.json v0 (provisional timeline; slot sequence with confidence levels) |
| [contract-2026-07-25-plan-comments-v0.md](./contract-2026-07-25-plan-comments-v0.md) | plan-comments.json v0 (structured push-back on the approvable plan layer) |
| [contract-2026-07-20-review-json-v1-annotation-model.md](./contract-2026-07-20-review-json-v1-annotation-model.md) | review.json v1 annotation model (five target types) |
| [contract-2026-08-11-review-session-ui-events.md](./contract-2026-08-11-review-session-ui-events.md) | Review-session UI events (events.jsonl extension) + recording indicator |
| [contract-2026-08-23-stroke-persistence.md](./contract-2026-08-23-stroke-persistence.md) | Persistent annotation strokes (lasting overlay + toggle + session replay + `strokeRefs` in review.json) |
| [contract-2026-08-03-cut-candidate-bridge-v1.md](./contract-2026-08-03-cut-candidate-bridge-v1.md) | Review-only semantic event and A4 pause-shortening candidate bridge |

### Preview & export

| File | Contents |
|---|---|
| [contract-2026-08-02-preview-parity.md](./contract-2026-08-02-preview-parity.md) | Engine v2 parity — one `T → frame` evaluator, two preview containers, one OSR exit, and a single golden-frame acceptance suite (Japanese) |
| [contract-2026-09-03-preview-playback-rate-v1.md](./contract-2026-09-03-preview-playback-rate-v1.md) | Preview playback rate v1 — 0.5×–3× transport presets, widget-lifetime state, output-timeline clock semantics, and pitch preservation across frame-engine and legacy audio paths (Japanese) |
| [contract-2026-09-03-clip-adjust-v0.md](./contract-2026-09-03-clip-adjust-v0.md) | Clip adjust v0 — per-item basic correction, LUT references, and section bypass (Japanese) |
| [contract-2026-09-05-clip-adjust-v1.md](./contract-2026-09-05-clip-adjust-v1.md) | Clip adjust v1 — RGB curves, CDL wheels, hue curves, and fixed bake order (Japanese) |
| [contract-2026-08-01-export-nle-beta.md](./contract-2026-08-01-export-nle-beta.md) | export-nle: one-way export to other NLEs (FCPXML / FCP7 XML / SRT) — **BETA, untested against real NLEs** |
| [contract-2026-08-28-osr-export-v0.md](./contract-2026-08-28-osr-export-v0.md) | Whole-page Electron OSR export v0 — page layers, seek/paint verification handshake, launcher fallback, and memory limits (Japanese) |
| [contract-2026-08-28-gpu-export-v0.md](./contract-2026-08-28-gpu-export-v0.md) | GPU-direct export v0 — eligibility, zero-readback WebCodecs path, incremental MP4 mux (moov reserved up front, no temp file, no ffmpeg process), fallback, and determinism gates (Japanese) |
| [contract-2026-08-28-v2-approximation-ledger.md](./contract-2026-08-28-v2-approximation-ledger.md) | Engine v2 approximation ledger — resolved items with golden or measured evidence, retained approximations, and separately tracked work (Japanese) |

### Assets & personal layer

| File | Contents |
|---|---|
| [contract-2026-07-13-asset-library.md](./contract-2026-07-13-asset-library.md) | Asset library contract (meta.json, intake criteria, scope hierarchy) |
| [contract-2026-07-14-3d-bake-recipe.md](./contract-2026-07-14-3d-bake-recipe.md) | 3D bake recipe contract (Blender path) |
| [contract-2026-07-25-recipe-v0.md](./contract-2026-07-25-recipe-v0.md) | recipe.json v0 (freezing and presenting confirmed preferences) |
| [contract-2026-07-25-memory-connection-v0.md](./contract-2026-07-25-memory-connection-v0.md) | memory connection v0 (declaring external reference-memory connections in connections.json) |
| [contract-2026-07-26-avatar-registry-v0.md](./contract-2026-07-26-avatar-registry-v0.md) | Avatar registry v0 (avatar.json / rendition.json / staged read-out) |
| [contract-2026-08-13-avatar-drive-v0.md](./contract-2026-08-13-avatar-drive-v0.md) | 2D avatar sprite drive v0 (audio-envelope mouth states / deterministic blinking / baked alpha clip) |
| [contract-2026-08-14-avatar-vrm-v0.md](./contract-2026-08-14-avatar-vrm-v0.md) | VRM avatar backend v0 (VRM 0.x/1.0 expressions / headless baked alpha clip) (Japanese) |
| [contract-2026-08-18-v1-render-parity.md](./contract-2026-08-18-v1-render-parity.md) | v1 render path parity — cuts[].at explicit placement (gaps) and cuts[].track compositing on the sources[] path (Japanese) |
| [contract-2026-08-28-v2-audio-roles-v0.md](./contract-2026-08-28-v2-audio-roles-v0.md) | v2 audio roles v0 — Web Audio supplies the frame-engine preview (bgm / narration / sfx, kernel ducking, AudioContext clock as master); ffmpeg mastering stays the export truth; measured preview-vs-export deltas and the items to settle before the default switch |
| [contract-2026-08-29-media-inspect-cli-v0.md](./contract-2026-08-29-media-inspect-cli-v0.md) | `akari media` observation commands v0 — probe / grab / filmstrip / waveform / transcribe (pull-driven analysis: look when you want to, results stay on disk) |
| [contract-2026-08-29-capture-v0.md](./contract-2026-08-29-capture-v0.md) | `akari capture` v0 — render finished frames of the current edit.json without exporting |
| [contract-2026-08-30-edit-json-v2-object-tree-v0.md](./contract-2026-08-30-edit-json-v2-object-tree-v0.md) | edit.json v2 object tree v0 — recursive `items` (groups), bag groups (HTML parts / captions.json) projected by tags, part items (`source.part`), track invariants, canonical one-record-per-line serialization, edit-store script API, AI read rules (`version: 2` unchanged) |
| [contract-2026-09-02-item-caption-anchor-v0.md](./contract-2026-09-02-item-caption-anchor-v0.md) | edit.json v2 item caption anchors — source-second caption/range dependency, cached `at` / `duration`, parent-relative resolution, mutations, and lint rules |
| [contract-2026-08-30-motion-and-keyframes-v0.md](./contract-2026-08-30-motion-and-keyframes-v0.md) | Motion & keyframes v0 — four levels (L0 presets `motion` / L1 `keyframes` inline or `motion/<group-id>.json` bag / L2 range-selector `animator` / L3 code), easing vocabulary, "expand to keyframes", timeline / inspector display rules |
| [contract-2026-09-02-transcript-unrecognized-spans-v0.md](./contract-2026-09-02-transcript-unrecognized-spans-v0.md) | `unrecognized[]` spans for audio that could not be transcribed, carried from analysis.json into captions.json without changing `words[]` |
| [contract-2026-09-02-word-book-v0.md](./contract-2026-09-02-word-book-v0.md) | Word book v0 — vocabulary entries (`surface` / `variants` / `reading` / `kind`) layered project < channel < workspace < builtin, word-boundary STT post-pass that rewrites `text` and `words[]` together, `edited: true` untouched, soft supply into `protected_terms`, edit-lint rules (Japanese; draft, owner review) |
| [contract-2026-08-09-transform-keyframes-v0.md](./contract-2026-08-09-transform-keyframes-v0.md) | Transform keyframes v0 (restored 2026-08-30 from schema `$comment`s; superseded by motion-and-keyframes v0 §2) |
| [contract-2026-09-02-export-verify-declared-vs-measured-v0.md](./contract-2026-09-02-export-verify-declared-vs-measured-v0.md) | Post-export declared-vs-measured verification v0 — sampled audio level fails closed; static camera-work correlation warns (Japanese) |
| [contract-2026-09-02-audio-envelope-v1.md](./contract-2026-09-02-audio-envelope-v1.md) | Audio envelope kernel v1 — deterministic ducking (duck_db / attack / release, narration ∪ transcript speech keys, sidechaincompress retired for amultiply) and clip-owned volume keyframes shared by preview and export |
| [contract-2026-09-02-audio-insert-level-v1.md](./contract-2026-09-02-audio-insert-level-v1.md) | Insert-time auto level v1 — ebur128 measurement with sha1 cache, per-role LUFS targets with true-peak guard, `akari-media audio-level --write` writing gain_db / default fades deterministically |
| [contract-2026-09-02-audio-clip-fx-v1.md](./contract-2026-09-02-audio-clip-fx-v1.md) | Audio clip FX v1 — speed (rubberband, pitch-preserving), pitch_semitones, denoise (fft / nlm), lowcut_hz; preview matches export via the FLAC sidecar (recipe v2) |
| [contract-2026-09-02-asset-reference-model.md](./contract-2026-09-02-asset-reference-model.md) | Asset reference model v0 — machine-wide shared library (`~/.akari/assets`), the per-project reference ledger `.akari/asset-references.json`, resolver fallback in render-cut / edit-lint, and the `akari-assets bundle` materialization command (Japanese) |
| [contract-2026-09-02-shape-item-v0.md](./contract-2026-09-02-shape-item-v0.md) | Shape item v0 — edit.json v2 `shape` source (rect / rounded-rect / ellipse / line / arrow / speech-bubble) lowered by edit-store to a deterministic inline-SVG html overlay, so no renderer changes (Japanese) |

### Direction notes

Notes preserving the design background of settled contracts. New direction work is
managed in private internal records.

| File | Contents |
|---|---|
| [notes-2026-07-13-edit-json-v1.md](./notes-2026-07-13-edit-json-v1.md) | Direction for edit.json v1 extensions (early drafts of crop, layout, audio, thumbnail slots) |
| [notes-2026-07-14-captions-and-cut-editing.md](./notes-2026-07-14-captions-and-cut-editing.md) | Direction for captions and cut editing (word-accurate cuts, captions as first-class, karaoke display) |
| [notes-2026-07-16-qa-lint-and-transcript-ui.md](./notes-2026-07-16-qa-lint-and-transcript-ui.md) | Direction for the self-verification loop and transcript-editing UI (the prototype of edit-lint) |
| [notes-2026-08-28-engine-v2-open-items.md](./notes-2026-08-28-engine-v2-open-items.md) | Remaining engine v2 work — platform validation, deterministic seeking, OSR isolation, exact verification, and legacy retirement gates (Japanese) |
| [notes-2026-09-05-bake-layer-retired.md](./notes-2026-09-05-bake-layer-retired.md) | Retirement of bake-layer / ATF telop rasterization — what was removed, the `kind:"telop"` compatibility rules, and what stays out of scope (Japanese) |

## For developers

| Page | Contents |
|---|---|
| [dev/windows-build.md](./dev/windows-build.md) | Windows build checklist (Japanese) |

For contribution entry points, see the repository root [README](../README.md) and the
README of each package.
