**English** | [日本語](./beat-sync.ja.md)

# Beat-synced edits (PVs and showcases)

Make a video where the picture moves with the music: cuts, motion parts, and SFX all
snapped to the declared beats of a track. The skill is `edit-to-beat`.

## When it fits

| Good fit | Not a fit |
|---|---|
| The music leads and the length follows the track (PV / showcase / highlight) | Speech-led videos (→ [Plan your edit](./plan-your-edit.md)) |
| Dozens to hundreds of synchronized moves | A handful of cuts you could place by hand |

## How it works

1. Prerequisite: the track has declarations (BPM, first beat, hits, sections) made
   with [declare-audio](./declare-audio.md). The skill refuses to start without them
2. A generator script computes every cut, motion-part, and SFX time from the declared
   beat positions and machine-generates `edit.json` plus the set of motion parts (overlay fragments) — no
   hand-typed seconds anywhere
3. Fixes go into the generator, which is re-run; the edit is never patched by hand
   (a hand edit would be lost on the next regeneration)
4. Visual checks run on mini-projects (a few seconds) instead of full renders, so
   one check loop takes about 40 seconds instead of 40 minutes

## Next steps

- Declare a track first → [Declare your audio](./declare-audio.md)
- Export the finished edit → [Export](./export.md)
- Canonical procedure → [skills/edit-to-beat/SKILL.md](../../skills/edit-to-beat/SKILL.md)

<!-- BEGIN GENERATED facts:stamp -->
This page describes AKARI Video v1.5.1 (released 2026-10-19).
<!-- END GENERATED facts:stamp -->
