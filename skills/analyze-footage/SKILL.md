---
name: analyze-footage
description: Analyze one footage file in pull-driven levels L0–L3 and record only observed evidence in analysis.json v0. By default, run L0 metadata and L1 audio (`akari media probe` → `waveform` → `transcribe` only when speech is likely); cloud transcription requires approval. Inspect keyframes, editing events, and hooks at L2, or person tracks at L3, only when requested. Use for new footage, pre-edit analysis of one file, or footage analysis needed before plan-edit.
---

# Analyze one footage file

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

Read lang/<content-language>.md for language-specific rules (content language: --lang → intake.json "language" → transcript language → ja; see https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-10-11-content-language.md). If that file does not exist, read lang/en.md.

## Analysis levels

The authoritative source for terminology, inputs, outputs, and ledger updates is [`akari media` Observation Command Contract v0 §3 / §4](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-29-media-inspect-cli-v0.md). Use `akari media` to observe the source. This skill interprets and scores evidence, then records only observed results.

| Level | One-line summary |
|---|---|
| **L0 metadata** | Use `probe` to confirm duration and available video and audio streams. |
| **L1 audio** | Run `waveform` first; run `transcribe` only when `speech_likely` is true. |
| **L2 visuals** | Visually inspect `filmstrip` / `grab` images and record only needed keyframes, events, and hooks. |
| **L3 people** | Generate only the person sidecars needed for the chosen effect and time range. |

**Default to L0 + L1.** Add L2 or L3 only when the request explicitly calls for it or a later skill asks for a specific observation. A requested level is a ceiling, not an obligation to fill every section.

## Hard rules

- Analyze one footage file per run, recording every time in seconds from the uncut source.
- Never modify the source. Keep outputs at the canonical destination in [workflow.md](workflow.md) to prevent collisions between files with the same name.
- Invoke `akari media <sub> <target> [options]` under the [`akari media` contract §1 / §2](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-29-media-inspect-cli-v0.md). Parse stdout as JSON or JSON Lines; do not call a media backend directly from this workflow.
- Create a 720p proxy only if visual review at L2 or above needs it. At L0 and L1, pass the original file to `probe`, `waveform`, and `transcribe` without making a proxy.
- Follow contract §2.5 for transcription backend selection. A cloud connection must be registered in `.akari/connections.json` with doctor status `ok`, explicitly selected, and approved by a person through a decision card. Never upload audio by default. Access keys only through `credentials.env` and never print their values in chat, artifacts, or logs.
- Obtain word timing through `akari media transcribe`, which snaps word starts to speech after silence. Do not use word times from a direct whisper-cli call: its default `offsets` are estimates and place words before speech when initial or inter-sentence silence is present (#92 observed a first word at zero despite two seconds of silence). With flash attention enabled by default, `-dtw <preset>` is silently ineffective unless used with `-nfa` and read from `tokens[].t_dtw`.
- If no backend is available or no speech is present, do not invent words. Leave `transcript: []` and report why.
- Write `note` after actually viewing the images used in L2. Do not write findings on unseen images.
- Create only `filler | trouble | chapter | highlight | hook` events. Record a hook only for a window chosen for scoring, and score all five axes there with integers from 1 to 5.
- Add no fields outside [analysis.schema.json](https://github.com/AkariLabs/akari-video/blob/main/packages/schemas/analysis.schema.json). Finalize only JSON that passes structural and semantic checks. `keyframes: []` and `events: []` are valid both when L2 was not observed and when nothing qualified; distinguish the cases by the type and range of `observations[]`.
- Do not generate L3 for every file. Generate only the person-track types and intervals needed for the chosen effect. By default, `tracks.person_matte: null`; omit optional person-track keys until generated.
- Use OpenMontage for structural reference only; do not copy AGPL text or code.
- Follow the "existing contract sidecars" layer of the [project-structure-v0 contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-25-project-structure-v0.md) for `.akari/sidecars/` output paths.

Pass --lang for the work's content language on transcription calls. The default SpeechAnalyzer backend uses that language when its locale is supported.

## Execution order and stopping conditions

1. Read [workflow.md](workflow.md) to confirm the source, output destination, and requested level.
2. **L0 — probe:** Run `akari media probe`. You may stop if the request asks only for L0, or there is no audio for L1 to inspect.
3. **L1 — waveform:** If audio exists, run `akari media waveform`. You may stop if `speech_likely` is false, or speech content and subtitles are not needed and transcription was not explicitly requested.
4. **L1 — transcribe:** Run `akari media transcribe` only when `speech_likely` is true. You may stop once the default L0 + L1 work is complete and no L2 or L3 work was requested. If no backend is available, stop with an explanation of the degraded result rather than guessing.
5. **L2 — visuals and events:** Only when requested, read [keyframes-and-review.md](keyframes-and-review.md) and [events-and-hooks.md](events-and-hooks.md), then inspect and judge the necessary windows. You may stop when the requested keyframes, events, or hooks are covered and no person track is needed.
6. **L3 — people:** Only when requested, run the relevant type and interval from [person-matte.md](person-matte.md) or [vision-tracks.md](vision-tracks.md). You may stop when the selected effect has its inputs, or when a sidecar is unavailable and the reason is recorded.
7. Read [analysis-json.md](analysis-json.md). Preserve untargeted existing sections, validate against the schema and semantic rules, then finalize atomically. Validation is required at every stopping level.

Read only the files needed for the current step and requested level.
