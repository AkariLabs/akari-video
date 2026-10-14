---
name: setup-audio-library
description: Use to expand the BGM and sound-effects library. Default to bulk acquisition of first-party AKARI Sounds directly from GitHub Releases, providing all BGM and jingles. Supplement only missing families (applause, failure sounds, Japanese-style impacts) with a free-source candidate HTML list and drop-folder matching or assisted acquisition. Semi-automated setup ends with keep/drop decisions in the listening gallery. A sibling of setup-library / harvest-asset, separated because audio requires a different workflow.
---

# FORBIDDEN-level hard rules

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

The library defaults to the workspace's `library/`. Without a workspace, use the legacy `~/.akari/assets/`.
Check the first line of `akari-assets list` (or `akari assets list`) for the actual location.
Below, `<ライブラリの置き場>` is the existing library-location placeholder; audio belongs in its `audio/` subdirectory.

The reference-record location (the default `--catalog-dir`) is the repository's `catalog/audio/` in a checkout and `<AKARI_HOME>/catalog/audio/` otherwise (`AKARI_HOME` defaults to `~/.akari`). Never write into the installed app. Find the candidate file through `akari assets catalog --json` → `audioCandidatesPath`.

Never proceed with audio setup in violation of any rule below. These always override detailed leaf documents.

> **Scope**: Acquisition rules 1 and 2 protect **third-party distributors** (such as Sound Effect Lab and
> DOVA-SYNDROME, external sites in candidates.json's `categories`). First-party AKARI Sounds
> (candidates.json's `first_party`, the **default source**) may be acquired in bulk because its own GitHub Release
> is the distributor (owner ruling 2026-08-03; procedure: [first-party.md](first-party.md)).
> Do not expand acquisition beyond AkariLabs/akari-sounds.
> Rules 3–8 apply equally to first-party assets.

1. **Agent acquisition from third-party distributors requires user instruction.** The default third-party flow is
   “generate candidate-list HTML” and “scan the drop folder”. Acquire directly only when the user instructs it.
   Leave the acquisition decision to the user; do not preemptively declare or enumerate per-source feasibility.
   Follow [assisted-fetch.md](assisted-fetch.md) when acquiring:
   - Check feasibility at execution time. Report unsuccessful sources with reasons, link their download pages,
     and switch to manual acquisition.
   - Acquire serially, sleep 3–5 seconds between requests, and retry failures at most 1 time. No bulk or parallel acquisition.
   - Acquire only file URLs actually read from the page. **Never construct guessed URLs.**
   - Record source-page URL, acquisition time, license, and credit requirements as provenance:
     attach `.meta.json` to evaluation staging in `<ライブラリの置き場>/audio/_staging/<site>/<id>/`
     (existing library-location placeholder).
   - After evaluation, discard everything except keep selections (acquisition is temporary staging for listening and selection).
2. **Candidate-list links must always be download-page URLs.** Never link directly to audio files.
3. **Do not invent inventory or existence.** Do not invent sites, URLs, or license statements absent from
   the candidate file at `audioCandidatesPath` returned by `akari assets catalog --json`. If page existence or filenames cannot be verified, record the uncertainty
   honestly, for example `confidence: "blocked_unverifiable"`.
4. **Set `ai_training_allowed` conservatively.** Use `false` unless source terms explicitly permit AI training;
   absence of permission is not permission. Only explicit CC0 gets `true`.
5. **Do not commit audio files to this repository.** Actual files always belong outside the repository
   (user scope, e.g., `<ライブラリの置き場>/audio/<id>/`, the existing library-location placeholder).
   Put only `remote: true` reference metadata in the reference-record location.
6. **Do not overwrite an existing `<id>/` in the reference-record location without permission.** On ID collision, skip the write
   and log it (same discipline as harvest-asset / setup-library).
7. **Do not report registration complete without running `akari assets validate <dir>`.**
   This targets actual library-scope entries only; validator design exempts `remote: true` catalog references
   from preview.png checks.
8. **If a source has an official description, record the original unchanged; do not invent meaning from guesses.**
   Source identification (filename, md5, terms) and interpretation (what the sound is / when to use it) are separate.
   Filename verification alone does not justify writing a description (owner ruling 2026-07-31).
   Previously, the Chiin1 chime was guessed to mean “end/confirm”, but its official description said it was for disappointment,
   the opposite meaning. If no official description exists, record that fact and explicitly label any inference.

# Leaf documents in execution order

1. [first-party.md](first-party.md) — **Default**: Bulk-acquire AKARI Sounds from GitHub Releases and register
   in user scope (all BGM/jingles; start here for first-time setup).
2. [candidate-list.md](candidate-list.md) — Supplement families missing from AKARI Sounds: generate candidate HTML
   from the candidate file at `audioCandidatesPath` returned by `akari assets catalog --json`. Already-owned (catalog-registered) assets are grayed out.
3. [drop-folder.md](drop-folder.md) — Scan user-saved files, match candidates, place in library + register catalog
   metadata, or quarantine (default third-party flow).
4. [assisted-fetch.md](assisted-fetch.md) — Only on user instruction: acquire on their behalf and place in `_staging/` with provenance.
5. [gallery.md](gallery.md) — Listen to registered audio and record keep/drop.
6. [store-unlock.md](store-unlock.md) — Install purchased AKARI Store declaration packs
   (`akari store status` → `install` → validate; triggered by requests to set up purchased assets).

Read only the file for the current stage, without reading ahead.

## Relationship to setup-library / harvest-asset (why this is deliberately separate)

Reuse the meta.json v0 contract, scope hierarchy (`local` / `shared` / `user` / `builtin`), and validator from
`../setup-library/` and `../harvest-asset/`. **The acquisition workflow itself is a separate skill** because:

- `setup-library` assumes one session: present catalog → approval → direct acquisition or login guidance.
  Audio uses an **asynchronous, multi-session** workflow: browse candidates, download later at leisure, register
  together when convenient. Forcing this into `starter-pack.md` / `fetch-and-validate.md` would create too many branches.
- Drop-folder scanning, filename matching, quarantine (unknown-source list), and a listening gallery are audio-specific
  mechanisms absent from other categories (3d/font/broll, etc.).
- Files of the existing 2 skills were not changed. Adding a reference in `setup-library/SKILL.md` was outside
  that task's boundary and deferred; users/owners can add it separately if needed.

## Sources

- Internal research: `research/2026-07-22-free-sfx-bgm-sources.md` (internal repository; per-source terms,
  automation suitability, and primary information for 52 candidates).
- Public contract: [`docs/contract-2026-07-13-asset-library.md`](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-13-asset-library.md),
  Catalog and acquisition skills / Asset scope hierarchy sections (Japanese).
- Existing implementation pattern (node:http helper + static HTML):
  [`packages/decision-cards/`](https://github.com/AkariLabs/akari-video/blob/main/packages/decision-cards/README.md),
  [`packages/intake-form/`](https://github.com/AkariLabs/akari-video/blob/main/packages/intake-form/README.md).
- Prior drop-folder semi-automated acquisition:
  [`../generate-narration/voice-profile-setup.md`](../generate-narration/voice-profile-setup.md)
  (mtime-based collection; this skill uses filename matching, but shares the “user acquires, agent collects later” design).
