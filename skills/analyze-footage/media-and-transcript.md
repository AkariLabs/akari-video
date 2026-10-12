# L0/L1 media inspection and transcription

## Authoritative contract

The [`akari media` inspection contract v0 §1–§4](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-29-media-inspect-cli-v0.md) governs invocation, stdout, output artifacts, ledger updates, and analysis levels. In brief: **observe through `akari media`, make judgments in this skill, and append results to the project's analysis.json**.

## L0: probe

```bash
akari media probe "$SOURCE"
```

Read `duration_s`, `video`, and `audio` from stdout JSON. Do not assume the input is decodable: require exit 0 and a finite, positive duration. Within a project, the call automatically updates `probe` and `observations[]`.

- If audio is `null`, L1 can be skipped.
- If video is `null`, visual inspection at L2 is impossible. Finalize from L0 and audio-only L1 evidence, or report that the request cannot be met.
- Keep progress and warnings on stderr; never mix them into stdout JSON.

## L1: Inspect the waveform first

For footage with audio, run this before transcription.

```bash
akari media waveform "$SOURCE"
```

Set `--silence-db` or `--min-silence` only when the default threshold must change, and report both the value and reason. `silences` uses source seconds. `speech_likely` is only a coarse gate for deciding whether to transcribe; it is not evidence of spoken content or suitable subtitle text.

- `speech_likely: false`: Unless explicitly requested, do not transcribe; finish L1 with `transcript: []`.
- `speech_likely: true`: Continue to transcription.

## L1: Transcribe only when speech is likely

```bash
akari media transcribe "$SOURCE"
```

If only a selected window is needed, limit the call with source-second bounds instead of transcribing the full file.

```bash
akari media transcribe "$SOURCE" --in 120 --out 180 --lang ja
```

Pass --lang for the work's content language on every transcription call. SpeechAnalyzer receives a matching locale when supported; otherwise the local backend may fall back to whisper.cpp. The command above is a Japanese-language example. Read the relevant language pack for transcription and filler guidance.

The [`akari media` contract §2.5](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-29-media-inspect-cli-v0.md) defines the three-layer backend choice, caching, `segments[]` format, no-speech result, and error handling. This skill does not discover backend executables or models or convert input audio itself.

### Separate speakers (only when requested or multiple voices are likely)

Never read or upload `.akari/sidecars/**/voices.json`; its voice embeddings are biometric identifiers.

Transcribe without speaker flags by default. Ask about separation only when requested or when a conversation, interview, or exchange suggests at least two voices. Do not ask for single-person narration. Ask only for a speaker count (or `auto` if unknown), then pass `--diarize --speakers <n|auto>`.

Intel Macs can separate speakers but cannot identify voices. If `--identify` is requested there, use the separated result and skip identification.

```bash
akari media transcribe "$SOURCE" --diarize --speakers 2
akari media transcribe "$SOURCE" --diarize --speakers auto --identify
akari speakers set "$SOURCE" A --person channel/p-123
akari speakers list "$SOURCE"
```

With `--identify`, compare only against consented (`self` or `subject`) voice samples for channel people. The result is a suggestion; a person decides the name. Confirm even a `strong` match before writing it with `akari speakers set`. Show `maybe` as a candidate for review and leave `none` unnamed. If the voice engine is missing and the command exits 2, do not guess speakers. Stop and guide the user to `akari tools install voice` or preparation in the app's caption creation flow. Follow the [speaker separation contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-10-11-speaker-split-v0.md) for flags, output, and destinations.


### Cloud use requires approval

- Do not upload audio by default.
- Consider only connections in `.akari/connections.json` whose doctor status is `ok`.
- Use `--backend cloud:<connection-id>` only after a person explicitly approves the decision card.
- Access keys only through `credentials.env`; never print values to stdout, stderr, artifacts, or chat.
- An unavailable local result does not authorize switching to cloud.

### Handle the result

- `segments[]` has the same shape as analysis.json `transcript[]`, with source-second times. Within a project, only the requested range is updated automatically.
- `no_speech: true` with `segments: []` is a successful observation. Do not infer words.
- On exit 1, leave `transcript: []`; report the stderr reason and attempted range rather than guessing.
- Record the backend from stdout and `observations[]` as provenance. Do not add out-of-schema fields to transcript segments.
- A cache hit is still a valid observation. Do not transcribe identical audio content again by another route.

### Check transcript quality

Validate `segments[]`: times must fall within the source duration, each segment must satisfy `end > start`, segments must be ordered, and word intervals must stay inside their parent segment. For suspicious content, compare the waveform and neighboring transcript; if L2 was already done, compare viewed images as well.

- Stock or short phrases that contradict speech activity on the waveform.
- Unnatural repetition of the same sentence.
- Words inconsistent with the source language, topic, or surrounding speech.
- A claim directly contradicted by visible facts in an already viewed image.

Exclude segments contradicted by evidence; if every segment is excluded, use `transcript: []`. Report each exclusion, time, and reason without adding schema fields. If L2 has not been performed, do not expand scope solely to check images; hold or exclude a segment based on the evidence already available.

## 720p handling in L2

Inspect the original file at L0 and L1; do not create `proxy.mp4`. For individual L2 images, `akari media grab --separate` returns a 720p-high PNG at each requested time. Create a persistent 720p proxy only if a later stage explicitly requires one, keep it untrimmed so source times match, and treat it as an L2 intermediate. Do not call the media backend directly from this skill.

## Common mistakes

- Transcribing the full source before waveform inspection.
- Treating `speech_likely` as evidence for spoken words or subtitles.
- Creating a video proxy solely for L1.
- Applying a custom transformation to raw backend output instead of using the contracted `segments[]`.
- Uploading audio merely because a cloud connection is registered, without approval.
- Inventing a transcript to conceal an unavailable backend.
- Asking about speaker separation for single-person narration.
- Writing proposed speaker names to the speaker dictionary before review.
