[English](./getting-started.md) | **日本語**

# Getting Started — 最初のプロジェクトを作る

> **画面の語について**: この文書は最新の `main` の語で書いています。
<!-- BEGIN GENERATED facts:shipped-note -->
<!-- END GENERATED facts:shipped-note -->

AKARI Video は **AI エージェントが動画編集を行う** システムです。
人間がやることは 2 つだけ：**作りたいものを伝える** と **結果を確認して直す**。

「動画編集を始めたことがあるが、テロップやナレーションまで自力でやるのは面倒」
「短い動画をなんとか作りたいが、編集ソフトの使い方を覚える時間がない」
そんなときに使うと便利です。

## このドキュメントでわかること

1. 使うために何を揃えるか（前提条件・インストール）
2. 入口の選び方（アプリ・ターミナル・AI エージェントの中）
3. 最初のプロジェクトを作って動画を書き出すまで（アプリの流れ・CLI の流れ）
4. 進め方フォーム、Lab との連携

---

## 前提条件 — 何を揃えるか

使い方は 2 通りあります。

- **デスクトップアプリ（おすすめ）** — ダウンロードして開くだけです。AI パートナーはアプリの中で追加します。
  Node.js や ffmpeg を自分で入れる必要はありません。足りない道具は、初回の「はじめる準備」で入れられます
- **ターミナル（`akari` コマンド）/ AI エージェントの中** — Node.js・AI エージェント・ffmpeg の **3 つ**を使います。
  下の「CLI を入れる」を読んでください

### デスクトップアプリをダウンロードする

