**English** | [日本語](./declare-audio.ja.md)

# Declare your audio (chorus, hits, beats)

Teach AKARI Video where the chorus, the hits, and the beats of your music are — by
ear. The skill is `declare-audio`; the result is a `declarations.json` sidecar next
to the audio file in your library (default `~/.akari/assets/audio/`).

## When to use it

- "The BGM suggestions feel off" — declared tracks are suggested with a measured BPM
  and a chorus cue-in (`audio.bgm.in`)
- Before a beat-synced edit — [beat-sync-edit](./beat-sync.md) refuses to start
  without declarations
- "I want to tell it where the chorus is" / "I want to cut on the beat"

## How it works

1. Ask: "I want to declare this track." The agent starts a local, browser-based
   timeline UI (bound to `127.0.0.1` only)
2. You pin the chorus sections and the hits on the waveform, and confirm the BPM and
   the first beat. Automatic BPM estimation is only a starting point — the skill
   always walks you through an ear check against a click track
3. Saving goes through the server (with validation) into `declarations.json`. What
   downstream skills read is the declarations, never the audio itself

The declarations are made by a human on purpose: the skill's hard rules forbid the
agent from saving an automatic estimate as a confirmed declaration.

## Next steps

- Make a video that moves with the music → [Beat-synced edits](./beat-sync.md)
- Grow the audio library itself → [Grow the asset library](./asset-library.md)
- Canonical procedure → [skills/declare-audio/SKILL.md](../../skills/declare-audio/SKILL.md) (Japanese)
