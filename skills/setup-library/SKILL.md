---
name: setup-library
description: 'Use for first-time AKARI Video setup or when the current project needs more usable assets. This first-run skill checks ffmpeg / whisper-cli (and can install with approval), reads the bundled catalog with akari assets to propose a starter pack, obtains explicit human approval, then acquires, places, validates, and updates INDEX entries. It also covers the audio library (BGM and sound effects): bulk acquisition of first-party AKARI Sounds from GitHub Releases, a free-source candidate HTML list with drop-folder matching or assisted acquisition for missing families, and keep/drop decisions in the listening gallery. Use for requests such as "I want more BGM" or "add sound effects to the library".（旧名: setup-audio-library）'
---

# FORBIDDEN-level hard rules

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

Never proceed with asset setup in violation of any rule below. These always override detailed leaf documents.

1. **Do not acquire, purchase, or log in without explicit human approval.** Do not write catalog entries to `assets/` before approval.
2. **Do not invent inventory.** Do not propose or record categories, entries, URLs, or license statements absent from the bundled catalog returned by `akari assets list --source site` / `akari assets show`. If the catalog is empty or the relevant category is unfinished, honestly report that no assets can be proposed.
3. **Do not put assets with undetermined licenses into `assets/`.** Do not blindly trust external `source.license_at_source`; record only what you verified. akari-r2 has no `source.license_at_source`. Stop placement if the license cannot be established.
4. **The agent must not acquire `acquisition: login` / `purchase` assets on the user's behalf.** Present the URL, let the user acquire them, and confirm their location before proceeding.
5. **Do not leave the `remote` flag after placement in `assets/`.** Do not report placement complete in `assets/` while actual files are missing.
6. **Never omit records for assets with `attribution_required` true.** Explicitly record this in `assets/<category>/INDEX.md` and tell the user that project-side credits are required.
7. **Do not report “validated” without running `akari assets validate <dir>`.**
8. **Do not overwrite existing `assets/<category>/<id>/` without permission.** If IDs collide, compare contents and ask for a human decision.

## Audio hard rules (BGM / sound effects)

The library defaults to the workspace's `library/`. Without a workspace, use the legacy `~/.akari/assets/`.
Check the first line of `akari-assets list` (or `akari assets list`) for the actual location.
Below, `<ライブラリの置き場>` is the existing library-location placeholder; audio belongs in its `audio/` subdirectory.

The reference-record location (the default `--catalog-dir`) is the repository's `catalog/audio/` in a checkout and `<AKARI_HOME>/catalog/audio/` otherwise (`AKARI_HOME` defaults to `~/.akari`). Never write into the installed app. Find the candidate file through `akari assets catalog --json` → `audioCandidatesPath`.

Never proceed with audio setup in violation of any rule below. These always override detailed leaf documents.

