# AKARI Video

AI 動画編集ツール。開いたらほぼ終わっていて、直したいところだけ直せる。

**Status: under construction**（Theia ベースのシェルへ移行中。旧 Tauri 実装は
[akari-video-tauri](https://github.com/akari-video/akari-video-tauri) に保存）

## Layout

- `apps/shell/` — Theia-based desktop shell
- `packages/` — shell-independent libraries (schemas, preview engine, surface runtime)
- `skills/` — agent-side stage skills
- `templates/` — project scaffolds
- `catalog/` — curated add-on catalog (reference distribution only)
- `docs/` — design docs
