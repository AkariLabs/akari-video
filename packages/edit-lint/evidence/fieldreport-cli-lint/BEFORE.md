# BEFORE observations

All paths below are repository relative. The input is a neutral, locally made fixture. These observations use the pre-change source (`HEAD`) and its existing fixtures; no reported PV content is copied.

| Item | Baseline observation |
| --- | --- |
| C-1 | In a synthetic desktop bundle containing edit-lint but omitting `packages/schemas/engine-capabilities.json` as the desktop filter does, the pre-change CLI `--engine osr --json` returned exit 2 and `engine capability table cannot be read: ENOENT ... <bundle>/packages/schemas/engine-capabilities.json`. |
| C-2 | With a neutral `review/edit.json` beneath a project, the pre-change CLI returned exit 1 and wrote `review/.akari/lint.json`; the project root's `.akari/lint.json` was untouched. Its relative media paths were interpreted beneath `review/`. A root-level `edit.json` was unaffected. |
| B-6 | Existing `v2-audio-bgm-multiple-invalid` fixture has two adjacent BGM items at frames 0–30 and 30–60. Lint returned `v2.audio-bgm-multiple` error. Code inspection of `edit-store/src/internal-model.ts` shows projection assigns each BGM to a single `audioBgm` value; the last overwrites the first. `render-cut/src/plan.mjs` mixes one `audio.bgm`. |
| B-11 | A neutral fragment `<style>.x{background:url(data:image/svg+xml,%3Csvg%3E(x)url(foo.png)%3C/svg%3E)}</style>` passed to `extractFragmentAssetReferences` returned one false external reference: `foo.png` (`motion/foo.png`). The scanner is in `packages/render-cut/src/fragment-assets.mjs`, outside this task's file boundary. |
| C-3 | `paid-zip` called `unzip` only; store installation tried `unzip` then `tar`; Sounds had a different platform-specific chain. Removing `unzip` from PATH made the paid-zip call fail with a missing-command error. |
| C-4 | A neutral local catalog with a `tone-a` item tagged `pack:fixture-pack` returned `not_found` and `未知の素材 id です: fixture-pack` when the pack id was fetched. The resolver searched only `catalog.items[].id`; the Sounds pack reference likewise has a pack id while the resolver catalog lists individual assets. |
| C-5 | `doctor.mjs` wrote `connections-report.html` at project root. Bare `akari` reached the Claude/opencode launch branch without a stdin/stdout TTY check. |
| C-6 | `generate-narration/SKILL.md` required provenance in general, without naming the mandatory `provider` key or an example. |

The platform-specific PowerShell case was emulated through an injected missing `unzip` result. No Electron or shell application was started.
