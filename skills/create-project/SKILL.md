---
name: create-project
description: AKARI Video の新規プロジェクトを headless で作成する。`templates/project-default/` を再帰コピーし、雛形バージョンを記録し、安全な場合のみ git 初期化して、作成結果レポート HTML を生成する。アプリ起動は不要。新しい動画プロジェクトを作るとき、または既存フォルダを AKARI Video プロジェクトとして補完するときに使う。
---

# 新規プロジェクトを作成する

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
