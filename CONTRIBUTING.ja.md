# コントリビューションガイド

AKARI Video への貢献に興味を持ってくれてありがとうございます。
バグ報告・機能要望は [GitHub issue](https://github.com/AkariLabs/akari-video/issues)、
コードの変更は Pull Request でお願いします。

English: [CONTRIBUTING.md](CONTRIBUTING.md)

## リポジトリモデル

AKARI Video は 2 層で運営しています:

- **この公開 OSS リポジトリ** — プロダクト本体（コード・スキル・スキーマ・ドキュメント）と、
  issue / PR の公開窓口
- **非公開のメンテナリポジトリ** — プロダクト運営（戦略・実機検証・スクリーニング / 検収基盤）

外部 PR はこの公開リポでスクリーニング + レビューされます。メンテナが変更を絞り込んだり、
形を変えて取り込むことがあります。**そのまま merge されなくても、PR は価値ある貢献です。**

## 開発の流れ

1. 最新の `main` から作業ブランチを切り、変更は小さく保つ。
2. リポジトリ直下で `npm install`（`--ignore-scripts` は付けない。`packages/media-bin` が
   `postinstall` で ffmpeg を取得するため）。デスクトップのシェルは `apps/shell` の中で
   `npm install --no-workspaces`（Windows の手順は [Windows ビルド手順書](docs/dev/windows-build.md)）。
   CI の Node は 26.3.0 に固定。
3. 触った範囲に合う検査（下表）を走らせてから、テンプレートに沿って PR を出す。

### 検査

| コマンド | 何を見るか |
|---|---|
| `npm run lint:i18n` | 画面の文言のカタログが `ja` と `en` で同じキーを持つこと・プレースホルダが揃うこと・静的な `t('key')` が実在すること・直書きの日本語が増えていないこと |
| `npm run check:docs-sync` | docs に書いたスキル数が `skills/` と一致すること・`docs/contract-*.md` が `docs/README.md` と `docs/README.ja.md` の両方から辿れること |
| `npm run check:skills-index` | `AGENTS.md` のスキル索引が最新であること（直すときは `npm run gen:skills-index`） |
| `npm run check:entry-skill` | 入口スキルの説明が汎用のままであること（特定の工程名を書かない） |
| `npm run check:cross-package-imports` | パッケージ間の import が、配布物に入る範囲に収まっていること |
| `npm run check:status-core` / `check:generation-models` / `check:cut-candidates` | 生成物が生成元と一致すること（直すときは対応する `gen:*`） |

ユニットテストはレーンに分かれています。どのパッケージがどのレーンかは `npm run test:lanes` で見られます。

| レーン | コマンド | 備考 |
|---|---|---|
| pure | `npm run test:unit` | 外部ツール不要・決定論。CI で必須 |
| shell | `npm run test:shell` | デスクトップのシェルと拡張。CI で必須 |
| media | `npm run test:media` | ffmpeg / ffprobe / Chrome が要る。CI では参考 |
| quarantine | `npm run test:quarantine` | `main` で既に赤く修正待ちのもの。参考 |

パッケージ単位なら、そのパッケージの中で `node --test` でも走らせられます。

### 画面の文言と i18n

アプリに出す文言は `packages/i18n/locales/<ja|en>/<namespace>.json` に置き、コードにはキーだけを書きます
（`t('settings.appearance.language.auto')`）。キーは必ず両言語に足し、文言を変えてもキーは変えず、
日本語の直書きを増やさないでください。編集したら `npm run lint:i18n`（カタログの再生成は
`npm run gen:i18n-catalog`）。規約の全文は
[`docs/contract-2026-10-11-ui-i18n.md`](docs/contract-2026-10-11-ui-i18n.md)。画面と docs の語は
[`docs/contract-2026-10-16-vocabulary-v0.md`](docs/contract-2026-10-16-vocabulary-v0.md)
（素材・スタイル・テンプレート・作例・作り方）に従い、`kind`・ファイル名・CLI のフラグなど内部の名前は変えません。

### ドキュメント

ユーザー向けの docs は英語を正典のパスに置き、日本語版を隣に `<name>.ja.md` として置きます。
両方を同じコミットで直してください。新しい `docs/contract-*.md` は `docs/README.md` と
`docs/README.ja.md` の両方の索引に足すまでが一式です。

## PR の基本

- 1 PR = 1 つの明確な課題。大きな変更は分割 PR にし、マージ順の依存を PR 説明に明記してください
- コミットメッセージは日本語本文 + プレフィックス（`[機能]` `[改善]` `[修正]` `[ドキュメント]` など。
  マージとリリースのコミットは `[合流]` `[リリース]`）
- 上の検査と、触ったパッケージのテストが通ること。**何を実行し、何を実行できなかったか**を
  PR 説明に書いてください
- issue の `accepted` ラベルは「方向性は妥当」の意味です。実装・取り込みの約束ではありません
- 古くなった PR・コンフリクトした PR・スコープが広すぎる PR・安全でない PR は close する
  ことがあります。最新 `main` に対する小さな PR のほうがずっと取り込まれやすいです

## PR のサルベージと共著（co-author）

レビューの往復を減らすため、メンテナが PR を**サルベージ**することがあります —
差し戻して再提出をお願いする代わりに、メンテナ側でブランチを引き取り、残りを仕上げて
マージまで持っていくやり方です。その際もあなたのクレジットは必ず保持します:

- あなたのコミットは可能な限りそのまま（または cherry-pick で）残します。
  git 履歴上の著者性（authorship）は消えません
- メンテナが書き直し・squash した部分は `Co-authored-by:` トレーラーでクレジットします。
  引き取り PR はタイトルに `(salvage of #N)` と付け、元 PR を明示します
- 同じ課題に複数の PR が届いた場合、1 つのコミットに統合し、**全員を co-author として
  クレジット**することがあります
- **クレジットは人間に帰します。** AI エージェントで PR を作った場合でも、コミットの
  author はツールではなくあなた（人間のコントリビュータ）名義を推奨します —
  git の author 設定をご自身にしておいてください

PR の **「Allow edits by maintainers」を有効**にしておくと、あなたの PR 自体をそのまま
merged にできるためサルベージが速く進みます。「自分で直し切りたい」場合は PR 説明に
その旨を書いてください — 通常のレビューフィードバックをお返しします。

## 外部 PR の受け入れスクリーニング

外部からの PR は、マージ前に**自動スクリーニング + メンテナのレビュー**を通ります。
以下のパターンは自動的にフラグが立ちます。**フラグ = 拒否ではありません**
（誤検知はメンテナが裁定します）が、該当する場合は **PR テンプレートの
「セキュリティ自己申告」欄に書いておく**とレビューが速く進みます。

| パターン | 扱い |
|---|---|
| `curl … \| sh` 形式のワンライナー（**表示用文字列・案内文の中でも**検知されます） | 原則、公式ページへのリンク案内を推奨。必要な場合は理由を明記 |
| コード内の新しい外部ドメインへの URL | ドメインごとにメンテナが承認。用途を PR 説明に明記 |
| 依存の追加・変更 | レジストリ配布のみ（`git:` / `http:` / `file:` ソース不可）。追加理由を明記 |
| `package.json` への lifecycle scripts（`postinstall` 等）の追加 | 事前相談なしでは受け入れません |
| secrets・秘匿パスの読み出し（`.env` / `~/.ssh` / `process.env` 一括列挙 等） | 受け入れません |
| `eval` / `new Function` / base64・hex 塊などの難読化 | 受け入れません |
| `child_process` 系の追加 | 個別レビュー（このリポではテスト・CLI の常用イディオムなので、用途が明確なら問題ありません） |
| `.github/`・CI 設定の変更 | 機能 PR に混ぜず、事前に issue で相談してください |

## 高リスク領域

以下に触る変更は明確なテスト計画が必要です。メンテナが非公開リポ側で実装し直してから
取り込む場合があります:

- **レンダーパイプラインとそこに到達するすべて** — レンダー経路は決定論・オフラインが契約。
  ネットワーク到達（CDN フォント・外部画像参照を含む）はそれ自体が欠陥として扱われます
- **ランチャー・インストーラー・update チェック** — プロセス実行面
- **`.github/`・CI・リリースワークフロー**
- **ファイル契約・スキーマ** — `edit.json` / `meta.json` / `.akari/connections.json` を扱うもの
- **スキル・プラグインの指示ファイル** — AI エージェントハーネスが実行するものです。
  [SECURITY.ja.md](SECURITY.ja.md) を参照

## セキュリティ

[SECURITY.ja.md](SECURITY.ja.md) を参照してください。`.akari/connections.json` の中身・
生成プロバイダの API キー・私的データを含む映像 / スクリーンショットは issue / PR に
絶対に貼らないでください。脆弱性の報告は公開 issue ではなく、リポジトリの Security タブ
（private vulnerability reporting）からお願いします。
