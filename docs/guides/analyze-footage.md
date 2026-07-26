**English** | [日本語](./analyze-footage.ja.md)

# Analyze footage

The step that turns raw footage into something the agent can "read." It's the prerequisite
for editing planning.

## Analyzing one clip at a time — `analyze-footage`

**When to use it**: whenever you bring in new footage. As preprocessing for editing planning
(edit-plan).

**How to ask**: "Analyze this video" / "Ingest the footage I put in `assets/`"

**What it does**:

1. Generates a 720p proxy (preview always uses the proxy; export uses the original)
2. Transcription — chooses from three tiers depending on your environment:
   - macOS SpeechAnalyzer (local, fast)
   - whisper.cpp (local, free)
   - Cloud STT (requires connection setup; for when you need higher accuracy)
3. Keyframe extraction and agent visual review
4. Event extraction (scene changes, people, etc.)

**What gets generated**: `analysis.json` (a per-clip sidecar, under
`.akari/sidecars/<clip-relative-path>.analysis/`)

`analysis.json` is the "fact layer." It records only what was observed — interpretation and
editing judgment are kept separate, in the next stages (interpretation.json / edit.json).

## Cross-project analysis — `analyze-project`

**When to use it**: when you have multiple clips and want to grasp the big picture before
deciding on an editing direction.

**How to ask**: "Analyze the whole project" / "Cross-read the footage into a report"

**What it does**:

1. Cross-reads each clip's `analysis.json` together with the project context (`intake.json` /
   `edit.json` / files under `planning/`) — no re-watching, text reasoning only
2. Generates the interpretation layer `interpretation.json` (one file per project)
3. Renders a read-only **analysis report HTML**

**Open questions (`open_questions`)**: things that can't be decided from the footage alone
(e.g. "is this scene a keeper moment or a failed take?") stay in the report as
`open_questions`. Answering them in chat updates the interpretation. This exists as a
discipline against fabricating editorial judgment when primary information is missing.

## Reading the analysis report

The report is the primary evidence for "approving the editing direction." Once you review it
here and give the direction the OK, you move on to editing planning (edit-plan).

## Next steps

- Set a direction and edit → [Plan your edit](./plan-your-edit.md)
- Set up cloud transcription → [Connections & API keys](../how-to/connections.md)
