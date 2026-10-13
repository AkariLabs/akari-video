---
name: beat-sync-edit
description: Generate a beat-synced video timeline and overlays from a track whose BPM, downbeat, accents, and sections have been declared. Use for music-driven promos, highlights, showcases, beat-aligned cuts, or audio-reactive motion. Use declare-audio to mark a track first, and edit-plan to plan from scratch without media.
---

# FORBIDDEN-level hard rules

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

Never proceed in a way that violates any of the following. These rules always take precedence over the detailed leaves.

Do not read all of `edit.json` or `captions.json`; grep by id and read only the matching lines, as described in [How to read edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md). Write through the Edit operation or edit-store script API; this skill uses the generator for that work.

1. **Never enter times by hand.** Calculate every cut, overlay, and SFX time from the beat positions derived from the declaration's BPM, downbeat, accent hits, or sections. A hand-entered time such as "about 12 seconds" immediately falls out of sync with the music.
2. **Never edit `edit.json` by hand.** The generator (`gen-timeline.mjs`) is the sole assembler. Correct the generator and rerun it so the change survives regeneration.
3. **Start only with declared audio.** If `declarations.json` lacks BPM or `beat_offset_s`, use [declare-audio](../declare-audio/SKILL.md) so a person can verify the values by ear. Do not present automatic estimates as measured values.
4. **Never use a full render as the verification step.** Check visuals with a mini-project lasting only a few seconds ([verify-loop.md](verify-loop.md)). The difference between a 40-second iteration and a 40-minute iteration is a difference in quality.
5. **Verify the render artifact.** Never report completion from a log `PASS` alone; inspect the actual file in `exports/` with `ffprobe`.
6. **Never judge motion from a single still.** Capture at least three consecutive points—start, middle, and end—to verify the movement. Especially for 3D, never guess what the default pose means.

# Suitable use cases

| Suitable | Less suitable |
|---|---|
| Music determines the duration and drives a promo, showcase, or highlight reel | Speech drives the piece; use [edit-plan](../edit-plan/SKILL.md) |
| Dozens or hundreds of coordinated visual changes | A few cuts can be positioned manually |
| The same composition may be regenerated for another track | A one-off edit will not be regenerated |

# Execution order

1. **Read the declaration.** Inspect BPM, `beat_offset_s`, `hit_points`, and `sections` in `declarations.json`. If any required value is missing, run [declare-audio](../declare-audio/SKILL.md) and wait for the person's declaration.
2. **Build a beat map.** Calculate the beat grid and per-beat intensity for audio-reactive motion. See [generator.md](generator.md) §1.
3. **Assign the structure.** Use the declared intro/build/drop/bridge/outro labels in `sections` as the structure, with the strongest passage at the drop. See [generator.md](generator.md) §2.
4. **Write the generator.** Generate overlay HTML and `edit.json` from the declarations. See [generator.md](generator.md) §3–§5.
5. **Lint.** Run `node packages/edit-lint/bin/edit-lint.mjs <project>` until it passes.
6. **Verify a short segment.** Render only the suspect fragment in a project lasting a few seconds, then inspect it visually. See [verify-loop.md](verify-loop.md).
7. **Render the full piece.** Wait for available machine capacity and use the extended timeout. See [verify-loop.md](verify-loop.md) §3.
8. **Inspect the export.** Check frames around each highlight, probe with `ffprobe`, and measure loudness. See [verify-loop.md](verify-loop.md) §4.
9. **Apply review changes.** Fix the generator, regenerate, and repeat the focused checks. See [verify-loop.md](verify-loop.md) §5.

# Why use a generator?

- **Timing stays aligned:** Every event is derived from the same beat grid. A hand-entered time makes that event drift; with a generator, drift cannot occur structurally.
- **Changes stay local:** Adjust a constant for text size or replace a sound reference in one place, then regenerate.
- **Tracks can be replaced:** New declarations rebuild the same design around a new beat grid.
- **The design is recorded:** The generator shows how the piece was assembled.

# Further instructions

- [generator.md](generator.md): beat map, section assignment, overlays, and audio-reactive motion.
- [verify-loop.md](verify-loop.md): short verification, render operation, acceptance, and review changes.
- [pitfalls.md](pitfalls.md): observed implementation and render pitfalls.

# Tools

| Tool | Purpose |
|---|---|
| [`templates/gen-timeline.mjs`](templates/gen-timeline.mjs) | Generator template to copy and adapt |
| `akari internal beat-sync-beatmap` | Convert declarations and audio into a beat grid, per-beat volume, and waveform envelope |
| `akari internal beat-sync-probe-frame` | Capture one frame from the render path at a chosen time |
| `akari internal beat-sync-render-when-idle` | Wait for the machine to become available before rendering |

Related skills: [overlay-authoring](../overlay-authoring/SKILL.md) for fragment authoring, [declare-audio](../declare-audio/SKILL.md) for declarations, and [render-cut](../render-cut/SKILL.md) for export.
