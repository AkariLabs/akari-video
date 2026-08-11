[English](./getting-started.md) | **日本語**

# Getting Started — 最初のプロジェクトを作る

AKARI Video は **AI エージェントが動画編集を行う** システムです。
人間がやることは 2 つだけ：**作りたいものを伝える** と **結果を確認する**。

「動画編集を始めたことがあるが、テロップやナレーションまで自力でやるのは面倒」
「短い動画をなんとか作りたいが、軟體の使い方を覚える時間がない」
そんなときに使うと便利です。

## このドキュメントでわかること

1. 使うために何を揃えるか（前提条件）
2. インストール方法
3. 最初のプロジェクトを作って動画を書き出すまで

---

## 前提条件 — 何を揃えるか

AKARI Video はターミナル（コマンドライン）で動きます。
必要なものは Node.js・AI エージェント・ffmpeg の **3 つ**です。

**オートインストール（おすすめ）**:

以下のコマンドを 1 つだけ（お使いの OS に合ったもの）実行してください。
インストーラーは開発ブランチ（main）ではなく**最新リリース**を checkout します。

**Windows (PowerShell)**:
```sh
irm https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.ps1 | iex
```

**Windows (CMD)**:
```sh
curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.cmd -o install.cmd && install.cmd
```

**Linux / macOS**:
```sh
curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.sh | bash
```

スクリプトが自動で以下を確認・インストールします:
- Node.js v20+（無ければポータブル版を `~/.akari/` 配下へ配置 — Homebrew 不要・
  管理者パスワード不要）
- opencode または Claude Code（案内表示）
- ffmpeg（何もしなくて OK — `npm install` が同梱の GPL ビルドを自動で取得します。
  sha256 検証付き。PATH に ffmpeg があればそちらを優先）

CLI は既定で `~/.akari/app/` にインストールされます。インストール先は
`AKARI_INSTALL_DIR` で上書きできます。`~/.akari/app/` はアップデート時にディレクトリごと
入れ替えてよい領域です。一方、`~/.akari/` 直下のその他の項目（`assets/`、`avatars/`、
`runtime/`、`*.json` ファイルなど）はユーザーデータとして保持されます。旧インストーラーで
`~/akari-video/` に導入したコピーが見つかると、インストーラーは移行案内を表示しますが、
旧コピーを自動では削除しません。

git も不要です — インストーラーはリポジトリを tarball で取得します。

**アップデート**: インストール後は、新しいバージョンがあると `akari` 実行時に 1 行だけ
通知されます。`akari update` を実行するとダウンロード・チェックサム検証・適用まで
自動で行われます（git もインストーラーの再実行も不要）。直前のバージョンは 1 世代だけ
保持され、`akari update --rollback` で戻せます。上のインストーラーを再実行する方法も
引き続き使えます（`AKARI_INSTALL_DIR` を切り替えたいときや、`akari update` の対象外
（npm グローバルインストール・モノレポ checkout など）の環境を復旧したいときはこちら）。

デスクトップアプリ（Theia ベースのシェル）も新版を自動でダウンロードします。
ダウンロードが終わるとホーム画面のバナーが「ダウンロード済みです。再起動すると
適用されます。」に変わり、「今すぐ再起動して適用」ボタンを押すか、通常どおりアプリを
終了・再起動するとその時点で切り替わります。作業中に強制的に再起動されることはありません。

**CLI だけを軽量に入れたい場合**は `npm i -g akari-video` でも導入できます（エージェント
ワークフローは同梱。ブラウザプレビューは含まれないため、フル構成は上のインストーラーで）。

**手動でインストールする場合** は以下の手順を参照:

### 1. Node.js（JavaScript 実行環境）

Node.js は AKARI Video の本体を動かすために必要です。

**インストール方法**:

