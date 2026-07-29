---
name: create-project
description: AKARI Video の新規プロジェクトを headless で作成する。`templates/project-default/` を再帰コピーし、雛形バージョンを記録し、安全な場合のみ git 初期化して、作成結果レポート HTML を生成する。アプリ起動は不要。新しい動画プロジェクトを作るとき、または既存フォルダを AKARI Video プロジェクトとして補完するときに使う。
---

# 新規プロジェクトを作成する

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

## ハードルール

1. **雛形は解決順の 2 択のみ。** 存在しない雛形・カテゴリを捏造しない
2. **既存ファイルを絶対に上書きしない**（`flag:'wx'`。既存フォルダへの適用は不足分の追加のみ、
   CLAUDE.md / AGENTS.md には触れない — 自己完結契約 §5 と同じ規律）
3. **シンボリックリンクはコピーせず警告**
4. **F18 ガードを内蔵する**: 作成先で `git rev-parse --show-toplevel` を判定し、
   既存リポ（`_edit` 等）の内側では git init しない。親リポを汚す経路を作らない
   （Wave 9 `f18-parent-repo-guard` と同じ判定基準）
5. **git 初期化が安全な場合のみ** init + 単一コミット。それ以外は理由を報告して skip
6. **雛形バージョン（`AKARI-SKILLS-VERSION`）を記録するだけ**で、既存プロジェクトへの
   silent update をしない
7. **アプリ作成とスキル作成の成果物 diff ゼロを保つ**（§3 の共有実装がその手段）

## 実行手順

1. `--template <path>` があればその雛形を使い、省略時はリポ checkout の `templates/project-default/` を使う。この 2 択以外の雛形解決を行わない。
2. 次の CLI を実行する。

   ```sh
   node skills/create-project/bin/create-project.mjs <target-dir> [--template <path>]
   ```

3. 標準出力に表示された作成結果レポート HTML のパスを確認する。レポートは読み取り専用で、コピー、フォールバック補完、シンボリックリンクのスキップ、雛形バージョン、git 初期化の結果を記録する。

## 使い方

```sh
node skills/create-project/bin/create-project.mjs <target-dir> [--template <path>]
```

- `<target-dir>`: 作成先ディレクトリ。新規でも既存の非空フォルダでもよい。既存ファイルは上書きしない。
- `--template <path>`: 雛形ディレクトリを明示指定する。省略時はリポ checkout の `templates/project-default/` を使う。それ以外の解決手段はない。

## 作例から始めたいと言われたとき

「解説ショートを作りたい」「あの縦型の解説動画みたいなやつ」のように**完成形の作例から
始めたい**依頼は、雛形解決の 2 択（ハードルール 1）とは別の話である。本スキルは**器**を作る
ものであり、作例は器ではない。

- 解説ショート（3 面構成の縦型・VOICEVOX ナレーション駆動・図解カードの段階表示）:
  [`templates/kaisetsu-short/`](../../templates/kaisetsu-short/README.ja.md)
- 使い方はディレクトリごと複製し、`sample-project/` を自分の台本 JSON に置き換える。
  まず動作確認するなら同梱サンプル（音声同梱のため VOICEVOX 不要）:

  ```sh
  cd templates/kaisetsu-short && node tools/build.mjs sample-project --no-synthesize
  ```

- **作例を `--template` に渡さない。** `.akari/` などの器の構造を持たないため、
  雛形として解決すると不完全なプロジェクトになる。器が要るなら通常どおり
  `templates/project-default/` で作成し、そのうえで作例を複製して中身を持ち込む
- テンプレート 2 種（器 / 作例）の違いは [`templates/INDEX.md`](../../templates/INDEX.md) を参照

## intake.json（進め方フォームの保存先）

作成直後の `.akari/intake.json` は `status: "draft"`・空 `tasks` から始まる（契約: `packages/schemas/intake.schema.json`）。プロジェクトの CLAUDE.md には intake の規律を追記する — `status: "submitted"` なら `tasks` / `target` / `autonomy` に従い、`autonomy: "checkpoint"`（既定）なら企画承認・書き出し前などの要所で人に確認し、`status: "draft"` のままなら進め方をフォームまたは対話で確定させてから進める。
