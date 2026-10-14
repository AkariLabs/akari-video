# First-party bulk acquisition (AKARI Sounds, default flow)

The library defaults to the workspace's `library/`. Without a workspace, use the legacy `~/.akari/assets/`.
Check the first line of `akari-assets list` (or `akari assets list`) for the actual location.
Below, `<ライブラリの置き場>` is the existing library-location placeholder; audio belongs in its `audio/` subdirectory.

## 0. What this is and why third-party rules differ

[AKARI Sounds](https://github.com/AkariLabs/akari-sounds) is a **first-party audio library** operated by the
same organization as AKARI Video (all tracks AI-generated; generation records public; commercial use permitted;
no credit required). It is declared as the default source in the candidate file (`akari assets catalog --json` → `audioCandidatesPath`)'s `first_party`.

SKILL.md's user-instruction requirement and prohibition on bulk/parallel acquisition **protect third-party servers
and licenses**. They do not apply to the organization's own GitHub Releases (owner ruling 2026-08-03:
allow bulk downloading free audio for first-time setup). Acquisition is limited to Release assets and `catalog.json`
from `AkariLabs/akari-sounds`. **Do not mix access to other hosts into this flow.**

## 1. When to run

- **When the user asks for bulk acquisition** (`akari sounds`). AKARI Sounds is the default BGM/jingle source.
  Check it first for sound effects too; supplement only missing families (applause/cheering, failure sounds,
  Japanese-style/battle impacts) through third-party candidates.
- **Do not ask at first launch** (changed 2026-08-04; the former 1-question [Y/n], default Yes flow was abolished).
  Default to **on-demand acquisition of only needed tracks** through asset-resolver (`akari-assets fetch <category/id>`).
  First launch shows only 1 guidance line. Bulk entry point: `akari sounds`.
- When a new AKARI Sounds Release tag appears (rerun with a different `--tag`).

## 2. Run

```sh
# ユーザー向けの入口
akari sounds
akari sounds --variant wav --force

# 取得内容の確認（ダウンロードなし）
akari sounds --dry-run

# 一括取得（mp3・既定）
akari sounds

# WAV が欲しい場合（3 分割 zip・約 3GB 級。通常は mp3 で足りる）
akari sounds --variant wav
```

## 3. What happens

- Fetch `catalog.json` → split into 3 kind-specific packs (`akari-sounds-bgm` / `akari-sounds-sfx` /
  `akari-sounds-jingle`) → download and extract Release zips into `<ライブラリの置き場>/audio/<パックid>/`
  (existing library-location/pack-ID placeholders; user scope, same location as drop-folder registration).
- Write each pack's `meta.json` (schema v0, actual-file entry), `preview.png` (real waveform; ffmpeg required), and
  `.origin-catalog.json` (acquisition-time catalog.json snapshot containing original prompts, generation timestamps,
  source URLs, and sha256 provenance).
- Finally check missing files and run `validate-asset.mjs` on all packs. Missing files/validation failures honestly
  produce exit 1, never a fabricated registration-complete claim.
- Reruns are idempotent: if all files are acquired, only update meta.json. Use `--force` to reacquire.

## 4. Terms of use (if asked)

AKARI-Sounds-Terms-v0 (canonical source: Release-bundled TERMS.md): commercial use, editing, and processing allowed;
no credit required. There are 3 prohibitions: standalone redistribution/sale, registration with music streaming services
(such as Spotify), and Content ID registration. AS-IS, no warranty. Since AI training lacks explicit permission,
conservatively set `ai_training_allowed: false`.

## Common mistakes

- Mixing third-party distributors such as Sound Effect Lab into this bulk flow (third parties still use
  candidate-list → drop-folder / assisted-fetch).
- Extracting Release zips into catalog/ or this repository. Actual files always belong in user scope
  `<ライブラリの置き場>/audio/` (existing library-location placeholder); the no-audio-commit rule applies to first-party assets too.
- Constructing guessed filenames absent from `catalog.json` for acquisition.
