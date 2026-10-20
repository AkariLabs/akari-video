---
name: research-plan
description: Run the headless video planning and research workflow from ideas through audience, competitor, and trend research to a proposal, structure, storyboard, and shot list. Use decision cards in an HTML report and decisions.json to obtain human choices for the topic and final structure.
---

# Plan and research a video

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

Read lang/<content-language>.md for language-specific rules (content language: --lang → intake.json "language" → transcript language → ja; see https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-10-11-content-language.md). If that file does not exist, read lang/en.md.

> The bundled v0 skill is provisional. Move it to reference distribution when both the skill catalog and setup installation mechanism exist. The bundle, including its leaf files, contains only text and no binary assets.

## Hard rules

1. **State expected costs before paid API calls, and execute only after approval through the state file** (`.decisions.json` or equivalent). Chat approval alone does not authorize a charge.
2. **Use only [setup-connections](../setup-connections/SKILL.md) and registered `.akari/connections.json` entries.** Do not search `.env` files. Never hardcode API keys anywhere.
3. **Limit outputs to JSON and HTML; never launch the GUI.** This headless process must complete without installing the app.
4. **Do not copy code or prose from external skills or repositories.** Adapt only the process pattern (Hub/Hero/Help, parallel gap analysis, monetization ranking); only verified MIT or Apache sources are exceptions. Keep AKARI's schema.
5. **Always investigate market-specific platform behavior.** The schema requires `target.japan_sns.notes` in `research-plan.json`. For the work's market, use the content-language pack; if free sources provide no evidence, record that fact and why. Empty or omitted notes fail validation by `validate-research-plan.mjs`.
6. **Do not edit CLAUDE.md or AGENTS.md.**
7. **Keep a complete free-only route.** If paid tools are unavailable, finish with explicitly limited evidence rather than stopping.
8. **Accept revision through chat and `plan-comments.json`.** Before presenting an approval checkpoint again, first read `<plan-dir>/plan-comments.json` if it exists; see [storyboard.md](storyboard.md) §5.
9. **Recall recipes before ideation.** Before [ideate.md](ideate.md), check `~/.akari/recipes/` for a recipe marked `workflow: "research"`, using the recall procedure in [edit-plan/recipe.md](../edit-plan/recipe.md). Present any match as a sourced suggestion; it cannot override the request or skip required research, including the platform review in rule 5.
10. **Read a declared memory connection at the same starting point.** If `.akari/connections.json` declares `memory` ([memory connection contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-25-memory-connection-v0.md)), begin with `entry` (default `INDEX.md`), read only the permitted `include`/`exclude` scope, and record consulted paths as sources in `research-plan.json` `sources[]`. Never ingest the whole tree. With no declaration, continue without error.

## Execution order and leaf files

Read only the leaf needed for the current stage; do not run later stages ahead of approval.

1. Read [ideate.md](ideate.md), classify and rank ideas, and write `topic.candidates[]`.
2. Read [competitor.md](competitor.md), research the audience and 3–5 competitors using four gap axes and the target market's platform context, and write `target`.
3. Read [trends.md](trends.md) and research trends with free sources by default. Put findings into candidate `rationale` or competitor `gap` and retain source records in `sources[]` rather than inventing a trend field.
4. Present the report and obtain the human's topic choice through `topic-select`. Wait for `completedAt` before proceeding.
5. Read [storyboard.md](storyboard.md). From the approved topic, draft a proposal, chapters in `structure.chapters[]`, and shot cards in `structure.shots[]`; add the `structure-confirm` decision card to the same report and obtain approval of the structure.
6. Read [shotlist.md](shotlist.md) and build `shot_list[]` from the confirmed storyboard.
7. Write `research-plan.json` and run `node packages/schemas/bin/validate-research-plan.mjs <パス>`. Completion requires exit 0.

## Report and approval gates

Reuse [edit-plan](../edit-plan/SKILL.md)'s decision-card mechanism. Render with `node packages/decision-cards/render-research-plan-report.mjs <research-plan.json> <research-plan-report.html>` and present with `node packages/decision-cards/report-helper.mjs <レポートパス>`. Follow [report-template.html](https://github.com/AkariLabs/akari-video/blob/main/packages/decision-cards/report-template.html) for CSP, self-contained delivery, and accessibility. The storyboard has read-only card and structure views. Keep the card data attributes, the `全部おまかせ` ("leave everything to me") choice, the required summary view, and append-only `decision_log` behavior consistent with [edit-plan/report-guide.md](../edit-plan/report-guide.md), including `byDefault`, `completedAt`, polling, and explicit chat approval if the helper fails.

The report must contain exactly these five surfaces; never omit an empty one—state the reason:

1. **Ranked ideas:** Evidence from [ideate.md](ideate.md) and the `topic-select` card.
2. **Competitor summary:** Evidence from [competitor.md](competitor.md), including platform context; no decision card.
3. **Structure timeline:** Evidence from [storyboard.md](storyboard.md) and part of `structure-confirm`.
4. **Storyboard shot cards:** Evidence from [storyboard.md](storyboard.md) and part of `structure-confirm`.
5. **Shooting checklist:** Evidence from [shotlist.md](shotlist.md); no decision card. Edit `shot_list` directly for changes and carry the state difference into the next round.

Use exactly two decision cards; the contract fixes the decision points at topic selection and structure confirmation: `topic-select` and `structure-confirm`.

- `topic-select`: Its `answer` is `{ "choice": "<topic.candidates[].id>", "requestMore": false, "note": null }`. Set `data-default="true"` on the top-ranked AI recommendation.
- `structure-confirm`: Its `answer` is `{ "chapters": [{ "id": "<structure.chapters[].id>", "adopt": true }], "openingHook": "<key>" | null }`.
- Do not pass either checkpoint until `completedAt` is non-null. After competitor and trend findings are settled, do not begin the proposal past `topic-select`; do not create the shooting list past `structure-confirm` until the respective card completes. If the helper is unavailable or decisions.json is corrupt, obtain explicit chat approval and append the exception to `decision_log`.
- Do not fill `topic.selected` or `structure.confirmed` in `research-plan.json` before approval. Copy `decided_at` and `confirmed_at` from the decision-card completion time or chat approval time.

## Deliverables

Place the output under the project's `planning/` directory.

```
planning/
├── research-plan-report.html               # 固定 5 面のレポート
├── research-plan-report.html.decisions.json
└── research-plan.json                      # 企画の SSOT。version 必須
```

- **Source record:** Put each external URL, access time, and free/paid status in `research-plan.json` `sources[]`. There is no separate trend-research field.
- **Connection to later stages:** Keep `research-plan.json` usable for post-shoot footage matching and editorial structure. Reserve `feedback` (`reserved: true`) for future post-publication learning; v0 does not implement it.

## Common mistakes

- Copying the explanatory prose of Hub/Hero/Help or four-axis gap analysis rather than expressing the pattern in your own words.
- Writing `topic.selected` before human approval or backdating `decided_at`.
- Leaving `target.japan_sns.notes` blank or saying only “omitted.”
- Calling a paid trend or search API before approval.
- Adding cards to the two review-only report surfaces—Competitor summary and Shooting checklist—and increasing the number of approval gates beyond two.
- Skipping `validate-research-plan.mjs` after writing `research-plan.json`.
