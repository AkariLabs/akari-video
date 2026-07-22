# @akari-video/audio-library-setup

音源（BGM/SFX）初回セットアップの半自動ドロップフォルダ方式を実装する v0 ツール群。
外部 npm 依存ゼロ（Node.js 組み込みモジュールのみ、`packages/decision-cards` /
`packages/intake-form` と同じ流儀）。詳細な運用手順は
[`skills/setup-audio-library/`](../../skills/setup-audio-library/SKILL.md) を参照。

## 構成

| ファイル | 役割 |
|---|---|
| `lib/candidates.mjs` | `catalog/audio/candidates.json` の読み込み・ファイル名マッチング・既所有（ownership）判定・meta.json 組み立てを行う共有ロジック |
| `bin/generate-candidates-html.mjs` | 候補リストの静的自己完結 HTML を生成する CLI。ダウンロードは一切行わない |
| `bin/register-drop-folder.mjs` | ドロップフォルダを走査し、候補と照合して `~/.akari-video/assets/audio/<id>/`（user スコープ）へ実体配置 + `catalog/audio/<id>/meta.json`（remote 参照）を書く CLI。既定は plan-only、`--apply` で実行 |
| `gallery-server.mjs` + `gallery-template.html` | 登録済み音源の試聴 + keep/drop を記録するローカル HTTP サーバ（`127.0.0.1` のみ） |
| `bin/gallery-helper.mjs` | 試聴ギャラリーの起動 CLI |
| `test/*.test.mjs` | `node --test` によるユニット/統合テスト（`mkdtemp` で隔離、本リポや実ホームディレクトリには書き込まない） |

## ハードルール（詳細は SKILL.md）

- 実サイトからの自動・一括ダウンロードは実装しない。取得は常にユーザーの手動クリック
- リンクは必ずダウンロードページ URL（音声ファイルへの直リンク禁止）
- 音声実体は本リポにコミットしない（常にリポジトリ外の user スコープへ配置）
- `ai_training_allowed` は明示許可がない限り `false`

## 使い方

```sh
# 候補リスト HTML を生成
node packages/audio-library-setup/bin/generate-candidates-html.mjs

# ドロップフォルダを確認だけする（既定・安全）
node packages/audio-library-setup/bin/register-drop-folder.mjs \
  --drop-dir ~/.config/akari-video/audio-drop

# 実際に登録する
node packages/audio-library-setup/bin/register-drop-folder.mjs \
  --drop-dir ~/.config/akari-video/audio-drop --apply

# 試聴ギャラリーを起動
node packages/audio-library-setup/bin/gallery-helper.mjs \
  --library-root ~/.akari-video/assets/audio
```

## テスト

```sh
node --test packages/audio-library-setup/test/*.mjs
```

## 実装ノート

- 依存ゼロ・Node.js 組み込みモジュール（`node:http` / `node:fs` / `node:path` /
  `node:child_process` / `node:crypto`）のみ
- ドロップフォルダ登録は plan-only が既定。`--apply` を渡すまでファイルもカタログも
  一切変更しない
- 「既所有」判定は毎回 `catalog/audio/*/meta.json` を動的に読んで計算する
  （候補 id をハードコードしたリストに依存しない設計。audio-import 等、他レーンの
  登録が増えても再実行するだけで反映される）
- ギャラリーの状態書き込みは一時ファイル + `rename` によるアトミック置換
  （decision-cards / intake-form と同じ安全策）
