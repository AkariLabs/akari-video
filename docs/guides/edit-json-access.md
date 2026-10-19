**English** | [日本語](./edit-json-access.ja.md)

# How the agent reads edit.json

`edit.json` is the source of truth. People don't touch the JSON; they edit with the screen and the knobs.
The AI reads and writes it, so the format is chosen for the AI's grep and Edit and for git diffs.
Canonical shape: [edit.json v2 object-tree contract](../contract-2026-08-30-edit-json-v2-object-tree-v0.md) (Japanese)

## The shape of edit.json v2

- `"version": 2`. The tree is `tracks[]` (tracks) → `items[]` (items) → child `items[]` … and it is **recursive**.
  Group nesting, order, and timing all live in edit.json
- A child's `at` is an integer frame counted from its parent (the parent is 0). The order of `items[]` is z-order (later is in front)
- What an item holds is set by `source.kind` (`media`, `html` [a motion part], `telop`, `group`, `captions`, and so on).
  An empty slot (placeholder) is `source.kind: group` with `canvas.origin: plan`
- Bulky content goes in a container, and edit.json carries only structure, timing, transforms, references, and counts.
  The containers are HTML fragments, `captions.json`, and `motion/<group id>.json`
- Convert an old (v0 / v1) `edit.json` to v2 with `akari migrate [dir] [--dry-run] [--yes] [--json]`.
  By default it shows what will change, asks you to confirm, and saves the full text from before into `.akari/backup/`

## Rules for AI access (contract §5.2)

1. **Do not Read edit.json / captions.json / motion/*.json in full**. Run `grep -n '"id": "<id>"'` → Read only the matching line → Edit. To see the tree structure, read only the outer structure with a command such as `grep -n '"kind": "group"\|"items": \['`
2. Write through either (a) the edit-store script API (§6), or (b) a direct Edit of the matching line followed by save-time lint (run the write-gate equivalent through the CLI). **The lint gate must run in either case**
3. For a bulk operation (such as “shift captions after 1:00 by 0.5 seconds”), **the AI writes a script** (importing the API from §6). Do not prepare bulk-operation commands in advance
4. When writing motion, use L0 presets / the L2 animator by default (only a few values are needed). Hand-authored L1 keyframes are mainly created by a human in focus mode
5. **Do not create CLI commands for observation or surgery (`akari edit tree` / `move` / `group` …)** (owner decision, 2026-08-30. The file is the API)

## Prerequisite

`edit.json`, `captions.json`, and `motion/*.json` are saved with edit-store's canonical
serialization (contract §5.1: one record per line, beginning with `"id"`). An older file that is
not canonical becomes canonical on its next save.

## Read

Find an item with `grep -n '"id": "<id>"' edit.json`, then Read only the matching line. Read the
tree's outer structure with `grep -n '"kind": "group"\|"items": \[' edit.json`. For a caption,
use `grep -n '"id": "c-0042"' captions.json`.

## Write

- For a point change, Edit the matching line, then run `edit-lint <project>` as the save-time lint
  equivalent.
- For a bulk change, write an `@akari-video/edit-store` script that follows
  `openProject → modify → save()`. See the [README examples (Japanese)](../../packages/edit-store/README.md#例),
  [shift-captions-after.mjs](../../packages/edit-store/examples/shift-captions-after.mjs),
  [speed-up-group.mjs](../../packages/edit-store/examples/speed-up-group.mjs), and the read-only
  [tree-summary.mjs](../../packages/edit-store/examples/tree-summary.mjs).

## Inspect

Do not create a command such as `akari edit tree`. To inspect the tree with counts collapsed, run
`node packages/edit-store/examples/tree-summary.mjs <project>`.

## Keep containers small

Keep HTML split into fragments and motion split by group. Keep `captions.json` as one file. If a
container exceeds 1 MB, reconsider splitting it.

## Canonical wording (contract §5.2)

The Japanese contract is the canonical source; its wording is reproduced verbatim below.

1. **edit.json / captions.json / motion/*.json を全文 Read しない**。`grep -n '"id": "<id>"'` → 該当行だけ Read → Edit。木の構造を見たいときは `grep -n '"kind": "group"\|"items": \['` のように外枠だけ読む
2. 書き込みは (a) edit-store のスクリプト API（§6）経由、または (b) 該当行の直接 Edit + 保存時 lint（write-gate 相当を CLI で通す）。**どちらでも lint ゲートは必ず通る**
3. 一括操作（「1:00 以降の字幕を 0.5 秒ずらす」等）は**AI がスクリプトを書く**（§6 の API を import）。前もって一括コマンドを用意しない
4. 動きを書くときは L0 プリセット / L2 アニメーターを既定にする（数個の値で済む）。L1 の手打ちキーフレームは主に人間がフォーカスモードで作る
5. **観察・手術のための CLI コマンド（`akari edit tree` / `move` / `group` …）は作らない**（オーナー裁定 2026-08-30。ファイルが API）

<!-- BEGIN GENERATED facts:stamp -->
This page describes AKARI Video v1.5.1 (released 2026-10-19).
<!-- END GENERATED facts:stamp -->