- **Windows**: [nodejs.org](https://nodejs.org/) から LTS 版をダウンロードしてインストール
- **Linux (Ubuntu/WSL2)**:
  ```sh
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- **macOS**: [nodejs.org](https://nodejs.org/) から LTS 版をダウンロード、または `brew install node`

> ワンライナーインストーラーを使う場合はこの節ごと不要です — Node が無ければポータブル版を
> `~/.akari/` 配下に自動配置します（Homebrew も管理者パスワードも使いません）。

**確認方法**:
```sh
node --version
# v20.x.x とか表示されれば OK
```

### 2. opencode、Claude Code、または Cursor Agent（AI エージェント）

AKARI Video を動かすには、AI エージェントが必要です。
以下のいずれか（複数可）を入れてください。

#### opencode を使う場合（おすすめ）

opencode はオープンソースの AI コーディングアシスタントです。
**無料のモデル** が同梱されていますが、より高性能なモデルを使う場合は
プロバイダのアカウントが必要です。

**インストール方法**:

```sh
curl -fsSL https://opencode.ai/install | bash
```

**確認方法**:
```sh
opencode --version
# バージョン番号が表示されれば OK
```

詳しくは [opencode 公式サイト](https://opencode.ai) を参照。

#### Claude Code を使う場合

Claude Code は Anthropic 社の AI コーディングアシスタントです。
**有料の Claude サブスクリプション** が必要です。

**インストール方法**:

```sh
# Windows / Linux / macOS
curl -fsSL https://claude.ai/install.sh | bash
```

**確認方法**:
```sh
claude --version
# バージョン番号が表示されれば OK
```

詳しくは [Claude Code 公式ドキュメント](https://docs.anthropic.com/en/docs/claude-code/overview) を参照。

#### Cursor Agent を使う場合

[Cursor](https://cursor.com) は Agent モード付きの AI ネイティブ IDE です。
AKARI Video のモノレポ、または動画プロジェクトフォルダを Cursor で開くと、
`.cursor/skills/`（モノレポ）またはプロジェクトのアダプタ（`create-project` 後）から
[Agent Skills](https://agentskills.io) 形式のスキルが自動発見されます。

**始め方**:

1. リポジトリまたはプロジェクトを Cursor で開く
2. Agent チャットで **「新しい動画プロジェクトを作りたい」** と発話
3. エージェントが `AGENTS.md` と `.cursor/skills/` 配下の `SKILL.md` を読んで進める

Cursor 専用の `/akari` スラッシュコマンドは現時点ではありません。自然言語の依頼や
`skills/edit-plan/SKILL.md` などの明示パス指定で、他ハーネスと同様に使えます。

### 3. ffmpeg（動画処理ツール）

ffmpeg は動画の切り貼り・変換・書き出しに使います。
**通常はインストール不要です** — ワンライナーインストーラーが実行する `npm install` が
同梱の GPL ビルドを自動で取得します（ピン留めした sha256 で検証）。PATH に ffmpeg が
既にあればそちらを優先して使います。

**手動インストール（任意 — システム全体に入れたい場合）**:

- **Windows**: `winget install Gyan.FFmpeg` または [ffmpeg 公式サイト](https://ffmpeg.org/download.html) からダウンロード
- **Linux**: `sudo apt install ffmpeg`
- **macOS**: `brew install ffmpeg` ([Homebrew](https://brew.sh/) が必要)

**確認方法**:
```sh
ffmpeg -version
# バージョン情報が表示されれば OK
```

---

## 入口を選ぶ

AKARI Video には 4 つの入口があります。
どれも同じファイル契約（`.akari/` 配下）に収束するので、
どこから始めても続きは別の入口から再開できます。

| 入口 | おすすめの人 | 発動方法 |
|---|---|---|
| A. ターミナル | コマンドラインに慣れている人 | `./akari.sh --opencode` |
| B. opencode / Claude Code セッション | すでに AI エージェント CLI を使っている人 | 「新しい動画プロジェクトを作りたい」と発話 |
| C. Cursor Agent | IDE の Agent チャットで進めたい人 | リポジトリまたはプロジェクトを Cursor で開き、「新しい動画プロジェクトを作りたい」と発話 |
| D. アプリ | GUI で操作したい人 | Theia ベースのデスクトップシェルから接続 |

**初めての方は A から** がおすすめです。

---

### A. ターミナルから（`akari` コマンド）

```sh
./akari.sh --opencode
```

`akari` は次の順で動きます:

1. カレントディレクトリがプロジェクトかどうか診断（`.akari/connections.json` の有無）
2. 未セットアップなら日本語で案内し、プロジェクトの雛形を作成
3. 接続状態（生成プロバイダ・API キー）を確認して表示
4. 最後に AI エージェントを起動 — 以降はセッション内で会話しながら進める

**Claude Code を使う場合**:

```sh
./akari.sh
```

### B. opencode / Claude Code セッション内から

すでに AI エージェント CLI を使っているなら、入口はこちらが自然です。

- **opencode**: 「新しい動画プロジェクトを作りたい」と発話すると
  `create-project` スキルが発動
- **Claude Code**: **`/akari`** — カレントの状態を診断して、次の一手を案内するスラッシュコマンド
  または「新しい動画プロジェクトを作りたい」と発話

### C. Cursor Agent から

モノレポ（`akari-video`）または動画プロジェクトフォルダを Cursor で開きます。
スキルは `.cursor/skills/`（モノレポでは `skills/` への symlink）または
`create-project` が作るプロジェクトアダプタから自動発見されます。

Agent チャットで **「新しい動画プロジェクトを作りたい」** と発話するか、
`skills/edit-plan/SKILL.md` などスキルパスを明示してください。

プレビューは別ターミナルで `./akari.sh --preview` を実行し、
http://localhost:4567 を開きます。

### D. アプリから

Theia ベースのデスクトップシェル（`apps/shell/`、移行中）の
「はじめる」画面から接続します。
アプリはエージェントが作った編集を**確認して直す場所**なので、
最初の一歩はターミナルかセッション内から始めるのが現在の推奨です。

---

## プロジェクトを作る

入口を選んだら、まずプロジェクトを作ります。

AI エージェントに「**プロジェクトを作りたい**」と伝えると、
テンプレートから以下の一式が自動で作られます:

```
my-video/
├── .akari/
│   ├── intake.json        ← 進め方フォーム（最初に記入する）
│   ├── connections.json   ← 接続レジストリ（API キー参照・モデル選択）
│   ├── workflow.json      ← プロジェクトのロール定義
│   └── events/            ← 節目の記録（「続きから」の合図）
├── .opencode/
│   ├── config.json        ← opencode 設定
│   ├── skills/            ← スキル定義（skills/ への symlink）
│   └── hooks/             ← セッション開始フック
├── assets/                ← 素材置き場
├── planning/              ← 企画・計画文書
└── exports/               ← 書き出し先
```

---

## 進め方フォーム（intake.json）を埋める

プロジェクト作成直後の `.akari/intake.json` は `status: draft` です。
3 つの質問に答えて `submitted` にすると、エージェントが動き出せます。

| 項目 | 意味 | 例 |
|---|---|---|
| `tasks` | やること | 「撮影素材からショート動画を 1 本」 |
| `target` | 尺・出力先 | 「60 秒・縦型」 |
| `autonomy` | おまかせ度 | `full-auto` / `checkpoint`（既定・節目で承認）/ `collaborative` |

フォームはチャットで埋められます。「**進め方フォームを埋めたい**」と言えば、
エージェントが質問しながら記入します。

---

## 接続を設定する（必要になったときで OK）

文字起こしのクラウド利用・ナレーション生成・素材生成など、
**外部 API を使う段になったら** `manage-connections` スキルで設定します。

ローカル完結の範囲（プロキシ生成・whisper.cpp 文字起こし・編集・書き出し）なら
**接続なしで使えます**。

詳細: [How-to: 接続と API キー](./how-to/connections.ja.md)

---

## 最初のフロー例 — 何ができるか

### 素材がある場合

撮影済みの動画が 1 本ある場合の流れです:

1. **素材をプロジェクトに置く** → 「この動画を分析して」
   → エージェントが 720p プロキシ・文字起こし・キーフレームを作成
   → [素材を分析する](./guides/analyze-footage.ja.md)

2. **編集方針を立てる** → 「編集方針を立てて」
   → 分析レポートを元にエージェントが方向性を提案 → あなたが OK を出す
   → [編集計画を立てる](./guides/plan-your-edit.ja.md)

3. **編集を組み立てる** → エージェントが `edit.json`・テロップ・字幕を自動で作成

4. **書き出す** → 「書き出して」
   → lint PASS → あなたが承認 → `exports/` に MP4 が保存される
   → [書き出す](./guides/export.ja.md)

### 素材がない場合

「何か動画を作りたい」という話題から始められます。
エージェントが質問しながら企画を立て、素材の調達方法を提案します。
→ [ゼロから企画する](./guides/plan-from-scratch.ja.md)

---

## よくある質問

**Q. プログラミングの知識は必要？**
いりません。AI エージェントがすべてやります。
あなたは「何を作りたいか」と「いいか確認」するだけです。

**Q. 料金はかかる？**
ローカル完結の範囲（プロキシ生成・文字起こし・編集・書き出し）は無料です。
外部 API（クラウド文字起こし・ナレーション生成など）を使う場合のみ課金されます。

**Q. Windows で動きますか？**
はい。Windows、Linux（WSL2 含む）、macOS に対応しています。

**Q. 英語しかわからないのですが？**
エージェントとの対話は日本語で可能です。
ただし一部のエラーメッセージやドキュメントは英語のことがあります。
