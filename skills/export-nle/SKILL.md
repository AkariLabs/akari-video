---
name: export-nle
description: "BETA (not yet tested in actual NLEs): Export edit.json to Final Cut Pro / DaVinci Resolve (FCPXML), Premiere Pro (FCP7 XML), and SRT captions. Use for requests to open in Premiere or Final Cut, export for Resolve, or get an SRT. Always report fields that cannot transfer in dropped[]."
---

# Export editing data to other NLEs (BETA)

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

> ⚠ **BETA — implemented, but not verified in actual applications**
> This feature has been implemented, but its output has not yet been imported into actual
> Final Cut Pro, DaVinci Resolve, or Premiere Pro applications for verification.
> Reports of XML that fails to import or is misaligned are welcome as issues.
> **Always tell users about this beta status** when handing over results.

## What this is

A **one-way export** demonstrating that AKARI Video's saved-data SSOT (edit.json) has no lock-in. It gives users who want to finish in a professional tool an exit path.

| Format | Target | File |
|---|---|---|
| FCPXML 1.11 | Final Cut Pro / DaVinci Resolve | `<project>.fcpxml` |
| FCP7 XML (xmeml v5) | Premiere Pro | `<project>.premiere.xml` |
| SRT | Caption sidecar shared by all NLEs | `<project>.srt` (only when captions.json exists) |

**The reverse direction (bringing NLE edits back into edit.json) is unsupported.** It is outside scope.

Do not read all of `edit.json` or `captions.json`; grep by ID and read only the matching lines ([how to read edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md)). This skill does not write them. If another stage must write them, use Edit on the matching lines or the edit-store script API.

## Hard rules

1. **Be deterministic**: identical input → identical output. Do not mix LLM judgments, randomness, or current time into output.
2. **Zero external npm dependencies** (call the ffprobe binary directly through media-bin only).
3. **Target only version 2 edit.json; grep by ID to read matching lines and do not modify it.** Run `akari migrate` on older versions first.
4. **Never silently drop fields**: enumerate every field that the exchange format cannot carry (ducking / master / LUT / chroma_key / direction, etc.) in `export-report.json` `dropped[]`.
5. **Explicit beta status**: Always state that actual NLE import has not been verified in the user report. Never present it as verified.

## Procedure

1. Run against the target project (the directory containing edit.json).

   ```sh
   node packages/export-nle/bin/export-nle.mjs <project-root|edit.json>
   ```

   The default destination is `<project>/exports/nle/`. To limit formats, use `--format fcpxml` (comma-separated values allowed); use `--json` for machine-readable output or `--no-probe` to avoid ffprobe.

   Input must be edit.json v2. Convert a v0/v1 project to v2 with `akari migrate` first.

2. Check the exit code. `0` means export complete (warnings still count as success); `2` means an input or runtime error.
3. Read `exports/nle/export-report.json` and include `dropped[]` (non-transferrable fields) and `warnings[]` (placeholder durations, approximations, etc.) in the user report.
4. Media is written as **references** (absolute-path file URLs). Tell users they must reconnect media with the NLE's relink feature after moving or sharing the project.

## What transfers and what does not (contract summary)

Canonical source: [contract-2026-08-01-export-nle-beta.md](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-01-export-nle-beta.md)

- **Transfers**: `tracks[].items[]` media (interpret `tracks[]` array order as bottom-to-top z order; convert integer-frame `at` / `duration` to NLE time; preserve source `in` / `out`, speed, transform, and opacity; use stable `item.id` for the NLE clip name; carry blend into FCPXML and warn for xmeml), transition_out (dissolve directly, fade-black/white approximated by cross dissolve), pre-baked html / telop (alpha MOV, etc., as ordinary media clips), narration / sfx / bgm (place from the `tracks[]` audio lane or `edit.audio.*`, with gain; expand bgm loops and fades), and captions.json (as plain-text SRT).
- **Does not transfer** (report in dropped[]): ducking, audio.master (loudnorm / denoise), output.look (LUT), chroma_key, and caption styling (karaoke treatment and background plate).

### source.kind policy

| `source.kind` | NLE handling |
|---|---|
| `media` | Export as a media clip resolved through `sources[]`. Use the item's integer frames for timeline time and second-based `in` / `out` for the source window. |
| `html` | Export as a media clip if a baked asset is present in the internal representation. Current v2 html declarations lack `baked`, so normally omit it and put the reason and baking procedure in `dropped[]`. |
| `telop` | Export `source.baked` as a media clip if present. Otherwise omit it and record the reason and baking procedure in `dropped[]`. |
| `filter` | No interoperable clip representation exists. Omit it and record it in `dropped[]`; bake it into video if necessary. |

Never disguise unbaked html / telop as media references to HTML paths or preset names.
Export narration / sfx / bgm items in audio lanes from `tracks[]`.
For documents without audio items in `tracks[]`, continue to read `edit.audio.narration / sfx / bgm`.
Record omitted audio items, including muted items, speech roles, and the second or later bgm item, with reasons in `dropped[]`.
For `tracks[]` sfx, renumber NLE tracks from 0 in the order of audio lanes containing sfx, closing any gaps.
For ducking, prefer `edit.audio.bgm.ducking` when present; otherwise read the exported bgm item. Continue to report it as `audio.bgm.ducking` in `dropped[]` (after migration it resides on the bgm item).
Continue reading audio.master from top-level `edit.audio.master` and report it in `dropped[]`.
A bgm item's `at > 0` does not transfer because the exporter places it at 0 seconds; report it in `dropped[]` as `tracks[…].items[…].at`.

## Out of scope

- CapCut draft format (unofficial, increasingly encrypted, and liable to break with version updates; revisit through a lab/ spike if demand appears).
- Reverse import from an NLE.
- Automation of actual application import verification for generated XML (required to leave beta; design it after manual verification results accumulate).
