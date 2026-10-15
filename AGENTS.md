# AGENTS.md — AKARI Video

エージェント非依存の入口。リポジトリの構成・authoring 規約・検証ルールの正本は [CLAUDE.md](CLAUDE.md) にある。
**どのハーネスで作業していても、まず CLAUDE.md を読むこと**（内容はハーネス非依存）。

Node ESM のエントリポイントガードは両辺を realpath で比較する
（symlink 経由で無言終了するため）。

## スキル

このリポにはスキル（[Agent Skills オープン標準](https://agentskills.io) / SKILL.md 形式）が同梱されている。
正本は `skills/<name>/SKILL.md`。

- **ネイティブ対応ハーネス**: `.opencode/skills/`（opencode）/ `.claude/skills/`（Claude Code）/ `.cursor/skills/`（Cursor Agent）/ `.agents/skills/`（agentskills.io
  互換ハーネスの標準位置。新しめの Codex 等）/ `.codex/skills/`（Codex CLI 0.144 系の旧探索位置）に
  同一実体への symlink があり、自動発見・自動発動する
- **スキル探索非対応のハーネス**: 着手前に下の索引を確認し、タスクが description に合致したら
  **該当 SKILL.md を読み、その手順に従うこと**
- Codex のスラッシュメニューに `/prompts:<スキル名>` として出したい場合は
  `node scripts/setup-codex-prompts.mjs` を一度実行する（`~/.codex/prompts/` にスタブを生成。任意）

<!-- BEGIN GENERATED skills-index — scripts/gen-skills-index.mjs が生成。手で編集しない -->

スキル数: 28

| スキル | 発動条件（description） | 正本 |
|---|---|---|
| `address-review` | Handle open review.json annotations through actual edit.json changes, edit-lint, and ticket updates in the prescribed sequence. Use for requests such as “Address a-0002 and a-0003” or “Address all open tickets”. The consumer side of the QA loop; bin/respond.mjs atomically enforces open → addressed with mandatory response, immutable resolved tickets, and no silent dismissal. | `skills/address-review/SKILL.md` |
| `akari` | Create, open, or resume AKARI Video projects. Use when asked to make a video in a folder without `.akari/`, or to check an AKARI project's state. | `skills/akari/SKILL.md` |
| `analyze-footage` | Analyze one footage file in pull-driven levels L0–L3 and record only observed evidence in analysis.json v0. By default, run L0 metadata and L1 audio (`akari media probe` → `waveform` → `transcribe` only when speech is likely); cloud transcription requires approval. Inspect keyframes, editing events, and hooks at L2, or person tracks at L3, only when requested. Use for new footage, pre-edit analysis of one file, or footage analysis needed before edit-plan. | `skills/analyze-footage/SKILL.md` |
| `analyze-project` | Read project assets (analysis.json) together with surrounding context (intake.json, edit.json, planning/, README, and past projects), create the interpretation layer interpretation.json, and render a read-only analysis report limited to facts and readings of the material. Use to understand a multi-asset project across sources, integrate completed analyze-footage results, or identify missing primary information for interviews before choosing a direction. edit-plan reads this output before deciding direction. | `skills/analyze-project/SKILL.md` |
| `bake-3d` | Bake a 3D recipe (scene.py) to MP4 with headless Blender, verify it, and place it in the asset library or project. **The default 3D path is a Three.js overlay (overlay-authoring/3d.md).** Use this skill only for images the declarative runtime cannot produce (depth of field, motion blur, ray-traced reflections, GI, particles), to pre-bake at least three simultaneous 3D scenes down to two or fewer, or to deliver a clip to the asset library. | `skills/bake-3d/SKILL.md` |
| `beat-sync-edit` | Generate a beat-synced video timeline and overlays from a track whose BPM, downbeat, accents, and sections have been declared. Use for music-driven promos, highlights, showcases, beat-aligned cuts, or audio-reactive motion. Use declare-audio to mark a track first, and edit-plan to plan from scratch without media. | `skills/beat-sync-edit/SKILL.md` |
| `compile-review-session` | Transcribe recorded review-session audio.wav, events.jsonl, edit.snapshot.json, and session.json using analyze-footage's same 3-layer STT. Segment utterances, resolve references from the interaction trace, normalize imperative instructions, and produce open review.json annotations plus a compilation report. Use to turn spoken QA sessions into tickets, compile recorded/transcribed sessions, or explicitly recompile compiled sessions. Also triggered by requests like "レビューの録音 s-0003 を文字起こしして、コメントにまとめて" or "Transcribe review recording s-0003 and turn it into comments". | `skills/compile-review-session/SKILL.md` |
| `connect` | AKARI の道具と、実際に呼び出せる素材サービスの状態を調べる。『何が使える？』『fal の鍵を設定したい』『3D レシピを使いたい』で使う。 | `skills/connect/SKILL.md` |
| `create-project` | Create an AKARI Video project headlessly. Recursively copy `templates/project-default/`, record the template version, initialize git only when safe, and generate an HTML creation report. No app launch is needed. Use to create a video project or fill in an existing folder as an AKARI Video project. | `skills/create-project/SKILL.md` |
| `critique-cut` | Read a human-assembled edit.json and observe only the source ranges used in its timeline, then return findings without editing. This read-only skill never modifies edit.json. Use for requests such as “How does this look?”, “Look at this cut”, or “Critique the current timeline”. | `skills/critique-cut/SKILL.md` |
| `declare-audio` | Mark a track's chorus, accent hits, beat, BPM, and first downbeat by listening in the browser timeline, then save declarations.json for BGM suggestions and beat-synced editing. Use when a user wants to mark a song's chorus, improve BGM suggestions, cut to the beat, or create declarations. Use setup-audio-library to add tracks. | `skills/declare-audio/SKILL.md` |
| `design-world` | Design, inspect, and assemble a flat world that connects multiple settings and stops with a continuous camera. Use for a world-building video, a map-based video, or a transition from paper into a browser. | `skills/design-world/SKILL.md` |
| `edit-lint` | Check edit.json and optional analysis.json / captions.json / media with a deterministic CLI, then finish QA with frame inspection and reporting after PASS. Use immediately after writing or modifying edit.json, before export, and after applying review feedback. | `skills/edit-lint/SKILL.md` |
| `edit-plan` | Read the analyze-project analysis report (interpretation.json and analysis-report.html) as primary evidence, obtain explicit chat approval for direction, asset planning, and execution, then produce edit.json and overlay HTML. Use for multi-asset edit planning, planning from no media through question dialogue and a provisional plan.json timeline, or choosing cuts, BGM, SFX, and B-roll from analysis. | `skills/edit-plan/SKILL.md` |
| `export-nle` | BETA (not yet tested in actual NLEs): Export edit.json to Final Cut Pro / DaVinci Resolve (FCPXML), Premiere Pro (FCP7 XML), and SRT captions. Use for requests to open in Premiere or Final Cut, export for Resolve, or get an SRT. Always report fields that cannot transfer in dropped[]. | `skills/export-nle/SKILL.md` |
| `generate-media` | Build a timeline placeholder from still images or text cards, generate video from it, and recover or refetch generated clips. Use when asked to plan with stills, turn a placeholder into video, recover a failed generation, or establish duration with text cards. | `skills/generate-media/SKILL.md` |
| `generate-narration` | Generate narration from a script with VOICEVOX, Gemini TTS, Fish Audio, or fal Qwen3-TTS and add it to edit.json audio.narration[]. Use for a draft voiceover, final narration, a new voice profile, or replacing an existing voice or engine. | `skills/generate-narration/SKILL.md` |
| `harvest-asset` | Use to turn costly, reusable project overlays, 3D, motion, captions, thumbnail layouts, audio, and B-roll into AKARI Video library assets. Assess admission, draft meta.json, create previews, update INDEX, and validate. | `skills/harvest-asset/SKILL.md` |
| `manage-connections` | Centrally manage AKARI Video generation providers, social connections, API-key references, model selection, and cost-approval policies. Use for initial setup, connection checks, adding providers/models, and gates before paid generation or external publication. Works with `.akari/connections.json` and a free, read-only doctor. | `skills/manage-connections/SKILL.md` |
| `overlay-authoring` | Author and review AKARI Video overlay HTML, captions, tables and charts, Three.js 3D, motion graphics, thumbnails, and text-behind-person effects. Routes the work to the relevant authoring leaf. | `skills/overlay-authoring/SKILL.md` |
| `record-playbook` | Record a finished AKARI Video project's workflow as planning/playbook.md and planning/playbook.json, grouping media by role and leaving external media as empty placeholders. Use when asked to save a project's way of working as a reusable playbook. | `skills/record-playbook/SKILL.md` |
| `render-cut` | Take an approved edit.json and an edit-lint PASS through final MP4 planning, explicit approval, local export, ffprobe verification, and visual keyframe inspection. Use when the edit is approved and the user requests a delivery video or final render. | `skills/render-cut/SKILL.md` |
| `research-plan` | Run the headless video planning and research workflow from ideas through audience, competitor, and trend research to a proposal, structure, storyboard, and shot list. Use decision cards in an HTML report and decisions.json to obtain human choices for the topic and final structure. | `skills/research-plan/SKILL.md` |
| `setup-audio-library` | Use to expand the BGM and sound-effects library. Default to bulk acquisition of first-party AKARI Sounds directly from GitHub Releases, providing all BGM and jingles. Supplement only missing families (applause, failure sounds, Japanese-style impacts) with a free-source candidate HTML list and drop-folder matching or assisted acquisition. Semi-automated setup ends with keep/drop decisions in the listening gallery. A sibling of setup-library / harvest-asset, separated because audio requires a different workflow. | `skills/setup-audio-library/SKILL.md` |
| `setup-chat-approval` | Set up Telegram notifications at approval gates and return approvals with a button tap. Use doctor to assess state, guide BotFather token issuance and credentials.env registration (human actions), identify the chat ID, register the connection, and verify real-device notification and button approval. Use for requests to approve in chat, receive phone notifications, or configure a Telegram bot. Free-text instructions and agent startup are outside scope (separate contract). | `skills/setup-chat-approval/SKILL.md` |
| `setup-library` | Use for first-time AKARI Video setup or when the current project needs more usable assets. This first-run skill checks ffmpeg / whisper-cli (and can install with approval), reads the bundled catalog with akari assets to propose a starter pack, obtains explicit human approval, then acquires, places, validates, and updates INDEX entries. | `skills/setup-library/SKILL.md` |
| `setup-remote` | Set up remote access to approval reports and previews from another device such as a phone, and send footage to the workspace. Use doctor to assess Tailscale, guide installation and login (human actions), expose the preview server (default 4567) and approval report helper over tailnet-only HTTPS with tailscale serve, connect Taildrop reception to workspace inbox/, and verify access from another device. Use for requests to view reports on a phone, approve remotely, send footage from a phone, or set up remote access. Public internet exposure (funnel) is outside the default scope. | `skills/setup-remote/SKILL.md` |
| `verify` | Use to execute the L0 / L1 / L2 verification ladder required by an AKARI Video task contract on the current Theia stack. Read when acceptance criteria specify levels such as L0 or L0+L1, to determine exactly what to run and how at each level. | `skills/verify/SKILL.md` |

<!-- END GENERATED skills-index -->

索引は `scripts/gen-skills-index.mjs` が SKILL.md frontmatter から生成する（`npm run gen:skills-index`）。
手で編集しない。CI が symlink の整合と索引のドリフトを検査する（`npm run check:skills-index`）。
