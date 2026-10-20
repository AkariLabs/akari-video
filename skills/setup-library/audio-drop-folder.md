# Monitor and register the drop folder

The library defaults to the workspace's `library/`. Without a workspace, use the legacy `~/.akari/assets/`.
Check the first line of `akari-assets list` (or `akari assets list`) for the actual location.
Below, `<ライブラリの置き場>` is the existing library-location placeholder; audio belongs in its `audio/` subdirectory.

After the user actually downloads files via [audio-candidate-list.md](audio-candidate-list.md), use this leaf for per-file matching and registration.

## 1. Drop-folder location

Default: `~/.akari/audio-drop/` (the third ruling of 2026-07-25 unified the base for out-of-project locations
under `~/.akari/`; current key location: `~/.akari/credentials.env`).
`~/.config/akari-video/voice-profiles/` is a separate issue, but both are user-level locations outside git.
Ask the user to move/save browser downloads into this folder. Do not monitor `~/Downloads` directly;
use a dedicated audio location to avoid incorrect registration of unrelated downloads.

## 2. Check plan-only first (default, safe)

```sh
akari assets audio drop \
  --drop-dir ~/.akari/audio-drop
```

Without `--apply`, **no files move and nothing is written to the catalog**.
Show stdout JSON (`matched_candidates` / `quarantined`) to the user and confirm it matches expectations.

## 3. Apply with `--apply` if correct

```sh
akari assets audio drop \
  --drop-dir ~/.akari/audio-drop --apply
```

- **Matched files**: Move actual files to `<ライブラリの置き場>/audio/<candidate-id>/` (existing library-location
  placeholder; user scope, same hierarchy as [fetch-and-validate.md](fetch-and-validate.md)).
  Write `meta.json` (actual files present, no `remote` key). Also create `<candidate-id>/meta.json` in the reference-record location
  (`remote: true` reference SSOT) if absent. **Never overwrite an existing one** (audio hard rule 6).
  With `ffmpeg`, generate waveform `preview.png`; otherwise log the reason without generating it.
  Do not make a mock differing from the actual asset.
- **Unmatched files**: Move to drop-folder `_quarantine/` and record unknown source in `_quarantine/manifest.json`
  (same discipline as audio-import). Do not register based on filename guesses.
- **Multiple matches**: Quarantine because uniqueness cannot be established; do not guess.

Reruns are idempotent (no duplicate moves of same-name files or duplicate entries in `manifest.json`).

## 4. Matching limitations (explain honestly)

Filename matching works only for candidates identified down to individual filenames, with `expected_filenames` /
`filename_patterns` in candidate data (some Sound Effect Lab / OtoLogic entries).
DOVA-SYNDROME, Pixabay, and Freesound tag/search-page candidates cannot be matched automatically because
user-chosen save filenames are unpredictable; they go to `_quarantine/`. Follow the audio-import precedent:
review `_quarantine/manifest.json`, ask the user for sources, then add `expected_filenames` to the corresponding
candidate in the candidate file at `audioCandidatesPath`, or manually create `<id>/meta.json` in the reference-record location.

## 5. Validate

```sh
akari assets validate <ライブラリの置き場>/audio/<candidate-id>
```

Report failures honestly (usually missing `preview.png` because ffmpeg is unavailable).

## Common mistakes

- Claiming registration without `--apply` (plan-only changes nothing).
- Arbitrarily choosing one of multiple matching candidates.
- Overwriting existing `<id>/meta.json` in the reference-record location.
- Ignoring `_quarantine/` and reporting completion while unknown-source files remain unresolved.
