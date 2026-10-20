# recipe.md — Freeze recipes and remember preferences

Canonical contract: [contract-2026-07-25-recipe-v0.md](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-25-recipe-v0.md).
Schema: [recipe.schema.json](https://github.com/AkariLabs/akari-video/blob/main/packages/schemas/recipe.schema.json).
Validation CLI: `node packages/schemas/bin/validate-recipe.mjs <path>`.

This leaf has two independent procedures: **recall** (read before direction setting in [workflow.md](workflow.md)) and **freeze** (read during completion after execution approval). Do not learn or apply automatically. This file contract records only confirmed values and presents them with provenance (contract §0).

## 1. Recall procedure (before choosing direction)

Do the following once before presenting the direction to the human in chat.

1. List `~/.akari/recipes/` (if absent, do nothing and continue normally; it is not an error).
2. Target only recipes with `workflow: "edit"`; ignore `workflow: "research"`.
3. If any match, validate them with `node packages/schemas/bin/validate-recipe.mjs` before use. Ignore a recipe stopped read-only because its version is too new and continue; recall failure does not stop the workflow (contract §5 degradation rule).
4. Present validated recipes' `confirmed` values in chat as **recommendations stating their provenance (`provenance[].confirmed_by` / `at`)**. For example: "In your previous **<name>** (<source_project>), you used <aspect> / <target_duration_band>, etc. Use those again, or decide afresh for this project?" Phrase the user-facing example according to the user's language pack (see SKILL.md).
5. A recipe **must not override the current request**. Only when the human explicitly says to adopt it, for example "another with <name>" or "same as last time," may all corresponding `confirmed` fields be applied **together** to this direction and asset plan (contract §3 rule 3). Without explicit adoption, keep it as reference and run normal Checkpoints 1–3 ([approvals-and-generation.md](approvals-and-generation.md)).
   - `caption_style_ref` is currently **descriptive only** free text, not a registry-backed profile. Do not infer or automatically inject W5–W7 fields such as `display_policy`, `display_fragments`, `text_style`, `output.encoding`, or `audio.master` from its name. Even after adoption, confirm each value explicitly for this project at the normal Checkpoint.
   - Without a versioned profile registry and content SHA, do not read or create an unknown raw `render_profile_ref` key. Do not reuse A4 method values from an unknown key.
6. Presenting a recipe **does not justify skipping mandatory questions**, such as the intake workflow form. Have the intake submitted normally even when a recipe exists (contract §3 rule 2).
7. If several `workflow: "edit"` recipes match, list candidates newest `frozen_at` first. Do not auto-select; the human chooses which to use, or none.

## 2. Freeze procedure (offer once during completion)

After Checkpoint 3 (execution) approval and creation of `edit.json` and final overlays, **if freeze has not yet been offered in this project**, offer in chat once (offer-once) to save a recipe. If already offered in this project, whether accepted or declined, never offer again (contract §3 rule 4).

1. **Collect only confirmed values**. Write to `confirmed` only values that actually passed a checkpoint with explicit human approval. Do not record inferred or default-filled values even when they appear in the final output: that would violate the **confirmed values only** contract (§3 rule 1). Map each value's provenance as follows (contract §4):
   - `intake`: value settled by submitting the workflow form (`intake.json`).
   - `structure-confirm`: value settled by a research/structure confirmation card (unusual in plan-edit; applies only when zero-media planning was confirmed through plan.json).
   - `edit-approval`: value settled by explicit Checkpoint 1 (direction) or Checkpoint 2 (asset-plan) approval (often `caption_style_ref` / `bgm_profile` / `overlay_kinds` / `narration`).
   - `render-approval`: value settled by explicit Checkpoint 3 (execution manifest) approval (often output `aspect`).
2. Include only actually confirmed values among `confirmed.aspect` / `target_duration_band` / `caption_style_ref` / `bgm_profile` / `overlay_kinds[]` / `narration` (`engine`/`voice`). If none are confirmed, do not offer freeze.
3. Confirm a kebab-case name with the human. If a recipe with that name exists, ask whether it may be overwritten; do not overwrite silently.
4. Build `~/.akari/recipes/<name>.json` and validate it with `node packages/schemas/bin/validate-recipe.mjs`; do not treat it as saved until exit 0 is verified.
5. After validation, save it in `~/.akari/recipes/` (create the directory if absent) and confirm with the human using the following template. Explain how to invoke it; the system recalls the name, so the user need not memorize it. Render the message in the user's language (see SKILL.md):

   > Saved as **<name>**. I will remember it for later. Next time, ask for "another with <name>" or "the same as last time."

6. This completes the project's freeze offer (offer-once). Do not offer again in the same project. Reaching completion in a different project permits a new offer.

## Common mistakes

- Writing inferred or default values to `confirmed`; only explicitly human-approved values qualify.
- Overriding the current request with a recipe recommendation or skipping mandatory intake questions.
- Offering freeze repeatedly in one project (violates offer-once).
- Silently reusing `confirmed` in this plan without explicit adoption such as "same as last time."
- Treating descriptive-only `caption_style_ref` as a registry key and automatically applying W5–W7 fields.
- Preemptively adding `render_profile_ref` or storing/restoring A4 values under an unknown raw key.
- Saving a recipe outside `~/.akari/recipes/`, such as project `planning/`.
- Reporting freeze complete without passing `validate-recipe.mjs`.
