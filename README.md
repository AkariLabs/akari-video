# AKARI Video

AI 動画編集ツール。開いたらほぼ終わっていて、直したいところだけ直せる。

**Status: under construction**（Theia ベースのシェルへ移行中。旧 Tauri 実装は
[akari-video-tauri](https://github.com/AkariLabs/akari-video-tauri) に保存）

## Layout

- `apps/shell/` — Theia-based desktop shell
- `packages/` — shell-independent libraries (schemas, preview engine, surface runtime, `akari-launcher`)
- `plugin/` — Claude Code plugin bundle (skill pack + SessionStart hook + `/akari`)
- `skills/` — agent-side stage skills
- `templates/` — project scaffolds
- `catalog/` — curated add-on catalog (reference distribution only)
- `docs/` — design docs

## Install / 3 つの入口

UI が無くても、Claude Code 単体・どのディレクトリからでも始められる。3 つの入口は
すべて同じファイル契約（`.akari/connections.json` / `.akari/intake.json`）に収束する。

| 入口 | 実体 | 発動方法 |
|---|---|---|
| ターミナル | `packages/akari-launcher`（bin: `akari` / npm パッケージ名: `akari-video`） | `akari`（現状: `node packages/akari-launcher/bin/akari.mjs`。npm publish は未実施） |
| セッション内 | `plugin/` の `/akari` スラッシュコマンド・SessionStart hook | Claude Code セッション内で `/akari`、または発話で `create-project` スキルを発動 |
| アプリ | Theia シェルの接続ボタン | アプリの「はじめる」画面から接続 |

詳細は `packages/akari-launcher/README.md`（ランチャー）・`plugin/README.md`
（プラグイン）を参照。
