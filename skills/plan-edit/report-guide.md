# Editing decisions — Read the analysis report and decide direction in chat

The library defaults to workspace `library/`. Without a workspace, use the legacy `~/.akari/assets/`. Check its actual location on the first line of `akari-assets list` (or `akari assets list`). Below, `<ライブラリの置き場>` is the displayed location (the Japanese placeholder means library location); audio lives under its `audio/` directory.

> **2026-07-22 revision (reduced scope)**: This skill no longer generates its own fixed six-chapter editing decision report (`editing-report.html` plus decision cards). Under the owner's 2026-07-22 ruling, the analysis report is the only formal report and direction is developed entirely in chat. The [analyze-project](../analyze-project/SKILL.md) analysis report (read-only, without a decision UI) provides facts and interpretation of assets. plan-edit reads it as primary evidence and presents direction, asset-plan, and execution decisions in chat for explicit human approval.
>
> Unchanged: **decision_log recording conventions** ([decision_log](#decision_log); only the location moved to standalone `decision-log.md`), **the practical cut-decision list and three-way asset plan** ([Cut decision list](#cut-decision-list) and [Asset plan](#asset-plan)), and **the three-stage checkpoints** ([approvals-and-generation.md](approvals-and-generation.md)). Only the presentation format changed, from one HTML report to chat. Recording duties, evidence, and approval-gate rigor have not weakened.

## Contents

- [Read the analysis report](#read-the-analysis-report)
- [Decide direction in chat](#decide-direction-in-chat)
- [Thumbnail ideas](#thumbnail-ideas)
- [Cut decision list](#cut-decision-list)
- [Asset plan](#asset-plan)
- [decision_log](#decision_log)
- [Generic card mechanism (specification used by other skills)](#generic-card-mechanism-specification-used-by-other-skills)
- [Safety for self-contained HTML](#safety-for-self-contained-html)
- [Common mistakes](#common-mistakes)

## Read the analysis report

Read `analysis-report.html`, created by [analyze-project](../analyze-project/SKILL.md) from `interpretation.json` and each asset's `analysis.json`, as primary evidence. If the report is absent or omits target assets, request analyze-project first (it is a separate skill, not part of plan-edit).

The report's facts, asset interpretations, objective relationships, interview ledger, and provenance may be cited directly. **The proposed arc is not displayed** in the analysis report (it exists in `interpretation.json` but is deliberately hidden as a seed for the dialogue phase by analyze-project design). plan-edit develops edit direction and structure in chat from here onward.

## Decide direction in chat

For thumbnail ideas, cut intensity, caption policy, chapter inclusion, and opening hook, present **a recommendation + alternatives + the benefits, drawbacks, and losses of each + the reason for recommending one** in chat, grounded in the analysis report, and obtain an explicit human answer. Do not ask only "What would you like?"; make a recommendation and request approval, revision, or rejection. Follow the report-writing section of the language pack (see SKILL.md).

**Keep the boundary between decision level and operation level** previously used on cards: do not list word-level cut accept/reject choices or caption segments in chat or reports. Those belong in the app viewer. This boundary is an invariant in the addendum to [notes-2026-07-14](https://github.com/AkariLabs/akari-video/blob/main/docs/notes-2026-07-14-captions-and-cut-editing.md).

Treat chat presentation and response as Checkpoint 1 (direction) under [approvals-and-generation.md](approvals-and-generation.md), and append the settled outcome to `decision-log.md` under the [decision_log](#decision_log) convention.

After semantic keep/drop and source occurrence order are approved at Checkpoint 1, use [workflow.md](workflow.md)'s cut candidate bridge for additional review if conversational pauses need shortening. The report shows filler/trouble from `analysis.json` and silence at or below -35 dB lasting at least 0.45 seconds, fully inside approved occurrences. Do not auto-accept candidates. A human must particularly inspect `UI_WAIT_UNRESOLVED`, `INFORMATION_RETENTION_REVIEW`, and `PARTIAL_EVENT_OCCURRENCE`; a screen keyframe alone does not resolve a UI wait. Do not run pause detection on sources with incomplete word times.

## Thumbnail ideas

Make candidate images through three routes (real frame / Codex generation / hybrid) and compare them in chat.

- **Route A**: Visually checked real frame plus HTML typography under [thumbnail authoring](../author-overlay/thumbnail.md). Record source and time.
- **Route B**: Codex image generation. Record method, prompt, and generation time.
- **Hybrid**: Make the background with B and add a title using A's HTML typography. For Japanese title composition, follow the language pack (see SKILL.md). Keep the two stages' provenance separate.

If possible, compare at least one candidate from each of the three routes. If B or hybrid is unavailable, do not insert fictional images; present multiple A candidates and explain unavailability. The `3` is the comparison count from the M5 contract's two routes plus hybrid, not a platform success threshold.

If the parent task scopes only some of A/B/hybrid, distinguish **not performed** from **unavailable** in the record. Use "unavailable" when a route was attempted but could not run; use "not performed (out of scope)" when the parent task excluded it from the outset. Later stages must be able to tell a failed attempt from a route never requested.

For an excluded route, retain the comparison slot in chat but replace any image with one line, `未実施（スコープ外: <上位タスクが指定した範囲の要約>）` in Japanese (not performed; the placeholder summarizes the parent task's scope). In `decision-log.md`, key the excluded route as `(thumbnail, route-a)` / `(thumbnail, route-b)` / `(thumbnail, route-mixed)`, set the decision to "not performed (out of scope)" in the user's language (Japanese form: `未実施（スコープ外）`), and use the parent task's instruction or its summary as the reason.

Before image generation, make the declaration required by [approvals-and-generation.md](approvals-and-generation.md).

## Cut decision list

Each row must contain the asset ID, source `start/end`, `keep` or `drop`, supporting event, evidence anchor, and reason. Keep ranges must be ascending and non-overlapping per source. Do not mix post-cut timeline times with source times. This list contains decision-level keep/drop choices; operate on word-level choices in the app.

The list both supports chat presentation and serves as direct primary evidence for constructing v2 visual media items. Record it under the `cut` category in `decision-log.md` (one row per interval, or a summary with details saved separately as an output). For trailers, opening hooks, and other extracted or moved-ahead clips, **do not leave `source.in/out` at a machine window around the highlight score; snap to speech inside the clip and preserve 0.5s of breathing room** (see [execution.md](execution.md) §2 for speech-snapping rules).

## Asset plan

Separate global and scene-level slots.

- **Global**: BGM (whole-video bed) and captions (full-caption policy). Address purpose, entrance and exit, license, or generation feasibility.
- **Per scene**: Audio clips (SFX and partial music), B-roll, text-overlay style, and special expression. Identify target scene and time. Music used for only part of a scene also belongs here (as an `audio.sfx[]` clip; see music placement in [execution.md](execution.md) §1).

**The caption slot covers policy only** (do not put segment-level content lists in chat or reports; review and edit them in the app's caption list and contenteditable). Present and decide these caption-policy points in chat:

- Whether to use captions, omit them, or use them selectively at important points, with reasons.
- Style: placement, line count, approximate characters per line, background and text colors. Follow telop.md's caption principles and the language pack (see SKILL.md) for content-language typography.
- **Dependence on cuts**: Captions follow the post-cut timeline; speech removed by a cut loses its caption. Do not change a cut for a caption; if needed, treat it as a revision to the cut decision.
- Long-text splitting and duration apportionment (prefer word timestamps if available). **Match display intervals to actual speech, never tile segment boundaries**: gaps stay empty, and captions end when speech ends. See [execution.md](execution.md) §4 for interval creation.
- Correction workflow: correct raw ASR errors in the app (explicitly state if future agent cleanup is out of scope).
- Whether to use karaoke display or emphasis pops (default: neither).

Each slot must state **one** of the following three choices. The `3` comes from the M5 contract's decision options, not an operational estimate.

1. **Propose if available**: Show actual library hits, rights conditions, and a preview image or listening reference. Search every scope layer from nearest to farthest (project `assets/` → parent directory `.akari/assets/` → `<ライブラリの置き場>/` → product repository `assets/` → `catalog/`), and identify the hit's layer in the proposal. For duplicate ids, use the nearer layer.
2. **Generate if absent**: Show prompt, generation method, generated still preview, and provenance. For video B-roll, first create only a still.
3. **Do not use**: Do not fill the slot artificially; explain why it was rejected.

**The automated suggestion CLI is the default starting point for "propose if available" BGM** (introduced 2026-08-03; the default BGM source is the first-party AKARI Sounds library, [catalog/audio/INDEX.md](https://github.com/AkariLabs/akari-video/blob/main/catalog/audio/INDEX.md)):

```sh
node packages/audio-library-setup/bin/suggest-bgm.mjs --from-decision-log <プロジェクト>/decision-log.md [--json]
```

- Use the approved content tone (the same eight fixed vocabulary values as expression selection: `真面目` / `親しみ` / `高級感` / `勢い` / `かわいい` / `無機質` / `エモい` / `シネマ`; specify several for a compound tone). Pass the latest `(direction, tone)` row of `decision-log.md` through `--from-decision-log` unchanged. Only for a temporary human override, add `--tone <トーン>` (multiple allowed) or `--tempo ゆったり|標準|高速`; these explicit options take priority over the decision log. The output `path` is a local asset under `<ライブラリの置き場>/audio/akari-sounds-bgm/` and can be written directly to `audio.bgm.path`. **If AKARI Sounds is not installed (`akari sounds` has not run), the CLI gives instructions**; then prompt for installation or switch to the former manual search.
- This goes **only as far as presenting candidates**. Present top candidates with listening references; adoption is decided by Checkpoint 2 approval (do not write automated suggestions to `edit.json` without approval). Identify the candidate number N from suggest-bgm, its tone, and evidence. Record one line explaining any switch to another candidate or manual selection.
- When ear-verified declarations are available (an installed declaration pack, `--declarations`, or env `AKARI_SOUNDS_DECLARATIONS`), declared tracks appear first with **a chorus-start recommendation in seconds (directly usable as `audio.bgm.in`)**, measured BPM, and song structure (intro/chorus/outro). Use it when the music should start at the chorus or align to a highlight.
  - If a track has no declaration and the user wants to start at the chorus, explain that they can mark it with [analyze-music](../analyze-music/SKILL.md) (1–2 minutes per track in the UI; the declaration affects all later suggestions).
- Only when AKARI Sounds has no suitable family (no match or an unusual tone), expand to the former scope-layer search and external supplements (`catalog/audio/` SFX supplements and candidate lists).

**Retrieve "propose if available" SFX and jingles by scene meaning** (unlike BGM tone, SFX is event-level; vocabulary is fixed at 14 terms, listed by `--list`):

```sh
node packages/audio-library-setup/bin/suggest-sfx.mjs --meaning 場面転換 [--json]
```

- Candidate order is priority order (the `MEANING_RULES` declaration table in `shared/sfx-suggest.mjs`). Meanings absent from AKARI Sounds (applause, conventional Japanese failure sounds, and Japanese drums) fall back honestly to external supplements (remaining `catalog/audio/` entries), which show whether they have been acquired. Do not invent a row; borrow the nearest existing meaning and record why.
- Output `duration_sec` feeds trigger-timing design in [beat-sync.md](beat-sync.md). Adoption still requires Checkpoint 2 approval.

Do not record "propose if available" when no candidate was found. BGM / SFX / B-roll fit in v2 `sources[]` + `tracks[].items[]` ([execution.md](execution.md) §1). Only for an effect no public-contract field can represent, present plan adoption separately from `edit.json` storage feasibility. Baking into one intermediate master requires execution approval.

When an avatar narrates, follow persona injection (incorporate the persona summary and respect prohibited content) in [avatar-resolution.md](avatar-resolution.md#connection-to-script-generation-persona-injection-s2-details) before writing the script.

Treat this chat presentation as Checkpoint 2 (asset plan) under [approvals-and-generation.md](approvals-and-generation.md), and record the settled outcome in the `material` category of `decision-log.md`.

## decision_log

Append chronologically, keyed by `(category, subject)`. Each row carries ISO 8601 time, category, subject, decision, reason, decider, and related checkpoint. If a decision for the same key changes, never revise the old row; append a new one referencing the earlier decision. Write decision and reason cell contents in the user's language. For a new `decision-log.md`, use the exact header for the user's language:

- English: `| Time | category | subject | Decision | Reason | Decided by | Related checkpoint |`
- Japanese: `| 日時 | category | subject | 決定 | 理由 | 決定者 | 関連 checkpoint |`

When appending to an existing file, preserve its header language and append rows beneath that header. Do not translate or replace existing headers or rows.

**Location** (2026-07-22 revision): Embedding this as a section of fixed six-chapter HTML is retired. Append to standalone `decision-log.md` directly under the project. This single SSOT is shared with [analyze-project's decision-record.md](../analyze-project/decision-record.md): analyze-project pass-2 decisions and interview Q&A accumulate chronologically with plan-edit approvals and generation decisions. Field structure and append-only discipline are unchanged.

**Derived rendering (2026-08-27)**: Immediately after appending, run the following CLI to regenerate the decision-record report. The HTML is a derived artifact, must not be hand-edited, and has no decision UI; `decision-log.md` remains the SSOT. The output appears automatically in the general-mode report list.

```sh
node packages/decision-log-report/render-decision-log-report.mjs --log <project>/decision-log.md --out <project>/.akari/reports/decision-log-report.html
```

### Machine-readable direction row

Only in the `(category, subject) = (direction, tone)` row, put one inline-code JSON object at the start of the decision cell. `tone` is an array of one or more of the eight shared expression-selection vocabulary values; optional `tempo` is one of `ゆったり` / `標準` / `高速` (fixed machine-read values). Free-form explanatory text may follow the JSON after a space. When updating the same key, keep past rows unchanged; the last appended row takes effect.

```markdown
| Time | category | subject | Decision | Reason | Decided by | Related checkpoint |
|---|---|---|---|---|---|---|
| 2026-08-05T10:00:00+09:00 | direction | tone | `{"tone":["勢い"],"tempo":"高速"}` Keep the pace energetic | To engage viewers from the opening | Owner | Checkpoint 1 |
```

Record the following as decisions:

- Approvals, rejections, and revision requests for direction, asset plan, and execution.
- Generation-method selection and fallback.
- Explicit rejection, including "do not use" in the user's language (Japanese form: `使わない`).
- Source-structure choice (v1 multi-source / v0 single source / conform to an intermediate master).
- CLAUDE.md fallback when author-overlay is absent.
- Thumbnail routes A/B/hybrid left unperformed due to parent-task scope.
- Settled direction from chat, including whether it followed the recommendation or was revised; record the difference.

The decider column may use `machine:director` for machine-written prediction rows. Append one `category = proposal` prediction row per added item in the same turn as putting it on the timeline ([autonomy.md](autonomy.md) §3-(4)). Subject is an item id or caption id; the decision says what was added; the reason says why it is useful and cites an `analysis.json` location or akari.md line; the related checkpoint cell gives the source asset id and means. Do not write a prediction row for an item directly requested. Missing prediction rows yield only a warning. At export time the machine appends outcome rows for human deletion, revision, or unchanged export. Never change or delete existing rows.

| Time | category | subject | Decision | Reason | Decided by | Related checkpoint |
|---|---|---|---|---|---|---|
| 2026-09-06T10:00:00+09:00 | proposal | diagram-01 | Added a diagram of the process | Makes the three stages described in analysis.json transcript[3] easier to compare; follows the diagram row in akari.md's procurement preferences | machine:director | source-01 / HTML overlay |

## Generic card mechanism (specification used by other skills)

This is the generic card mechanism for multiple-choice dialogue. **plan-edit must not use it for its own direction decisions** (decide direction in chat, as above). [plan-video](../plan-video/SKILL.md) candidate cards and [plan-json.md](plan-json.md) question dialogue for planning from zero media still use it; therefore retain this specification as their SSOT.

### Card data attributes

Follow [report-template.html](https://github.com/AkariLabs/akari-video/blob/main/packages/decision-cards/report-template.html) for the card DOM. The runtime (JS injected by the helper) interprets only these data attributes to build the UI. Do not hard-code card types.

| Attribute | Element | Meaning |
|---|---|---|
| `data-card="<id>"` | Card container | One decision; id matches decisions[].id |
| `data-question="<文>"` | Card container | Question text, used in the summary view |
| `data-option="<key>"` | Option element | Single-choice option |
| `data-default="true"` | Option element | AI recommendation (initial selection); exactly one per card |
| `data-check="<key>"` | Checkbox element | Optional additional multiple choice |
| `data-note` | textarea or similar | Optional free-form entry |
| `data-action="accept-all"` | Button | Go to summary with every card at its default |
| `data-action="commit"` | Button | Confirm and fill completedAt |
| `data-view="summary"` | Container | Summary view of confirmed choices |

- Other appearance and structure may use arbitrary HTML. The engine interprets only data attributes.
- Put rationale, evidence, and detail in collapsible `<details>`; leave only the question and options on the card face.

### decisions.json template

Skills using cards must also write a `<レポートパス>.decisions.json` template paired with the report (the Japanese placeholder means report path). Set every card's `answer` to the AI-recommended default, `byDefault: true` / `answeredAt: null`, and top-level `completedAt: null`.

```jsonc
{
  "version": 0,
  "report": "<レポートへの相対パス>",
  "createdAt": "<ISO8601>",
  "completedAt": null,
  "decisions": [
    { "id": "<data-card と一致>", "answer": { }, "byDefault": true, "answeredAt": null }
  ]
}
```

- The consuming skill declares the shape of `answer` per card type (HTML and the decisions template are the SSOT).
- The helper updates `answer` / `byDefault: false` / `answeredAt` after human action. Do not overwrite the template; add a report + decisions pair for each round.
- If decisions.json is absent or corrupt, the consuming skill substitutes explicit chat approval.

### Accept-all and summary view

An "accept all defaults" button (`data-action="accept-all"`) and summary view (`data-view="summary"`) are mandatory. Even when accepting all defaults, starting immediately is forbidden. Always show one summary screen before confirmation. On commit, the helper writes `completedAt`, after which the consuming skill may proceed.

## Safety for self-contained HTML

When plan-edit creates self-contained HTML, such as a thumbnail candidate sheet, follow these rules:

- Include CSS, images, and evidentiary transcript in the HTML; do not reference external CSS, fonts, scripts, or remote images.
- Embed real frames and generated images as `data:image/...;base64,...`, with meaningful `alt` text.
- Escape transcript, observations, titles, prompts, and paths for their context. Do not insert unvalidated HTML, `javascript:` URLs, or event handlers.
- Do not convey state by color alone; display "unapproved," "approved," and "rejected" in the user's language as text (Japanese forms: `未承認`, `承認`, `却下`).

## Common mistakes

- Building a direction without the analyze-project analysis report, producing unsupported recommendations.
- Inventing a preview without a real library hit.
- Keeping the prompt for a generated image but omitting method or time.
- Overwriting old `decision-log.md` rows with the latest judgment.
- Referencing a remote image while presenting the artifact as self-contained.
- Labeling an out-of-scope, unperformed route as "unavailable," suggesting a failed attempt.
- Listing word-level cut choices or caption segments in chat, violating the decision/operation boundary.
- Asking only "What would you like?" without a recommendation, alternatives, and reasons.
