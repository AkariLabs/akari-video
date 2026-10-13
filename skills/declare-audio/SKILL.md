---
name: declare-audio
description: Mark a track's chorus, accent hits, beat, BPM, and first downbeat by listening in the browser timeline, then save declarations.json for BGM suggestions and beat-synced editing. Use when a user wants to mark a song's chorus, improve BGM suggestions, cut to the beat, or create declarations. Use setup-audio-library to add tracks.
---

# FORBIDDEN-level hard rules

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

The library normally lives at `library/` in the workspace, or `~/.akari/assets/` when no workspace is available. Confirm its actual location from the first line of `akari-assets list` or `akari assets list`. In this guide, `<ライブラリの置き場>` means that displayed location; audio files are under `audio/`.

Never proceed with declaring in a way that violates any of these rules. They always take precedence over the detailed leaves.

1. **Never mark a declaration on the person's behalf.** The person decides by listening; the agent only opens the timeline, explains the controls, and verifies what was saved. Never let the automatic BPM estimate be saved as-is as a confirmed declaration; it is only a starting point. **Always tell the person to turn on the click sound and check the beat by ear** before describing BPM or the first downbeat as confirmed.
2. **Never present an estimate as a measurement.** Automatic tempo estimates are off by ±1–2 BPM, particularly with weak beats or tempo drift in AI-generated songs. Reports must distinguish estimated values from values the person verified by ear.
3. **Keep audio and declarations in the user's library.** Do not commit either to this repository. The default destination is `<ライブラリの置き場>/audio/`.
4. **Never silently replace a declaration from another source, such as a purchased declaration pack.** If the existing `source` differs from `declare-audio`, show the Japanese UI badge `パック由来` ("from a pack") and tell the person before saving. The server records the former source in `replaced_source`.
5. **Never write `declarations.json` manually.** Save through the validating server so bad sections or labels cannot break later suggestions.
6. **Bind the server only to `127.0.0.1`.** Do not expose it externally.
7. **Read the saved file before reporting success.** Check the declaration count and contents in `declarations.json`; a UI success message alone is insufficient.

# Execution order and leaf files

1. [launch.md](launch.md): Start the browser timeline, present its URL, and explain the essential controls.
2. [what-to-declare.md](what-to-declare.md): Guide the person through the chorus, a few accent pins, and the quality criteria.
3. [after-save.md](after-save.md): Verify the saved declaration and its effect on BGM suggestions.

Read the leaf for the current step only.

## When to use this skill

| Situation | Use |
|---|---|
| Mark the chorus of a track so BGM suggestions can cue it | This skill |
| Add tracks to the audio library, through a bulk download of the official library or external supplements | [setup-audio-library](../setup-audio-library/SKILL.md) |
| Obtain an ear-verified AKARI Sounds declaration without marking it yourself | An AKARI Store declaration pack, purchased once per version of its ear-verified data; installation is only placing the zip's `declarations.json` under `<ライブラリの置き場>/audio/` |
| Select BGM using existing declarations, rather than marking new ones | `packages/audio-library-setup/bin/suggest-bgm.mjs` or [edit-plan](../edit-plan/SKILL.md) |

## Declaration format and storage

The server saves **`<ライブラリ>/declarations.json`** (normally `<ライブラリの置き場>/audio/declarations.json`). `suggest-bgm` discovers that path by default. The top-level key is the track id.

```json
{
  "bgm-lofi-085-001": {
    "bpm": 86.1,
    "beat_offset_s": 0.743,
    "time_signature": "4/4",
    "sections": [
      { "label": "intro", "start_sec": 0, "end_sec": 11.2 },
      { "label": "drop", "start_sec": 11.2, "end_sec": 44.8 }
    ],
    "hit_points": [11.2, 33.6],
    "note": "",
    "verified_at": "2026-08-04T01:23:45.000Z",
    "source": "declare-audio"
  }
}
```

- `label` accepts exactly six values: `intro`, `build`, `drop`, `outro`, `bridge`, and `break`. In that order, the UI labels are `前奏・導入` (prelude/introduction), `盛り上げ` (build), `サビ・見せ場` (chorus/highlight), `後奏・締め` (outro/close), `間奏` (interlude), and `静寂` (silence). Map these to the fixed values; never invent labels.
- The first `drop` section's `start_sec` is the chorus cue and appears in suggestions as a value you can write directly to `audio.bgm.in` in `edit.json`.
- `hit_points` contains source seconds for accents worth matching with a cut or visual change. A few well-chosen points are enough.

## References

- Contract: [`docs/contract-2026-07-14-edit-json-v1-audio.md`](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-14-edit-json-v1-audio.md); `audio.bgm.in` is the start offset within the BGM file.
- Server: `packages/audio-library-setup/declare-server.mjs`, `declare-template.html`, and `bin/declare-helper.mjs`. It binds locally, has no external npm dependency, and writes state atomically like `gallery-server.mjs`.
- Consumer: `bin/suggest-bgm.mjs`, which uses declared BPM, priority, and chorus cue.
