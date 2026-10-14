# Approval and generation governance

## Principle

Before generation, ensure the human understands what will be done, how, and why; this takes precedence over speed. Make a recommendation, but do not silently default among multiple choices.

## Decision Communication Contract

Before paid or heavy generation, declare the following in conversation (write the labels in the user's language, following the language pack; see SKILL.md).

```text
対象:
使う手:
理由:
代替案と得失:
費用・待ち時間・外部送信などの影響:
実行後に残す provenance:
```

For **paid generation or external transmission**, do not execute after merely declaring it; wait for an answer. For free local generation, write the declaration in `decision-log.md` and proceed (in `collaborative`, still wait for an answer). Even when the contract already approves creating a still, declare the method and reason and append them to `decision-log.md`. Before switching methods after failure, append the reason and tradeoffs.

## Method priority and prohibitions

1. Use Codex image generation and save the image file in the project.
2. If Codex cannot execute or is unsuitable, explain why and use Akari Cloud API / MCP from the agent layer.
3. If neither works or quality or rights are insufficient, use a real frame via route A or mark the asset "do not use" in the user's language (Japanese form: `使わない`).

Do not use OpenAI, Gemini, or other API keys directly. Do not request keys, search for them in `.env`, or implement generation communication in the app. The priority order does not authorize silent fallback.

### Verified operation of method 1 (Codex image generation)

**Measured on 2026-07-14**: actual image-file generation was verified with `codex-cli 0.144.1` (ChatGPT authentication).

- Invocation: `cd` to the working directory, then run `codex exec --skip-git-repo-check "<プロンプト>"` in the foreground (the Japanese placeholder means prompt). Avoid background execution: a known issue makes it return immediately without waiting for generation. Standard macOS lacks `timeout` / `gtimeout`; use the calling tool's timeout instead (about 600 seconds).
- Preflight: `codex features list` reports `image_generation` as `stable / true`; `codex doctor` shows working ChatGPT authentication and websocket connection.
- Measured result: For the Japanese prompt "Generate a 16:9 video-thumbnail background image, dark tech tone, abstract gradient and light streaks, no text, saved as bg-test.png," a 1664×936 (16:9) PNG of 1.7 MB was written in **93 seconds**. Visual inspection confirmed no text, logo, or UI. The Japanese instructions, requested filename, and aspect ratio were all followed.
- Known failure mode: when the ChatGPT account reaches its usage limit, every turn, not only image generation, fails immediately with a `usage limit` error (recover after the limit resets or by changing plans). Record the projected recovery time from the error in the completion report.
- After generation, always record provenance: method = codex exec, model or tool version, prompt, and ISO 8601 time.

## provenance

For each generated asset, make the following traceable from the chat presentation and `decision-log.md`:

- Asset ID and type.
- Method used and model / tool version if known.
- Prompt and reference assets.
- ISO 8601 generation time.
- Output file and preview shown in chat.
- Fallback, processing, i2v, and later stages.
- Corresponding approval record.

For real frames, record source, source time, and extraction method instead of a generation prompt. Record background generation and HTML typography as separate stages for a hybrid.

## Three-stage checkpoints (when autonomy is collaborative / Japanese UI: `一緒に作る`)

The contractual checkpoint count is `3` for `autonomy: collaborative` ("create together"; Japanese UI label `一緒に作る`; fixed by M5). `checkpoint` ("with suggestions"; Japanese UI label `提案つき`) and `full-auto` ("as requested"; Japanese UI label `そのまま`) have zero; the shell's Export button holds the export authorization (one authorization, contract 2026-09-06). **2026-07-22 revision**: Decision cards (`<レポートパス>.decisions.json` plus helper), formerly Checkpoint 1's response channel, were retired when edit-plan's report generation moved to analyze-project. All three checkpoints now use **explicit chat approval**; the only formal report is analyze-project's analysis report, while direction is developed in chat. Immediately after appending to `decision-log.md` at each checkpoint, regenerate the decision-record report and present its path ([report-guide §decision_log](report-guide.md#decision_log)). `full-auto` and `checkpoint` do not go through this section's checkpoints ([autonomy.md](autonomy.md)).

### Checkpoint 1: Direction

Using the [analyze-project](../analyze-project/SKILL.md) analysis report as evidence, present thumbnail ideas, edit direction, and cut proposals in chat, with each option's tradeoffs (recommendation + alternatives + reasons; do not leave the choice at "What would you like?"). When the human explicitly answers for this direction, append the decision to `decision-log.md`; if revision is requested, present it again in chat. Do not settle the asset plan before approval.

**Editing execution gate**: Do not settle the asset plan or proceed to [execution.md](execution.md) until explicit chat approval arrives. Do not interpret inaction, timeout, or past blanket approval as current approval.

### Checkpoint 2: Asset plan

Under the approved direction, present three-way choices for BGM and scene assets, still previews, and provenance. Stop here and wait for an explicit answer. Do not run i2v, avatar, or video B-roll generation without approval of the corresponding still.

### Checkpoint 3: Execution

Present the following as a manifest:

- Output width / height / fps.
- Sources and keep ranges.
- Multi-asset handling: v2 `sources[]` plus media items, or conform to one intermediate master.
- Planned generation, conform, and audio/B-roll baking.
- Overlays and their timing.
- Files to create and effects on existing files.

Proceed to [execution.md](execution.md) only after the human explicitly approves the manifest. Asset-plan approval is not execution approval.

To send an approved image to i2v, verify all three: approval of that image, asset-plan approval, and execution-manifest approval. Never reduce collaborative's three checkpoints because of inactivity or timeout.

## Receive revisions through plan-comments.json

Before preparing a revised Checkpoint 2 or 3 presentation, check for `<plan-dir>/plan-comments.json` (**read this file before interpreting the chat response**). It follows the same convention as `structure-confirm` in `research-plan/storyboard.md`; the canonical contract is [contract-2026-07-25-plan-comments-v0.md](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-25-plan-comments-v0.md).

- If `plan-comments.json` has `pass: "scaffold"`, treat it as a Checkpoint 2 (asset-plan) revision and revise **only** clips named by `comments[].target_kind: "clip"` (`target_id` is an edit.json v2 item id). The old `target_kind: "slot"` is retired.
- If `plan-comments.json` has `pass: "final"`, treat it as a Checkpoint 3 (execution) revision and revise **only** clips named by `comments[].target_kind: "cut"` (`target_id` is a v2 item id).
- In both cases, keep unnamed clips/cuts unchanged for the next presentation. After revision, **delete `plan-comments.json`** before presenting the updated content again.
- If the file is absent, interpret only chat revision instructions as before.

## Common mistakes

- Requesting chat approval for direction in checkpoint mode (autonomy.md §3).
- Skipping the pre-generation declaration because Codex is the preferred method.
- Showing only the recommendation and hiding alternatives' benefits and drawbacks.
- Starting i2v with image approval alone.
- Reusing a previous project's approval.
- Failing to record the post-fallback method and prompt in provenance.
- Treating inaction or silence as approval and moving on without explicit chat approval.
