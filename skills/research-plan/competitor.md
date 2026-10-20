# Research the audience and competitors

Read this file only at step 2 of [SKILL.md](SKILL.md). Produce `target`, including `audience`, `competitors[]`, and `japan_sns`. You may revisit candidates in [ideate.md](ideate.md): a gap found here may support a new topic, while a topic may guide which competitors to examine.

## 1. Define the audience

Use the request to summarize the following in one or two sentences in `target.audience`. If evidence is too thin, leave it `null`, proceed, and explain the uncertainty in the report.

- Age range and relevant audience characteristics.
- Problems they face or outcomes they want.
- Platforms on which they primarily watch videos.

## 2. Gather competitors

Find about three to five competitors in the target genre using free public evidence: channels, videos, and search results. For each entry in `target.competitors[]`, record:

- `name`: Channel or creator name.
- `url`: Public page URL. If observation was offline and no URL can be identified, use `null` and explain the source in `notes`.
- `notes`: Observable facts such as posting frequency, video length, and presentation style.
- `gap`: Findings from the four-axis comparison below.

Record each external source in `sources[]` with its URL, retrieval time, and `cost` (`free` or `paid`). Before using a paid research tool or API, pass the approval gate in [setup-connections](../setup-connections/SKILL.md).

## 3. Compare four gap axes

Compare the competitors side by side on all four axes. Describe gaps you can realistically address in `gap`. Use free text rather than a strict enum so the analysis can capture the actual differences.

1. **Topic:** Is there a perspective or audience problem competitors have not covered?
2. **Format and length:** Is there an opening for a shorter or longer format than theirs?
3. **Posting frequency:** Could your publishing cadence offer an advantage?
4. **Positioning:** Can your title or thumbnail make a different promise?

For an axis with no meaningful gap, write "no difference" rather than leaving it blank. Do not invent an advantage.

## 4. Market-specific platform context (required research axis)

See lang/<content-language>.md. Populate the required `target.japan_sns` field with `platforms` and `notes`; if free sources yield no evidence, explain why in `notes`. Empty or omitted notes fail validate-research-plan.mjs. Paid tools remain subject to [setup-connections](../setup-connections/SKILL.md).

## Common mistakes

- Calling a comparison with one competitor a gap analysis.
- Covering only convenient axes and omitting the rest.
- Leaving `japan_sns.notes` as "under investigation" and moving on.
- Calling a paid social-listening API before approval.
- Guessing the URL of a competitor that could not be found.
