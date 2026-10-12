# Generate and rank topic candidates

Read this file only at step 1 of [SKILL.md](SKILL.md). Produce `topic.candidates[]` in ranked order, with the strongest candidate first. Fill `topic.selected` and `topic.decided_at` only after the `topic-select` decision card is confirmed.

## 0. Recall a recipe before proposing candidates

Before generating candidates, check `~/.akari/recipes/` using the recall procedure in [edit-plan/recipe.md](../edit-plan/recipe.md). Consider only recipes marked `workflow: "research"`. If none exists, proceed normally without an error. If one exists, present its `confirmed` values, such as `target_duration_band`, `aspect`, and `overlay_kinds`, as sourced recommendations in chat. **Do not let a recipe override this request** or skip candidate generation, competitor research, or the required review of Japanese social platforms. Apply the corresponding fields together only when the person explicitly asks to reuse the previous setup, for example by saying "same as last time."

## 1. Propose candidates

Propose several topics, normally 3–7, based on the request, the channel's existing direction, and any findings already available from [competitor.md](competitor.md) or [trends.md](trends.md). Do not settle on zero or one candidate. Distinguish an inference from the request from a researched finding; never call an unsupported candidate "researched."

Record these fields for each candidate:

- `id`: A short identifier unique among the candidates.
- `title`: A working video title.
- `category`: The classification described below.
- `monetization_potential`: `high`, `medium`, or `low`.
- `rationale`: The reasons for the classification and monetization assessment. Include any trend finding used as evidence and record its source in `sources[]`.

## 2. Classify as Hub, Hero, or Help

Use these three common channel-planning categories:

- **Hub:** A recurring format that builds a relationship with viewers. An individual installment need not generate much revenue.
- **Hero:** A distinctive event or concept intended to attract attention and spread widely. It can bring a surge of new viewers, but is hard to repeat.
- **Help:** A searchable answer to a specific problem. It can attract viewers over a longer period.

Check the balance among the three categories. If the existing channel lacks one, note that in `rationale`. If every proposed topic falls into the same category, record why instead of proceeding silently.

## 3. Rank by monetization potential

Assess `monetization_potential` using the factors below, and explain in `rationale` which factors mattered most. There is no strict formula: v0 produces an estimated ranking without linking actual performance data.

- Fit with advertisers or products, including review and affiliate opportunities.
- Longevity: whether interest is seasonal or fleeting, or remains useful year-round.
- Return relative to production effort, including recording and generation costs.
- Fit with the channel's existing videos and subscriber audience.

Represent ranking by the order of `topic.candidates[]`; there is no `rank` field. Put the strongest candidate first, and render the report's ranked topic table in the same order.

## 4. Wait for approval before selecting a topic

Do not write `topic.selected` or `topic.decided_at` until the `topic-select` card in [SKILL.md](SKILL.md) is complete: `completedAt` is non-null, or explicit chat approval has been received. Mark the first, AI-recommended candidate with `data-default="true"` on the selection card, then record the person's actual choice.

## Common mistakes

- Offering a single candidate and treating it as approved.
- Assigning Hub, Hero, or Help without explaining the classification.
- Choosing `monetization_potential` by intuition alone without evidence in `rationale`.
- Temporarily filling `topic.selected` before approval and changing it afterward, which defeats the approval gate.