[akari.video/download](https://akari.video/download/) から、お使いのパソコンに合う版を入れます。

| OS | ファイル | 備考 |
|---|---|---|
| macOS（Apple Silicon） | `.dmg` | Developer ID 署名と Apple の公証つき。開き方は下の「ダウンロードした macOS 版の署名を確認する」 |
| Windows（x64） | セットアップ用の `.exe`（zip もあります） | まだコード署名がありません。下の注意を読んでください |

Linux 向けのアプリはありません（CLI は Linux でも使えます）。

**Windows で最初に出る確認画面**: Windows 版にはまだコード署名がないため、初めて起動すると
「Windows によって PC が保護されました」という青い画面が出ます。**「詳細情報」→「実行」**を押すと
セットアップが始まります。ソースコードは公開していて、誰でも中身を確かめられます。

アプリは新しい版を自動でダウンロードします。ダウンロードが終わると更新のお知らせ
（「再起動すると新しい版になります。開いているプロジェクトは保存されています。」）が出ます。「更新して再起動」を押すか、
「次に起動したとき」を選ぶか、通常どおりアプリを終了・再起動するとその時点で切り替わります。作業中に強制的に再起動されることはありません。

更新は既定で安定版だけが届きます。新しい機能を早く試したい場合は、アプリの設定の
「受け取る版」で「<!-- F ui.settings.prereleaseToo -->プレリリースも<!-- /F -->」を選ぶとベータ版も届きます。これは
`~/.akari/update-preferences.json` に `"channel": "prerelease"` を設定するのと同じで、
CLI の自動更新にも適用されます。

アプリを入れたら、このあとの「入口を選ぶ」の **D** と「最初のプロジェクトを作る」へ進んでください。

### CLI を入れる（ターミナルで使う場合）

**オートインストール（おすすめ）**:

以下のコマンドを 1 つだけ（お使いの OS に合ったもの）実行してください。
インストーラーは開発ブランチ（main）ではなく**最新リリース**を checkout します。

**Linux / macOS**:
```sh
curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.sh | bash
```

**Windows (PowerShell)**:
```sh
irm https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.ps1 | iex
```

**Windows (CMD)**:
```sh
curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.cmd -o install.cmd && install.cmd
```

`install.sh`（Linux / macOS）は次を確認・インストールします:
- Node.js v20+（無ければポータブル版を `~/.akari/` 配下へ配置 — Homebrew 不要・
  管理者パスワード不要）
- opencode または Claude Code（どちらも無ければ opencode の導入を確認します。Codex・Cursor Agent など、ほかのエージェントは自分で入れてください）
- ffmpeg（何もしなくて OK — `npm install` が同梱の GPL ビルドを自動で取得します。
  sha256 検証付き。PATH に ffmpeg があればそちらを優先）

`install.sh` は git も不要です — リポジトリを tarball で取得します。
CLI は既定で `~/.akari/app/` にインストールされます。インストール先は
`AKARI_INSTALL_DIR` で上書きできます。`~/.akari/app/` はアップデート時にディレクトリごと
入れ替えてよい領域です。一方、`~/.akari/` 直下のその他の項目（`assets/`、`avatars/`、
`runtime/`、`*.json` ファイルなど）はユーザーデータとして保持されます。旧インストーラーで
`~/akari-video/` に導入したコピーが見つかると、インストーラーは移行案内を表示しますが、
旧コピーを自動では削除しません。

**Windows のインストーラー**（`install.ps1` / `install.cmd`）は動きが少し違います。

- **git が必要**です。リポジトリを `%USERPROFILE%\akari-video` に clone し、最新のリリースタグを checkout します
- Node.js v20+ は、`install.ps1` なら winget / Chocolatey / Scoop で入れます。`install.cmd` は入れないので、先に [nodejs.org](https://nodejs.org/) から入れてください
- ffmpeg は `install.ps1` が任意で入れます。PATH に無くても、`npm install` が同梱の GPL ビルドを取得します
- 更新は、同じインストーラーをもう一度実行します

git を使わずに入れたいときは、下の `npm i -g akari-video` か、デスクトップアプリを使ってください。

**インストール後は新しいターミナルを開いてください**。インストーラーは PATH を追記しますが
（Linux / macOS は `~/.zshrc`、bash は `~/.bashrc`）、今開いているターミナルには反映されないため、
そのまま `akari` を打つと `command not found` になります。
同じターミナルで続ける場合は `source ~/.zshrc`（bash は `source ~/.bashrc`）を先に実行してください。

**アップデート**: `install.sh` で入れた CLI は、使っているだけで自動的に最新版になります — インストーラーの
再実行も git も、`akari update` を自分で叩くことも不要です。新しいバージョンがあると、
作業中の裏でダウンロード・チェックサム検証まで済ませ（起動を待たせることは一切ありません）、
次に `akari` を起動したタイミングでアトミックに適用されます。適用された起動では
「vX.Y.Z に更新しました」と 1 行だけ表示されます。直前のバージョンは 1 世代だけ保持され、
`akari update --rollback` で戻せます。`akari update` はオンデマンドの確認・適用として
引き続き使えます。`AKARI_NO_AUTO_UPDATE=1` を設定すると裏ダウンロード・自動適用の両方を
止められます（「新しいバージョンがあります」という通知だけは引き続き表示され、
`akari update` で手動更新できます）— CI や環境を固定したい場合に使ってください。
上のインストーラーを再実行する方法も引き続き使えます（`AKARI_INSTALL_DIR` を
切り替えたいときや、自動アップデートの対象外（npm グローバルインストール・モノレポ
checkout など）の環境を復旧したいときはこちら）。

**CLI だけを軽量に入れたい場合**は `npm i -g akari-video` でも導入できます（エージェント
ワークフローは同梱。ブラウザプレビューは含まれないため、フル構成は上のインストーラーで）。
これは sudo を使いません。`EACCES`（権限エラー）が出た場合は上記の `install.sh`
（ユーザー領域・管理者権限不要）を使うか、npm のユーザー prefix を設定してください。
デスクトップ版の `akari` はアプリ同梱の CLI をそのまま使うため、アプリを更新すれば CLI も同じ版になります。
OS のターミナルから使う場合は `~/.akari/cli/bin` を PATH に追加するか、上記の `install.sh` を使ってください。

**手動でインストールする場合** は以下の手順を参照:

### 1. Node.js（JavaScript 実行環境）

Node.js は CLI（`akari` コマンド）を動かすために必要です。

**インストール方法**:

- **Windows**: [nodejs.org](https://nodejs.org/) から LTS 版をダウンロードしてインストール
- **Linux (Ubuntu/WSL2)**:
  ```sh
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- **macOS**: [nodejs.org](https://nodejs.org/) から LTS 版をダウンロード、または `brew install node`

> `install.sh` を使う場合はこの節ごと不要です — Node が無ければポータブル版を
> `~/.akari/` 配下に自動配置します（Homebrew も管理者パスワードも使いません）。

**確認方法**:
```sh
node --version
# v20.x.x とか表示されれば OK
```

### 2. AI エージェント（opencode、Claude Code、Codex、Cursor Agent ほか）

CLI から使うには、AI エージェントが必要です。
以下のいずれか（複数可）を入れてください。デスクトップアプリを使う場合は、アプリの
「パートナーを追加」から入れられるので、この節は不要です。

#### opencode を使う場合

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

#### Codex を使う場合

Codex は OpenAI のコーディングエージェントです。ChatGPT のアカウントでログインして使います。
AKARI Video のプロジェクトフォルダで Codex を起動すると、`.agents/skills/` と `.codex/skills/` の
[Agent Skills](https://agentskills.io) 形式のスキルが自動発見されます。入れ方は
[Codex の公式リポジトリ](https://github.com/openai/codex) を参照してください。

#### Cursor Agent を使う場合

[Cursor](https://cursor.com) は Agent モード付きの AI ネイティブ IDE です。
AKARI Video のモノレポ、または動画プロジェクトフォルダを Cursor で開くと、
`.cursor/skills/`（モノレポ）またはプロジェクトのアダプタ（`akari new` 後）から
[Agent Skills](https://agentskills.io) 形式のスキルが自動発見されます。

**始め方**:

1. リポジトリまたはプロジェクトを Cursor で開く
2. Agent チャットで **「新しい動画プロジェクトを作りたい」** と発話
3. エージェントが `AGENTS.md` と `.cursor/skills/` 配下の `SKILL.md` を読んで進める

Cursor 専用の `/akari` スラッシュコマンドは現時点ではありません。自然言語の依頼や
`skills/plan-edit/SKILL.md` などの明示パス指定で、他ハーネスと同様に使えます。

アプリの中では、このほかに GitHub Copilot・Antigravity（Google）・Grok Build（xAI）・Command Code・Pi・Devin・
Muse Code（Meta）・DeepSeek Harness もパートナーとして選べます。

### 3. ffmpeg（動画処理ツール）

ffmpeg は動画の切り貼り・変換・書き出しに使います。
**通常はインストール不要です** — `install.sh` や `npm install` が
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

### 4. モノレポの取得と npm 依存のインストール

上のインストーラーを使う場合、この節の内容はすべて自動で行われます。
**手動でモノレポを用意する場合**（インストーラーを使わず tarball で取得する場合など）
だけ読んでください。

ソースを取得します。tarball なら git は不要です（`install.sh` も同じ方法で取得します。
ただしインストーラーの既定は `main` ではなく最新のリリースタグ `tar.gz/refs/tags/vX.Y.Z` です）。

```sh
mkdir %USERPROFILE%\.akari\app
curl -fsSL -o main.tar.gz https://codeload.github.com/AkariLabs/akari-video/tar.gz/refs/heads/main
tar -xzf main.tar.gz -C %USERPROFILE%\.akari\app --strip-components=1
```

（Linux / macOS では展開先を `$HOME/.akari/app` にすれば同じ 2 コマンドで動きます。）

#### Windows: 展開時の symlink エラーは想定どおり — 無視してよい

Windows でシンボリックリンクを作るには通常のアカウントに無い権限が必要なため、
`tar` はリポジトリ内のシンボリックリンクすべてで失敗し、**exit 1** で終わります。

```
.agents/skills/address-review: Can't create '\\?\C:\Users\<ユーザー名>\.akari\app\.agents\skills\address-review': Invalid argument
.claude/skills/...   （同様）
.codex/skills/...    （同様）
.cursor/skills/...   （同様）
.opencode/skills/... （同様）
plugin/skills:       （同様）
```

**これはインストール失敗ではありません。** 失敗するのはシンボリックリンクである
エージェント用の入口（`.agents/`・`.claude/`・`.codex/`・`.cursor/`・`.opencode/` 配下の
スキルディレクトリと `plugin/skills`）だけで、実体のファイル（`packages/`・`skills/`・
`docs/`・`templates/` など）は展開済みなのでそのまま作業を続けられます。これらのリンクは
`skills/` を指しているだけで、スキルの実体は `skills/<名前>/SKILL.md` にあります。
エージェントにはそのパスを直接指定すれば同じことができます
（「`skills/plan-edit/SKILL.md` を読んでその手順で進めて」）。

ただし `tar` は exit 1 を返すため、展開を包むスクリプトからは「失敗」に見えます。
終了コードではなく展開されたファイルの有無で判定してください
（例: `packages\akari-launcher\bin\akari.mjs`）。

シンボリックリンクを実際に作りたい場合は、作成を許可してから展開し直します。

- **開発者モード**を有効にする（設定 → システム → 開発者向け）、または
  **管理者として実行**したシェルから展開する
- git clone で取得する場合は、clone の**前に** `git config --global core.symlinks true` も
  設定する（未設定のまま clone するとシンボリックリンクがテキストファイルになる）

#### npm 依存をインストールする

取得直後は `node_modules/` がありません。CLI を使う前に依存をインストールしてください。

実行時依存やツール準備が必要なパッケージは以下です。

| パッケージ | 外部依存 | 何に必要か |
|---|---|---|
| `packages/preview-server` | `esbuild` | ブラウザプレビューサーバー |
| `packages/media-bin` | なし — ただし `postinstall` が ffmpeg/ffprobe を取得（sha256 検証付き） | すべてのメディア処理で使う ffmpeg |
| `packages/akari-tools` | `puppeteer-core` + モノレポ内パッケージ `@akari-video/render-cut` | ルートからの一括インストールのみ（後述） |
| `packages/export-nle` | モノレポ内パッケージ `@akari-video/media-bin` | ルートからの一括インストールのみ（後述） |
| `apps/shell` | Theia / Electron | デスクトップアプリ — [Windows 実機ビルド手順書](./dev/windows-build.md) を参照 |

**CLI の依存を一括でインストールする（インストーラーと同じ手順）** — 展開済みの
インストール先で npm workspaces を `packages/*` に絞ってから、ルートでインストールします。

```sh
cd %USERPROFILE%\.akari\app
node -e "const fs = require('fs'); const p = 'package.json'; const pkg = JSON.parse(fs.readFileSync(p, 'utf8')); pkg.workspaces = ['packages/*']; fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');"
npm install
```

インストーラーと `akari update` は既定で CLI 専用（ブラウザプレビューを含む）となり、
デスクトップシェル（`apps/shell`、Theia + Electron）は入れません。
`AKARI_INSTALL_SHELL=1` を設定すると workspaces の書き換えをスキップします。
デスクトップアプリはリリースの DMG / EXE を使ってください。開発者がシェルをビルドする場合は
`apps/shell` 内で `npm install --no-workspaces` を実行します。
詳しくは [Windows 実機ビルド手順書](./dev/windows-build.md) を参照してください。

`packages/akari-tools` と `packages/export-nle` はモノレポ内の他パッケージ
（`@akari-video/render-cut` / `@akari-video/media-bin`）に依存しており、これらは npm に
公開されていません。パッケージ単体でのインストールは `404 Not Found` で失敗するため、
npm workspaces がローカル解決するリポジトリルートからインストールしてください。

`--ignore-scripts` は付けないでください。同梱 ffmpeg/ffprobe を取得しているのは
`packages/media-bin` の `postinstall` です。

---

## 入口を選ぶ

AKARI Video には 5 つの入口があります。
どれも同じファイル契約（`.akari/` 配下）に収束するので、
どこから始めても続きは別の入口から再開できます。

| 入口 | おすすめの人 | 発動方法 |
|---|---|---|
| A. ターミナル | コマンドラインに慣れている人 | `akari`（引数なし） |
| B. opencode / Claude Code / Codex セッション | すでに AI エージェント CLI を使っている人 | 「新しい動画プロジェクトを作りたい」と発話 |
| C. Cursor Agent | IDE の Agent チャットで進めたい人 | リポジトリまたはプロジェクトを Cursor で開き、「新しい動画プロジェクトを作りたい」と発話 |
| D. アプリ | GUI で操作したい人 | デスクトップアプリを開き、ホームの「<!-- F ui.home.startButton -->＋ 新しい動画を始める<!-- /F -->」から |
| E. 入口スキル | どのフォルダからでも始めたい人 | `akari skills install --entry` を一度実行して「動画を作りたい」と発話 |

**初めての方は D（アプリ）から** がおすすめです。画面を見ながら AI と一緒に作れます。

---

### A. ターミナルから（`akari` コマンド）

```sh
akari
```

引数なしの `akari` は、プロジェクトを開いて AI エージェントを起動します。次の順で動きます:

1. カレントディレクトリがプロジェクトかどうか診断（`.akari/connections.json` の有無）
2. 未セットアップなら日本語で案内し、空のプロジェクトを作成
3. 接続状態（生成プロバイダ・API キー）を確認して表示
4. 最後に AI エージェントを起動 — 以降はセッション内で会話しながら進める

既定は Claude Code です。opencode を使うときは `akari --opencode` とします
（Claude Code を明示するなら `--claude`）。リポジトリを直接 checkout している場合は、
同じことを `./akari.sh`（opencode なら `./akari.sh --opencode`）で行えます。

### B. opencode / Claude Code / Codex セッション内から

すでに AI エージェント CLI を使っているなら、入口はこちらが自然です。

- **opencode**: 「新しい動画プロジェクトを作りたい」と発話すると
  `setup-project` スキルが発動
- **Claude Code**: **`/akari`** — カレントの状態を診断して、次の一手を案内するスラッシュコマンド
  または「新しい動画プロジェクトを作りたい」と発話
- **Codex**: AKARI Video のプロジェクトフォルダで起動し、「新しい動画プロジェクトを作りたい」と発話。
  スキルは `.agents/skills/` と `.codex/skills/` から自動発見されます

**Claude Code プラグインとして入れる**（28 本のスキルすべて + `/akari`、marketplace から）:
```sh
claude plugin marketplace add AkariLabs/akari-video
claude plugin install akari@akari
```
- marketplace はリポジトリ全体を clone します（約 1 GB）。更新は `claude plugin update akari@akari`。
- プラグインが届けるのは**スキルと `/akari` だけ**です。`akari` CLI（`akari new` など）には §A と同じインストーラー（[前提条件](#前提条件--何を揃えるか)）が要ります — プラグインだけでは動画は作れません。
- 入口スキル 1 本で足りる人は E、Claude Code の中で 28 本すべてを使いたい人は B。

### C. Cursor Agent から

モノレポ（`akari-video`）または動画プロジェクトフォルダを Cursor で開きます。
スキルは `.cursor/skills/`（モノレポでは `skills/` への symlink）または
`akari new` が作るプロジェクトアダプタから自動発見されます。

Agent チャットで **「新しい動画プロジェクトを作りたい」** と発話するか、
`skills/plan-edit/SKILL.md` などスキルパスを明示してください。

プレビューは別ターミナルで `./akari.sh --preview` を実行し、
http://localhost:4567 を開きます。
デスクトップアプリのメニュー（ひらく → ブラウザプレビュー）からも同じサーバーを起動でき、
URL はメニューに表示されます。`?frameEngine=0` を付けると従来表示に切り替わります。

デスクトップアプリ同梱の CLI なら、インストーラーなしでも同じサーバーを起動できます。
プロジェクトのフォルダで `akari preview [dir]` を実行すると URL が出ます。`--port <n>` で
待ち受けポートを変えられ（既定は 3000）、`--open` を付けると準備できた時点でブラウザが開きます。
`akari.sh --preview` の既存の動きは変わりません。

### D. アプリから

デスクトップアプリ（Theia ベースのシェル、`apps/shell/`）を開き、ホームの
「<!-- F ui.home.startButton -->＋ 新しい動画を始める<!-- /F -->」から始めます。流れは「[アプリで最初のプロジェクトを作る](#アプリで最初のプロジェクトを作る)」を見てください。
アプリが主な入口です。右のパネルで AI パートナーを動かし、パートナーが作った編集を
同じ画面で**確認して直せます**。ターミナルやセッションからの入口（A〜C・E）も使えます。

アプリの画面の見方は [シェル UI](./how-to/shell-ui.ja.md) にまとめています。

#### ダウンロードした macOS 版の署名を確認する

ダウンロードした DMG（ファイル名は版によって異なる）をマウントし、中の `.app` を検証します。DMG を保存したフォルダで実行してください。
```sh
dmg=$(ls *.dmg | head -1)
hdiutil attach "$dmg"
app=$(ls -d "/Volumes/AKARI Video"*/"AKARI Video.app" | head -1)
codesign --verify --deep --strict -vv "$app"
spctl -a -t exec -vv "$app"
xcrun stapler validate "$app"
```
期待出力は `valid on disk`、`accepted`、`source=Notarized Developer ID`、`origin=Developer ID Application: nakajima ryoma (WH2ZAX783Q)`、`The validate action worked!` です。
DMG の署名・公証の本対応を含む版以降は、DMG 単体も `xcrun stapler validate "$dmg"` と `spctl -a -t open --context context:primary-signature -vv "$dmg"` で確認できます。
zip は Finder または `ditto -x -k shell-mac.zip extracted` で展開してください。symlink を保存しない展開ツールでは `invalid signature` になることがあります。

---

### E. 何も無いフォルダから（入口スキル）

`akari skills install --entry` を一度実行すると、AI エージェント向けの入口スキルが入ります
（既定の置き場は `~/.claude/skills/akari` と `~/.agents/skills/akari`）。どのフォルダでも Claude Code / Codex / opencode / Cursor に「動画を作りたい」と伝えれば始まります。

- **作る:** 作業場（`~/Akari/`、無ければ `akari init`）かこのフォルダかを 1 問で選び、`akari new <target>` で作成します。
- **開く:** 作業場の `channels/*/videos/*` からプロジェクトを選びます。
- **続きから:** 既存プロジェクトでは `akari status` から次のスキルや待っている操作を案内します。
- **作り方をすすめる:** 作り始めたときと素材を置いた直後に、`akari playbook list` の中から合う作り方を最大 3 つ、理由つきで提案します。自動では当てません。

今のセッションでは `<project>/.claude/skills/<name>/SKILL.md` を直接読み、次回そのプロジェクトで起動するとスキル一覧に載ります。

---

## 最初のプロジェクトを作る

### アプリで最初のプロジェクトを作る

アプリを初めて開いてから、1 本書き出すまでの流れです。

1. **はじめる準備** — 初めて開くと準備の画面が出ます。「道具」「作業場」「素材」「パートナー」の 4 つを
   順に進めます。道具は動画の変換や文字起こしに使う部品で、ボタン 1 つで入ります。作業場は、
   チャンネルと動画プロジェクトをまとめる置き場（既定は `~/Akari`）です。素材の画面では、
   手持ちの素材フォルダを入れたり、AKARI Video Lab とつないだりできます（[Lab と連携する](#lab-と連携する)）。
   設定の「はじめる準備」からいつでもやり直せます
2. **はじめてのガイド** — 「AKARI Video を使うのは、はじめてですか？」で「はじめて」を選ぶと、
   サンプル動画を一緒に作るガイドが始まります（5 分ほど）。画面の構成を見て、素材を入れ、AI に頼み、
   できあがりを再生して、書き出すところまでです。AI につなぐ前でも、流れはお手本で見られます。
   お手本は画面の言語（日本語 / English）に合わせて選ばれます。閉じても、設定の「はじめてのガイド」か
   ホームの「はじめてのガイドをもう一度」でいつでも見られます
3. **AI パートナーを追加する** — 右のパネルの「パートナーを追加」から、使う AI を選びます。
   Claude の Pro・Max なら Claude Code、ChatGPT のアカウントなら Codex、Google のアカウントなら
   Antigravity がそのままつながります（ガイドでもこの 3 つを案内しています）。必要な部品はアプリが入れます。
   あとはブラウザでログインするだけです。opencode・Cursor・GitHub Copilot・Grok Build・Command Code・Pi・Devin・
   Muse Code・DeepSeek Harness も選べます。AI の権限は設定の「パートナーの権限」で
   「自動 / 毎回確認 / すべて許可」から選べます。CLI エージェントの更新も設定から行えます
4. **新しいプロジェクトを作る** — ホームで **「<!-- F ui.home.startButton -->＋ 新しい動画を始める<!-- /F -->」** を押すと、「<!-- F ui.home.newProjectHeading -->新しいプロジェクト<!-- /F -->」という 1 つのポップアップが開きます。
   名前を付け、入れるチャンネルを選び（「チャンネルに入れずに作る」もできます）、**「白紙から」**か
   **「作り方から」**を選びます。
   - **白紙から**: 素材も設定もない状態から始めます
   - **作り方から**: 手元・チャンネル・Lab の作り方（1 本ぶんの手順・確認点・設定・仮枠）を選び、
     確認シートを見て「取り込んで始める」を押します。流れと設定を引き継いで始められます
5. **素材を入れる** — 撮った動画や写真を、左のプロジェクトパネルの「素材」へドラッグ&ドロップします。
   左のパネルは上から **素材**（入れるもの）・**記録**（企画・編集データ・レポート）・**出力**（書き出したもの）の 3 帯です。
   使える部品や見た目は左の **ライブラリ**（素材・スタイル・テンプレートの棚）から、タイムラインへドラッグして置けます
6. **AI パートナーに頼む** — 右のパートナーに、やりたいことを文章で頼みます
   （例:「テロップと BGM を入れて、いらない間をカットして」）。パートナーが分析・カット・字幕・BGM を進めます。
   待っている間は別のことをして大丈夫です。迷ったら、ホームの「進め方フォームを開く」（後述）で
   「やること」「尺」「おまかせ度」を選んで依頼できます
7. **確認して直す** — 真ん中のプレビューで再生して確かめます。直したい所には、プレビューの下のペン・ピン・範囲で
   印を付けて指示を書き、**「<!-- F ui.annotation.handToAi -->AI に渡す<!-- /F -->」** を押すと、右パネルの注釈としてパートナーに届きます。
   手で直すこともできます。タイムラインで切る・動かす、台本パネルで言葉や行を選んで「映像ごとカット」、字幕の見た目を
   「字幕全体 / 選んだ文字だけ」に当てる、などです。手で直したあとに「続きをやって」と頼むこともできます
8. **書き出す** — 左のメニューの **「書き出し…」** から「書き出す」を押します。書き出したファイルは
   左のパネルの「出力」に並び、「開く」「Finder で表示」ができます。パートナーに「書き出して」と頼んでも書き出せます
   （中身を見せて、確認してから実行します）。詳しくは [書き出す](./guides/export.ja.md)

パートナーが進めた作業は、1 つずつ「やったこと」として節目に残ります。プロジェクトのホームの「履歴」から
「変更を見る」「ここまで戻す」ができます。公開・提出・有償の生成・外部への送信・元素材の削除のような
戻せないことだけは、パートナーが止まって画面の上に帯を出し、「承認」「やめる」で答えます。

### ターミナルで最初のプロジェクトを作る

```sh
akari new my-video
```

`akari new <dir>` は、空のプロジェクトを新しく作ります。次のオプションがあります。

| 形 | 意味 |
|---|---|
| `akari new <dir>` | 空のプロジェクトを作る |
| `akari new <dir> --scaffold <path>` | 指定した土台（scaffold）から作る。v1.5.0 では `--template`（次の版から `--scaffold`。旧名は別名として残ります） |
| `akari new <dir> --from <作り方のディレクトリ \| id>` | 作り方（playbook）から作る。流れと設定を引き継ぎます |
| `--lang <code>` | 作品の言語（`en` など）を指定する。`.akari/intake.json` の `language` に入ります |

<!-- BEGIN GENERATED facts:cli.new -->
```sh
akari new <target-dir> [--scaffold <path>] [--template <path>（--scaffold の別名）] [--lang <code>]
```

`--template` は `--scaffold` の別名として使えます。
<!-- END GENERATED facts:cli.new -->

作り方は `akari playbook list`（手元・チャンネル・Lab の一覧）で確かめられ、途中のプロジェクトには
`akari playbook apply <id> --into <project>` で当てられます（既存のカットは動かさず、足りない仮枠と予定だけを足します）。

引数なしの `akari` を実行すると、プロジェクトを開いて AI エージェントを起動します（未作成なら自動で作ります）。
AI エージェントに「**プロジェクトを作りたい**」と伝えても、同じ一式ができます:

```
my-video/
├── .akari/
│   ├── intake.json        ← 進め方フォーム（最初に記入する）
│   ├── connections.json   ← 接続レジストリ（API キー参照・モデル選択）
│   ├── workflow.json      ← プロジェクトのロール定義
│   ├── events/            ← 節目の記録（「続きから」の合図）
│   ├── reports/           ← 作成結果などのレポート
│   └── sidecars/          ← 素材ごとの分析などの付属データ
├── .agents/ .claude/ .codex/ .cursor/ .opencode/ .devin/
│                          ← 各エージェント向けの入口（skills/ へのリンク）
├── edit.json              ← 編集データの正本（v2）
├── assets/                ← 素材置き場
├── planning/              ← 企画・計画文書
├── exports/               ← 書き出し先
├── AGENTS.md / CLAUDE.md  ← エージェント向けの案内
└── akari.sh
```

いまの状態は `akari status` で確かめます。次にやること（`next_skill`）や、人の操作待ちかどうかが分かります。
部品が足りないときは `akari doctor` が、必須部品の有無と見つけた場所を診断します。

---

## 進め方フォーム（intake.json）を埋める

プロジェクト作成直後の `.akari/intake.json` は `status: draft` です。
3 つの項目に答えて `submitted` にすると、パートナーが動き出せます。

| 項目 | 意味 | 例 |
|---|---|---|
| `tasks` | やること。決まった 5 つの id から選ぶ | 文字起こし・テロップ（`transcribe-captions`）/ いらない間・NG のカット（`silence-cut`）/ BGM・効果音（`bgm-sfx`）/ ナレーション（`narration`）/ 3D・画面はめ込みの演出（`3d-inserts`） |
| `target` | 尺 | 目標の秒数（`duration_s`。画面では 15 秒 / 30 秒 / 60 秒 / 3 分まで）、または「切らずにそのまま」（`keep_length: true`）。どちらか片方だけ。雰囲気を自由記述する `taste` は任意 |
| `autonomy` | おまかせ度 | `full-auto`（そのまま — 言った通りに入れて、見ずに書き出す）/ `checkpoint`（提案つき・既定 — 良さそうな物も入れて見せる。確認は書き出しの 1 回）/ `collaborative`（一緒に作る — 方針・素材・実行の要所で確認） |

このほか、人が読む名前の `title` と、作品の言語の `language` を持てます（どちらも任意）。

フォームはアプリのホームの「進め方フォームを開く」から埋められます。「この内容でパートナーに依頼する」を押すと、
チェックした内容がそのままパートナーへの指示になり、`submitted` で保存されます。チャットで埋めることもできます。
「**進め方フォームを埋めたい**」と言えば、エージェントが質問しながら記入します。

---

## Lab と連携する

AKARI Video Lab（[akari.video/lab](https://akari.video/lab/)）は、素材やスタイル、テンプレート、作り方を配るライブラリです。
配布は **無料** と **Pro** の 2 階層です。無料の素材は CC0 で、Pro は Pro パス（Lifetime プラン）を持つ人が使えます。
Pro の素材も、Lab で中身を確かめられます。

連携は最初の 1 回だけです。

- **アプリから**: 設定の「AKARI アカウント」→「接続する」を押し、開いたブラウザで確認コードを見て「承認」します。
  初回セットアップの「素材」の画面にある「AKARI Video Lab とつなぐ」からでも同じです
- **CLI から**: `akari store connect`（ブラウザで承認します。`--no-open` でブラウザを開かない、`--token` で手動指定もできます）。
  接続状態と購入済みの一覧は `akari store status` で確かめます

つなぐと、無料の素材パックと、購入した Pro の素材がアプリに届きます。Lab の素材はライブラリで出どころを
「Lab」にして探し、「使う」を押すだけで取得してタイムラインに置けます。

**作り方の例**: Lab では、作り方の例を 10 本（映画・短編ドラマ・MV・解説・商品紹介・Vlog・CM・教育・切り抜き・ロゴ）
無料で配っています。`akari store install <id>` で入れると、ホームの「<!-- F ui.home.startButton -->＋ 新しい動画を始める<!-- /F -->」→「作り方から」の
一覧に、入手先「Lab」として出ます。作り方だけの品を入れても、Claude Code の拡張キットを有効にする手順は要りません
（スキルを含む品のときだけ出ます）。

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

4. **確認して直す** → プレビューで再生し、直したい所に印を付けて「<!-- F ui.annotation.handToAi -->AI に渡す<!-- /F -->」
   → [確認して直す](./guides/review-and-fix.ja.md)

5. **書き出す** → 「書き出して」
   → lint PASS → あなたが承認 → `exports/` に MP4 が保存される
   → [書き出す](./guides/export.ja.md)

   lint を手元で確かめたいときは `akari lint .` を使います（ファイルは書き換えません）。機械的に直せる指摘は
   `akari lint . --fix` で修正でき、変更したファイル・差分・バックアップ先が出力の冒頭に出ます。

### 素材がない場合

「何か動画を作りたい」という話題から始められます。
エージェントが質問しながら企画を立て、素材の調達方法を提案します。
→ [ゼロから企画する](./guides/plan-from-scratch.ja.md)

---

## よくある質問

**Q. プログラミングの知識は必要？**
いりません。AI エージェントがすべてやります。
あなたは「何を作りたいか」と「いいか確認して直す」だけです。

**Q. 料金はかかる？**
AKARI Video のアプリは無料です。ローカル完結の範囲（プロキシ生成・文字起こし・編集・書き出し）に費用はかかりません。
AI パートナーは、使う AI の契約（Claude Code・Codex ならそれぞれのサブスクなど）が別に要ります。無料枠のある AI や、
opencode の無料モデルから始めることもできます。外部 API（クラウド文字起こし・ナレーション生成など）を使う場合のみ課金されます。
Lab の素材は無料と Pro の 2 階層です。

**Q. Windows で動きますか？**
はい。アプリは Windows（x64）と macOS（Apple Silicon）に対応しています。Windows 版にはまだコード署名がないため、
初回に確認画面が出ます（上の「Windows で最初に出る確認画面」）。CLI は Linux（WSL2 含む）でも使えます。

**Q. 英語しかわからないのですが？**
アプリの言語は設定の「言語」で日本語 / English を選べます（初期値は OS の言語設定に合わせます）。
英語の画面では、素材の名前やはじめてのガイドも英語で出ます。ただし一部のエラーメッセージやドキュメントは日本語のことがあります。

<!-- BEGIN GENERATED facts:stamp -->
この文書は AKARI Video v1.5.1（2026-10-19 公開）時点の説明です。
<!-- END GENERATED facts:stamp -->
