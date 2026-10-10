---
name: declare-audio
description: Mark a track's chorus, accent hits, beat, BPM, and first downbeat by listening in the browser timeline, then save declarations.json for BGM suggestions and beat-synced editing. Use when a user wants to mark a song's chorus, improve BGM suggestions, cut to the beat, or create declarations. Use setup-audio-library to add tracks.
---

# Non-negotiable rules

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

The library normally lives at `library/` in the workspace, or `~/.akari/assets/` when no workspace is available. Confirm its actual location from the first line of `akari-assets list` or `akari assets list`. In this guide, `<ライブラリの置き場>` means that displayed location; audio files are under `audio/`.

These rules take precedence over the detailed instructions.

1. **A person makes the declaration by listening.** The agent opens the timeline, explains the controls, and checks the saved result. An automatic BPM estimate is a starting point; guide the person to verify it by ear before calling it confirmed.
2. **Distinguish estimates from measurements.** Automatic tempo estimates may differ by 1–2 BPM, particularly with soft or variable beats. Reports must say whether a value is estimated or ear-verified.
3. **Keep audio and declarations in the user's library.** Do not commit either to this repository. The default destination is `<ライブラリの置き場>/audio/`.
4. **Warn before replacing an external declaration.** If the existing `source` differs from `declare-audio`, show the source badge and tell the person before saving. The server records the prior value in `replaced_source`.
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
| Add tracks to the audio library | [setup-audio-library](../setup-audio-library/SKILL.md) |
| Obtain an ear-verified AKARI Sounds declaration without marking it yourself | An AKARI Store declaration pack; install its `declarations.json` under `<ライブラリの置き場>/audio/` |
| Select BGM using existing declarations | `packages/audio-library-setup/bin/suggest-bgm.mjs` or [edit-plan](../edit-plan/SKILL.md) |

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

- `label` accepts exactly six values: `intro`, `build`, `drop`, `outro`, `bridge`, and `break`. The UI may use words such as prelude, introduction, build, chorus, highlight, postlude, close, interlude, or silence; map these to the fixed values rather than inventing labels.
- The first `drop` section's `start_sec` is the chorus cue. Suggest that source offset for `audio.bgm.in` in `edit.json`.
- `hit_points` contains source seconds for accents worth matching with a cut or visual change. A few well-chosen points are enough.

## References

- Contract: [`docs/contract-2026-07-14-edit-json-v1-audio.md`](../../docs/contract-2026-07-14-edit-json-v1-audio.md), including the meaning of `audio.bgm.in`.
- Server: `packages/audio-library-setup/declare-server.mjs`, `declare-template.html`, and `bin/declare-helper.mjs`. It binds locally, has no external npm dependency, and writes state atomically like `gallery-server.mjs`.
- Consumer: `bin/suggest-bgm.mjs`, which uses declared BPM, priority, and chorus cue.
