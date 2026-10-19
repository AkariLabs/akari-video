**English** | [日本語](./analyze-footage.ja.md)

# Analyze footage

The step that turns raw footage into something the agent can "read." It's the prerequisite
for editing planning.

## Analyzing one clip at a time — `analyze-footage`

**When to use it**: whenever you bring in new footage. As preprocessing for editing planning
(edit-plan).

**How to ask**: "Analyze this video" / "Ingest the footage I put in `assets/`"

**What it does**: it observes only as deep as needed, in levels L0 to L3. The default is L0 + L1.
It adds L2 and L3 only when you ask, or when a later step needs that observation.

| Level | What it does |
|---|---|
| **L0 metadata** | `akari media probe` confirms the duration and which video and audio streams exist |
| **L1 audio** | A waveform pass (`waveform`) finds silences and whether speech is likely; it transcribes (`transcribe`) only when speech is likely |
| **L2 visuals** | The agent actually looks at a filmstrip (`filmstrip`) or stills (`grab`) and records keyframes and events (filler, trouble, chapter, highlight, hook) |
| **L3 people** | Only for the footage and range an effect needs, builds a person matte or face, hand, and body position data |

A 720p proxy is made only when L2 needs to look at the picture (preview always uses the proxy; export
uses the original). L0 and L1 read the original as is.

**What gets generated**: `analysis.json` (a per-clip sidecar, under
`.akari/sidecars/<clip-relative-path>.analysis/`)

`analysis.json` is the "fact layer." It records only what was observed — interpretation and
editing judgment are kept separate, in the next stages (interpretation.json / edit.json).
It never adds words to footage with no speech; the transcript stays empty and the reason is reported.

### Transcription engines

It chooses from three tiers depending on your environment.

- **SpeechAnalyzer** (macOS, local, fast) — the default. Used when it supports the language you specify
- **whisper.cpp** (local, free) — the fallback where SpeechAnalyzer is unavailable (such as Windows),
  doesn't support the language, or fails
- **Cloud STT** (requires connection setup) — for when you need higher accuracy. **Audio is not sent
  anywhere by default.** It is used only when the connection is healthy and a person explicitly approves
  it on a decision card. Local being unavailable is not a reason to switch

If the whisper.cpp model is missing, install it in one of these ways:

```sh
akari tools install whisper
```

Or install it from Settings → Tools → Whisper. You can also put a ggml model in `~/.akari/tools/models/`.

### Language

Transcription takes the language of the video's content (the content language), which is separate from
the language of the screen or the conversation. The language is decided in this order: `--lang` (for example
`akari media transcribe <clip> --lang en`) → `language` in `.akari/intake.json` → automatic detection.
The detected language is kept in `analysis.json` and is also used as the default for captions and narration
(`ja` if nothing is known). For English footage, specify English.

### Separating speakers

Speakers are not separated by default. Only for conversations, interviews, and other footage with two
or more voices, you give the number of people (`auto` if unknown) and it separates them.

```sh
akari media transcribe <clip> --diarize --speakers 2
```

The voice engine is prepared the first time (`akari tools install voice`, or from "Make captions" in the app).
Name suggestions (`--identify`) appear for channel people who have a voice sample from themselves or from
someone who consented. Suggestions are only proposals; a person decides the name. Voice features
(`voices.json`) can identify a person, so they are never read out or sent externally.

### Person matte and vision tracks (L3)

Only when you use a cutout effect such as text behind a person, it builds a **person matte** for that clip.
It involves encoding video, so it takes time (roughly several times the clip's length). It is not built just
because a face appears.

Only when you choose an effect that uses eye positions, fingertips, or body joints (eye bar, finger frame,
pose skeleton, and so on), it builds **vision tracks** (face, hands, and 3D body pose). You can request only the
kinds you need, and 3D body pose is especially slow. In an environment without the needed tools, it does not
build them and records the reason.

## Cross-project analysis — `analyze-project`

**When to use it**: when you have multiple clips and want to grasp the big picture before
deciding on an editing direction.

**How to ask**: "Analyze the whole project" / "Cross-read the footage into a report"

**What it does**:

1. Cross-reads each clip's `analysis.json` together with the project context (`intake.json` /
   `edit.json` / files under `planning/`) — no re-watching, text reasoning only. It runs analyze-footage
   only for clips that are missing
2. Generates the interpretation layer `interpretation.json` (one file per project)
3. Renders a read-only **analysis report HTML**

Right after footage arrives, it may suggest up to three Playbooks that fit the observed length,
orientation, speakers, and kinds of media, each with a reason. Nothing is applied until you choose one.

**Open questions (`open_questions`)**: things that can't be decided from the footage alone
(e.g. "is this scene a keeper moment or a failed take?") stay in the report as
`open_questions`. Answering them in chat updates the interpretation. This exists as a
discipline against fabricating editorial judgment when primary information is missing.

## Reading the analysis report

The report is read-only; it has no choices or buttons to decide with. The editing direction is worked out
in chat, using this report as the primary evidence. In "Create together", the editing plan (edit-plan) moves
to execution only after you explicitly approve the direction. In "With suggestions" and "Fully automatic", it
can also proceed from `analysis.json` alone without reading the report.

## Next steps

- Set a direction and edit → [Plan your edit](./plan-your-edit.md)
- Set up cloud transcription → [Connections & API keys](../how-to/connections.md)

<!-- BEGIN GENERATED facts:stamp -->
This page describes AKARI Video v1.5.1 (released 2026-10-19).
<!-- END GENERATED facts:stamp -->
