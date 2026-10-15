---
name: record-playbook
description: Record a finished AKARI Video project's workflow as planning/playbook.md and planning/playbook.json, grouping media by role and leaving external media as empty placeholders. Use when asked to save a project's way of working as a reusable playbook.
---

# Record a playbook

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write follow the language the user writes in.

## Hard rules

1. A playbook is a document and inventory, not an automatic execution engine. Follow `docs/contract-2026-10-15-playbook-v0.md`.
2. Read `edit.json` through a script, following `docs/guides/edit-json-access.md`. Do not read the entire file into agent context. Never copy source media, source paths, or the original edit into the playbook.
3. Group sources by their role. Sum the duration hints for sources serving the same role. For `own` and `site` material, write an empty placeholder without a sample. Do not put `own` or `site` items in `parts`.
4. Ask the person once for `name`, `category`, and `license` only. Use `CC0-1.0` as the proposed license. Do not ask for each step, role, setting, or part. Fill uncertain wording with `要確認` and refine it from observed evidence.
5. Keep the Markdown headings, including `## 内訳` after `## 必要な素材（仮枠）`, and the JSON schema in sync. For an existing playbook, increment `playbookVersion`. Use atomic writes.

## Procedure

1. Inspect `decisions.json`, the documents in `planning/`, and report types in `.akari/reports/` for the steps and human checkpoints. If the steps cannot be recovered, use four defaults: place media, confirm script, refine cut, export. Mark uncertain `what` text `要確認`.
2. Extract starting values from `edit.json`: aspect, fps, target duration, caption style, default transition, and audio roles. Record settings as values to start the next project, not as a copy of every cut.
3. Examine `edit.json` sources and available `analysis.json` tags or speaker observations to name placeholder roles. Use `.akari/asset-references.json` and `.akari/style-usage.json` to identify reusable parts and licenses. Keep only `builtin`, `lab`, and `ai` parts. Check used skills and recipe `requires` for required tools and skills. Derive `beats` from plan lines in `planning/script.json` when present; otherwise use chapter headings in captions or `planning/plan.md` together with visual cut boundaries. Write the `## 内訳` table in `playbook.md`.
4. Run `node skills/record-playbook/bin/record-playbook.mjs <project-root> --name <name> --category <category> [--license <license>]` from a repository checkout, or use `.claude/skills/record-playbook/bin/record-playbook.mjs` from a scaffolded project. The helper writes deterministic structure and `要確認` defaults. If a video exists in `exports/`, it uses `ffmpeg` and `ffprobe` from PATH to extract 3–5 representative PNG frames into `planning/playbook-preview/frames/` and records relative paths in `preview.frames`. `AKARI_FFMPEG` and `AKARI_FFPROBE` can override those commands. If no export or tool is available, or extraction fails, the helper warns and the outcome section says to record again after export. It clears old PNG frames before each extraction. You may review and replace frame choices while keeping 3–5 frames, the playbook aspect ratio, and a maximum long edge of 640 px. Refine the step wording and role names in both files where evidence supports better names; preserve role grouping and validate after editing with `node packages/schemas/validate-playbook.mjs <project-root>/planning/playbook.json` when the repository checkout is available.
5. Show the playbook and preview frames to the person, then run `node skills/record-playbook/bin/record-playbook.mjs <project-root> --install` if they want the reviewed files copied to their local shelf at `~/.akari/playbooks/<id>/`. This standalone install does not record again, so reviewed frame choices survive. The helper changes preview paths to `preview/frames/0N.png` in the shelf copy and replaces an existing copy only when `playbookVersion` is higher.
6. Summarize the flow, placeholder count, part count, and required tools on one screen.
