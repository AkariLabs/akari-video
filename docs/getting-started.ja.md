[English](./getting-started.md) | **日本語**

# Getting Started — 最初のプロジェクトを作る

AKARI Video は UI がなくても Claude Code だけで完結します（headless-first）。
この章では、入口の選び方から最初のプロジェクト作成、進め方フォームの記入までを説明します。

## 前提

- macOS（Windows 対応は準備中 — [dev/windows-build.md](./dev/windows-build.md)）
- [Claude Code](https://claude.com/claude-code)
- ffmpeg・whisper.cpp などの CLI ツール類は、初回セットアップ時にスキルが確認・案内します

## 入口を選ぶ

3 つの入口はどれも同じファイル契約（`.akari/` 配下）に収束します。
どこから始めても、続きは別の入口から再開できます。

### A. ターミナルから（`akari` コマンド）

```sh
# モノレポ checkout 内から実行（npm publish は未実施）
node packages/akari-launcher/bin/akari.mjs
```

`akari` は次の順で動きます:

1. カレントディレクトリがプロジェクトかどうか診断（`.akari/connections.json` の有無）
2. 未セットアップなら日本語で案内し、プロジェクトの雛形を作成
3. 接続状態（生成プロバイダ・API キー）を確認して表示
4. 最後に `claude` を起動 — 以降はセッション内で会話しながら進める
   （引数はそのまま `claude` へ渡ります。例: `akari --continue`）

### B. Claude Code セッション内から

すでに Claude Code を使っているなら、入口はこちらが自然です。

- **`/akari`** — カレントの状態を診断して、次の一手を案内するスラッシュコマンド
- **発話** — 「新しい動画プロジェクトを作りたい」「このフォルダを AKARI プロジェクトにして」
  で `create-project` スキルが発動

プラグイン（`plugin/`）を有効化しておくと、プロジェクトのディレクトリでセッションを
開くだけで状態が自動で読み込まれ、「続きから」が案内されます（SessionStart hook）。

### C. アプリから

Theia ベースのデスクトップシェル（`apps/shell/`、移行中）の「はじめる」画面から接続します。
アプリはエージェントが作った編集を**確認して直す場所**なので、
最初の一歩はターミナルかセッション内から始めるのが現在の推奨です。

## プロジェクトを作る

`create-project` スキルがテンプレートから一式を作ります:

```
my-video/
├── .akari/
│   ├── intake.json        ← 進め方フォーム（最初に記入する）
│   ├── connections.json   ← 接続レジストリ（API キー参照・モデル選択）
│   ├── workflow.json      ← プロジェクトのロール定義
│   └── events/            ← 節目の記録（「続きから」の合図）
├── assets/                ← 素材置き場
├── planning/              ← 企画・計画文書
└── exports/               ← 書き出し先
```

## 進め方フォーム（intake.json）を埋める

プロジェクト作成直後の `.akari/intake.json` は `status: draft` です。
3 つの質問に答えて `submitted` にすると、エージェントが動き出せます。

| 項目 | 意味 | 例 |
|---|---|---|
| `tasks` | やること | 「撮影素材からショート動画を 1 本」 |
| `target` | 尺・出力先 | 「60 秒・縦型」 |
| `autonomy` | おまかせ度 | `full-auto` / `checkpoint`（既定・節目で承認）/ `collaborative` |

フォームはチャットで埋められます。「進め方フォームを埋めたい」と言えば、
エージェントが質問しながら記入します。

## 接続を設定する（必要になったときで OK）

文字起こしのクラウド利用・ナレーション生成・素材生成など、
**外部 API を使う段になったら** `manage-connections` スキルで設定します。
ローカル完結の範囲（プロキシ生成・whisper.cpp 文字起こし・編集・書き出し）なら接続なしで使えます。

詳細: [How-to: 接続と API キー](./how-to/connections.ja.md)

## 最初のフロー例

撮影済み素材が 1 本ある場合:

1. 素材をプロジェクトに置き、「この動画を分析して」 → [素材を分析する](./guides/analyze-footage.ja.md)
2. 「編集方針を立てて」 → 分析レポートを見て方針に OK → [編集計画を立てる](./guides/plan-your-edit.ja.md)
3. エージェントが `edit.json`・テロップ・字幕を組み上げる
4. 「書き出して」 → lint PASS → 承認 → `exports/` に MP4 → [書き出す](./guides/export.ja.md)

素材がまだ無い場合は、企画から始められます → [ゼロから企画する](./guides/plan-from-scratch.ja.md)