> **Scope**: Acquisition rules 1 and 2 below protect **third-party distributors** (such as Sound Effect Lab and
> DOVA-SYNDROME, external sites in candidates.json's `categories`). First-party AKARI Sounds
> (candidates.json's `first_party`, the **default source**) may be acquired in bulk because its own GitHub Release
> is the distributor (owner ruling 2026-08-03; procedure: [audio-first-party.md](audio-first-party.md)).
> Do not expand acquisition beyond AkariLabs/akari-sounds.
> Audio rules 3–8 apply equally to first-party assets.

1. **Agent acquisition from third-party distributors requires user instruction.** The default third-party flow is
   “generate candidate-list HTML” and “scan the drop folder”. Acquire directly only when the user instructs it.
   Leave the acquisition decision to the user; do not preemptively declare or enumerate per-source feasibility.
   Follow [audio-assisted-fetch.md](audio-assisted-fetch.md) when acquiring:
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

## Assets (3D, fonts, B-roll, and other non-audio categories)

1. [tools-check.md](tools-check.md) — Verify ffmpeg / whisper-cli actually exist
2. [starter-pack.md](starter-pack.md) — Inspect the bundled catalog with `akari assets`, ask about intended use, propose a starter pack, and obtain approval
3. [fetch-and-validate.md](fetch-and-validate.md) — Acquire only approved assets, place in `assets/`, validate, and update `INDEX.md`

## Audio (BGM / sound effects)

Audio uses an **asynchronous, multi-session** workflow: browse candidates, download later at leisure, and register
together when convenient. Reuse the meta.json v0 contract, scope hierarchy (`local` / `shared` / `user` / `builtin`),
and validator from [fetch-and-validate.md](fetch-and-validate.md) and [harvest-asset](../harvest-asset/SKILL.md).

1. [audio-first-party.md](audio-first-party.md) — **Default**: Bulk-acquire AKARI Sounds from GitHub Releases and register
   in user scope (all BGM/jingles; start here for first-time setup).
2. [audio-candidate-list.md](audio-candidate-list.md) — Supplement families missing from AKARI Sounds: generate candidate HTML
   from the candidate file at `audioCandidatesPath` returned by `akari assets catalog --json`. Already-owned (catalog-registered) assets are grayed out.
3. [audio-drop-folder.md](audio-drop-folder.md) — Scan user-saved files, match candidates, place in library + register catalog
   metadata, or quarantine (default third-party flow).
4. [audio-assisted-fetch.md](audio-assisted-fetch.md) — Only on user instruction: acquire on their behalf and place in `_staging/` with provenance.
5. [audio-gallery.md](audio-gallery.md) — Listen to registered audio and record keep/drop.
6. [audio-store-unlock.md](audio-store-unlock.md) — Install purchased AKARI Store declaration packs
   (`akari store status` → `install` → validate; triggered by requests to set up purchased assets).

Read only the file for the current stage, without reading ahead. Do not proceed to a stage that has not been approved.

## When the request comes from the app library

For an “Import” or “Import all” request naming `category/id` values such as `font/klee-one`, inspect each named ID with `akari assets show <category/id> --json`. Show its acquisition method, license, and attribution requirement, then obtain the explicit approval required by hard rule 1 before following [fetch-and-validate.md](fetch-and-validate.md). Acquire only the named and approved IDs.
If a named entry has a non-null `bundledAssetDir`, do not acquire it; tell the user it is already bundled with the app and ready to use (`同梱済みでそのまま使える`).

## When the user wants account assets (free + purchased)

Separate from the bundled-catalog starter-pack proposal (the 3 steps above), there is a direct route to
**assets available to that account** (all free assets + purchased ones if `akari store connect` is complete).
Try this first for requests such as “Set up my purchased assets” or “Use this asset”.

- `akari assets list [--category <c>] [--json]` — Show a list with acquisition badges (☁ not acquired / ✓ acquired /
  🔒 Pro). Filter with `akari assets list --tag <t> --query <s>`.
- `akari assets fetch <category/id> --project .` — Import directly into this project, including sha256 verification.
- External-site references (`state: reference`, `↗`) cannot be acquired by `akari assets fetch`; use the catalog → list → show procedure in [starter-pack.md](starter-pack.md) and its approval flow.
- Pro (Lifetime pass) assets can also be acquired 1 at a time. Paste the copy from a Lab page for 1 asset (`category/id`)
  and use `akari assets fetch <category/id>` to acquire 1 asset.
- For unpurchased paid assets, `fetch` returns `locked` with the price. **Do not purchase on the user's behalf**
  (same discipline as hard rule 4). Ask the user to purchase in the store using the account connected via `akari store connect`.

## Where the library fits

The library is one way to get assets, not the default answer. Whether a project generates everything, uses library
assets as-is, or generates while referencing the library is decided in planning ([edit-plan](../edit-plan/SKILL.md)).
Do not read this skill as “always search the library first”.

## Sources

- Contract: [`docs/contract-2026-07-13-asset-library.md`](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-13-asset-library.md), Catalog and acquisition skills section (Japanese)
- Asset harvesting and meta.json v0 discipline: [../harvest-asset/SKILL.md](../harvest-asset/SKILL.md)
- Authoring hard rules: [../overlay-authoring/SKILL.md](../overlay-authoring/SKILL.md)
- Audio research: `research/2026-07-22-free-sfx-bgm-sources.md` (internal repository; per-source terms,
  automation suitability, and primary information for 52 candidates).
- Audio candidate-list implementation patterns: [`packages/decision-cards/`](https://github.com/AkariLabs/akari-video/blob/main/packages/decision-cards/README.md),
  [`packages/intake-form/`](https://github.com/AkariLabs/akari-video/blob/main/packages/intake-form/README.md).
- Prior drop-folder semi-automated acquisition:
  [`../generate-narration/voice-profile-setup.md`](../generate-narration/voice-profile-setup.md)
  (mtime-based collection; this skill uses filename matching, but shares the “user acquires, agent collects later” design).
