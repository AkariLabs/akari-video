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

## Skills

The workflow ships as 22 agent-side skills. The [Skills Catalog](./skills.md) is the
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
| [contract-2026-08-03-cut-candidate-bridge-v1.md](./contract-2026-08-03-cut-candidate-bridge-v1.md) | Review-only semantic event and A4 pause-shortening candidate bridge |

### Preview & export

| File | Contents |
|---|---|
| [contract-2026-08-02-preview-parity.md](./contract-2026-08-02-preview-parity.md) | Preview parity v0 — a single behavior spec for the Web UI and the shell (same edit.json / captions.json → same look, same behavior) |
| [contract-2026-08-01-export-nle-beta.md](./contract-2026-08-01-export-nle-beta.md) | export-nle: one-way export to other NLEs (FCPXML / FCP7 XML / SRT) — **BETA, untested against real NLEs** |

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

### Direction notes

Notes preserving the design background of settled contracts. New direction work is
managed in private internal records.

| File | Contents |
|---|---|
| [notes-2026-07-13-edit-json-v1.md](./notes-2026-07-13-edit-json-v1.md) | Direction for edit.json v1 extensions (early drafts of crop, layout, audio, thumbnail slots) |
| [notes-2026-07-14-captions-and-cut-editing.md](./notes-2026-07-14-captions-and-cut-editing.md) | Direction for captions and cut editing (word-accurate cuts, captions as first-class, karaoke display) |
| [notes-2026-07-16-qa-lint-and-transcript-ui.md](./notes-2026-07-16-qa-lint-and-transcript-ui.md) | Direction for the self-verification loop and transcript-editing UI (the prototype of edit-lint) |

## For developers

| Page | Contents |
|---|---|
| [dev/windows-build.md](./dev/windows-build.md) | Windows build checklist (Japanese) |

For contribution entry points, see the repository root [README](../README.md) and the
README of each package.
