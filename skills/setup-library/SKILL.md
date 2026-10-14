---
name: setup-library
description: Use for first-time AKARI Video setup or when the current project needs more usable assets. This first-run skill checks ffmpeg / whisper-cli (and can install with approval), reads the bundled catalog with akari assets to propose a starter pack, obtains explicit human approval, then acquires, places, validates, and updates INDEX entries.
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

# Leaf documents in execution order

1. [tools-check.md](tools-check.md) — Verify ffmpeg / whisper-cli actually exist
2. [starter-pack.md](starter-pack.md) — Inspect the bundled catalog with `akari assets`, ask about intended use, propose a starter pack, and obtain approval
3. [fetch-and-validate.md](fetch-and-validate.md) — Acquire only approved assets, place in `assets/`, validate, and update `INDEX.md`

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

## Sources

- Contract: [`docs/contract-2026-07-13-asset-library.md`](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-13-asset-library.md), Catalog and acquisition skills section (Japanese)
- Asset harvesting and meta.json v0 discipline: [../harvest-asset/SKILL.md](../harvest-asset/SKILL.md)
- Authoring hard rules: [../overlay-authoring/SKILL.md](../overlay-authoring/SKILL.md)
