---
name: create-project
description: Create an AKARI Video project headlessly. Recursively copy `templates/project-default/`, record the template version, initialize git only when safe, and generate an HTML creation report. No app launch is needed. Use to create a video project or fill in an existing folder as an AKARI Video project.
---

# Create a new project

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

## Hard rules

1. **There are only 2 template resolution choices, in the specified order.** Do not invent templates or categories.
2. **Never overwrite existing files** (`flag:'wx'`). Applying to an existing folder only adds missing files;
   leave CLAUDE.md / AGENTS.md untouched — the same discipline as self-contained contract §5.
3. **Warn and skip symbolic links rather than copying them.**
4. **Include the F18 guard**: evaluate `git rev-parse --show-toplevel` at the destination;
   do not git init inside an existing repository (such as `_edit`). Do not create a route that pollutes the parent repository
   (the same criteria as Wave 9 `f18-parent-repo-guard`).
5. Init + a single commit **only when git initialization is safe**. Otherwise report the reason and skip.
6. **Only record the template version (`AKARI-SKILLS-VERSION`)**; never silently update existing projects.
7. **Keep the artifact diff between app-created and skill-created projects at zero** (the shared implementation in §3 provides this).

## Procedure

1. Use `--scaffold <path>` (alias: `--template <path>`) if supplied; otherwise use the repository checkout's `templates/project-default/`. Do not resolve templates by any route beyond these 2 choices.
   Determine the content language from the user's conversation and source audio, independently of the UI language.
   If the languages appear to disagree, confirm the desired content language with 1 question. Store its BCP 47
   value in intake.json's language field; use akari new's --lang option if available. Resolution order is explicit
   --lang → intake.json language → analysis.json transcript.language → ja. For packs, normalize to the primary
   subtag (en-US → en), always keep ja as ja, and fall back to en when a pack is missing.
2. Run this CLI:

   ```sh
   akari new <target-dir> [--scaffold <path>]
   ```

3. Check the HTML creation report path printed to stdout. The read-only report records copying, fallback additions, skipped symbolic links, template version, and git initialization results.

## Usage

```sh
akari new <target-dir> [--scaffold <path>]
```

- `<target-dir>`: Destination directory, either new or an existing nonempty folder. Existing files are not overwritten.
- `--scaffold <path>`: Explicit scaffold (project foundation) directory. `--template <path>` is an alias; passing both is an error. Defaults to the repository checkout's `templates/project-default/`. There is no other resolution route.

## Starting from a playbook

Use `akari new <target-dir> --from <playbook-dir | id>` to create the same project container and then apply a recorded playbook. An ID resolves from the current channel's `playbooks/<id>/` before `~/.akari/playbooks/<id>/`. The command copies the playbook, adds empty role placeholders to edit.json, and prints the creation report and read-only review sheet paths. `--scaffold` may be combined with `--from`; template resolution still has exactly the two choices above.

## When the user wants to start from a worked example

Requests such as “Make a short explainer” or “Something like that vertical explainer video” ask to **start from a
finished example**, which is separate from the 2 template resolution choices (hard rule 1). This skill creates the
**project container**; a worked example is not a container.

- Short explainer (vertical 3-panel layout, VOICEVOX narration, progressively revealed diagram cards):
  [`templates/kaisetsu-short/`](https://github.com/AkariLabs/akari-video/blob/main/templates/kaisetsu-short/README.ja.md) (Japanese).
- Duplicate the entire directory and replace `sample-project/` with your own script JSON.
  To check it first, use the bundled sample (audio is included, so VOICEVOX is unnecessary):

  ```sh
  cd templates/kaisetsu-short && node tools/build.mjs sample-project --no-synthesize
  ```

- **Do not pass a worked example to `--scaffold`.** It lacks container structure such as `.akari/`,
  so resolving it as a template produces an incomplete project. If a container is needed, create it normally
  with `templates/project-default/`, then duplicate the worked example and bring in its contents.
- See [`templates/INDEX.md`](https://github.com/AkariLabs/akari-video/blob/main/templates/INDEX.md) for the 2 template types (containers / worked examples).

## intake.json (saved workflow form)

Immediately after creation, `.akari/intake.json` starts with `status: "draft"` and empty `tasks` (contract: `packages/schemas/intake.schema.json`). Add the intake discipline to the project's CLAUDE.md: with `status: "submitted"`, follow `tasks` / `target` / `autonomy`; with `autonomy: "checkpoint"` (default), check with the user at key points such as planning approval and before export; if still `status: "draft"`, settle the workflow through the form or conversation before proceeding.

- Use only this fixed vocabulary for `tasks`. The contract's `x-akari-labels` is the canonical source for Japanese labels.
  - `transcribe-captions` (transcription and captions)
  - `silence-cut` (cut unnecessary pauses and bad takes)
  - `bgm-sfx` (background music and sound effects)
  - `narration` (your own voice / a preset voice)
  - `3d-inserts` (3D and screen inserts)
- Do not put request text or free text in `tasks`. Put requests outside the vocabulary in
  `target.taste` (free text) or `planning/`, rather than in `tasks`.
- Choose either `target.duration_s` (numeric duration) or `target.keep_length: true` (retain length).
  For “about 60 seconds”, use `{"duration_s": 60, "keep_length": false}`; for “keep the length”,
  use `{"duration_s": null, "keep_length": true}`.
- Before changing `status` to `"submitted"`, run the same CLI as the edit-lint skill from the repository root
  and verify that there are no `intake.*` error findings. When setting `submitted`, always provide an
  ISO 8601 timestamp in `submitted_at`.

  ```sh
  node packages/edit-lint/bin/edit-lint.mjs <project-root>
  ```

The canonical field contract is `packages/schemas/intake.schema.json`.
