# akari-video — AKARI Video モノレポ

> AI 動画編集ツール「AKARI Video」の製品モノレポ（公開リポ。v1.5 系）。
> デスクトップアプリ（Theia ベースのシェル）・CLI `akari`・Claude Code プラグイン・28 本のスキルを含む。
> 新しく入る人は [docs/README.md](docs/README.md)（索引）→ [docs/getting-started.md](docs/getting-started.md) の順に読む。
> 戦略・実機検証・運用の記録は非公開のメンテナリポにあり、ここには置かない。

## 構造

| ディレクトリ | 内容 |
|---|---|
| `apps/shell/` | Theia + Electron のデスクトップアプリ本体（`extensions/` に拡張 14 個。ホーム・プロジェクトパネル・ライブラリ・プレビュー・注釈・タイムライン・台本・AI パートナーなど）。Windows のビルドは [docs/dev/windows-build.md](docs/dev/windows-build.md) |
| `packages/` | シェル非依存のライブラリと CLI（`akari-launcher` = `akari` コマンド・`schemas`・`edit-store`・`edit-lint`・`render-cut`・`i18n` ほか） |
| `skills/` | エージェント側のスキル 28 本（調査・企画・編集・QA。ステージはアプリ機能にしない）。一覧は [docs/skills.md](docs/skills.md) |
| `plugin/` `.claude-plugin/` | Claude Code プラグインとマーケットプレイス定義（[plugin/README.md](plugin/README.md)）。スキルは `skills/` へのシンボリックリンクで正本を共有する |
| `templates/` | **空のプロジェクトの土台**（`project-default/` = scaffold。コードとスキルが参照する製品の一部）と、解説ショートの見本（`kaisetsu-short/`）。画面の「テンプレート」とは別物（[templates/INDEX.md](templates/INDEX.md)） |
| `assets/` | 同梱の素材（`meta.json` 契約。[assets/INDEX.md](assets/INDEX.md)） |
| `catalog/` | 素材の取得先の索引（**参照配布のみ**。メタデータ・ツマミ宣言・プレビュー。実体バイナリは置かない。[catalog/INDEX.md](catalog/INDEX.md)） |
| `presets/` | コードが id で引く読み取り専用の参照表（字幕スタイル・動き・つなぎ・LUT など）。素材ライブラリ契約の対象外（[presets/INDEX.md](presets/INDEX.md)） |
| `docs/` | 利用者向けの文書（getting-started・guides・how-to・skills）と設計契約（`contract-*.md`）。索引は `docs/README.md` / `docs/README.ja.md` |
| `scripts/` | 検査・生成・リリースのスクリプト（`check-docs-sync.mjs` など） |

## 画面の語

アプリの画面と docs の語は [docs/contract-2026-10-16-vocabulary-v0.md](docs/contract-2026-10-16-vocabulary-v0.md) が正本。
旧名との対応は [docs/aliases.md](docs/aliases.md)。

- **素材**（足す）・**スタイル**（当てる。素材の分類の 1 つ）・**テンプレート**（枠を埋めて使うまとまり 1 つ）・
  **作例**（見て参考にする完成した 1 本。アプリ側の実装はまだなので「使える機能」として書かない）・
  **作り方**（読む。1 本ぶんの手順と設定）
- 「テンプレ」「プレイブック」のような略称・外来語は画面にも docs にも書かない。「オーバーレイ」は **動く部品**、
  「レシピ」は画面に出さない（3D の設定・道具の手順）、「ひな形」「器」も画面に出さない（CLI は「空のプロジェクト」「土台」= scaffold）
- 内部の名前（`kind`・ファイル名・CLI のフラグ・スキル名・i18n のキー）は語を変えても変えない。旧名は読み取りだけ永続で残す

## 検査（変更を出す前に）

```sh
npm run check:docs-sync        # docs のスキル数の表記・契約索引の網羅
npm run check:skills-index     # AGENTS.md のスキル索引（直すときは npm run gen:skills-index）
npm run lint:i18n              # 画面の文言のキー・プレースホルダ・日本語の直書き
npm run test:unit              # pure レーン（CI 必須）。shell レーンは npm run test:shell
```

ほかの検査とテストのレーンは [CONTRIBUTING.md](CONTRIBUTING.md) にまとめてある。

## 設計の不変条件（正本は `docs/contract-*.md`）

- **ファイル契約が結合の全て**: アプリ⇄エージェント間に IPC を置かない。
  タブ = ファイル + サイドカー、応答 = decisions.json / review.json / git diff の 3 チャネル
- **ハーネス非依存**: エージェント統合は PTY + ファイル契約。opencode / Claude Code どちらでも動く
- **ステージを実装しない**: ステージ = スキル + サーフェス規約。アプリは汎用基盤 4 点のみ
  - 適用注記（2026-07-25 オーナー裁定）: **宣言済み入力で走る決定論的 CLI
    （edit-lint / render-cut 等）の直接実行と進捗表示は汎用基盤に含む**。
    判断・創作を伴う工程（計画・素材選定・QA 裁定）は従来どおりスキル
- **モードスイッチは developer mode の 1 個だけ**。モードを増やさない
- 拡張の導入は **namespace/ID ピン留め**（Open VSX 検索は使わない）+ プラットフォーム別バイナリ検証

## 規約

- コミット: 日本語本文 + プレフィックス（`[機能]` `[改善]` `[修正]` `[ドキュメント]` 等。マージは `[合流]`、リリースは `[リリース]`）
- 有償の素材（Pro）や非公開の素材はこのリポに置かない（実体は Lab 側。ここには参照のみ）。素材を同梱するのはオーナーが明示したときだけ
- Secrets を書かない（.env 系は別管理）
- 新規 `docs/contract-*.md` は `docs/README.md`・`docs/README.ja.md` 両索引への追記まで含めて
  完了（CI: `npm run check:docs-sync` が索引漏れ・スキル数の手書き数字ドリフトを検出する）
- **Windows では作業スクリプトを PowerShell（`.ps1`）ではなく Node（`.mjs`）で書く**:
  Windows PowerShell 5.1 は BOM なし UTF-8 の `.ps1` を ANSI（CP932）として解釈するため
  日本語が文字化けして構文が壊れ、さらにヒアストリング終端（`'@`）を LF 改行では認識しない
  （CRLF 必須）。エージェントのファイル書き込みは BOM なし・LF が既定なので両方に当たる。
  Node は AKARI Video の動作要件そのものなので、`.mjs` で書けばこの 2 つとも起こらない
  （PowerShell 7 では両方解消済み。ただし一般の Windows 機に入っている前提は置けない）

## ドキュメント i18n 規約（2026-07-26 オーナー裁定）

グローバル向けの標準形に従う: **英語が正典、日本語は併設**。

- **正典パスは英語**: ユーザー向けドキュメント（`README.md`・`docs/` のユーザー文書）は
  英語版を正典パスに置き、日本語版を同ディレクトリの `<name>.ja.md` に併設する。
  両ファイル冒頭に言語スイッチャー行（`**English** | [日本語](./<name>.ja.md)` / その逆）を置く
- **執筆は日本語からでよい**: 日本語側を書き換えたら、**同じ作業単位（同一コミット）で
  英語正典へ反映する**。翻訳・同期はエージェントの仕事。対訳ペアの片側だけを変更した
  コミットは逸脱として扱う（レーン検収の確認項目）
- **対訳ペアの範囲**: README・docs/README・introduction・getting-started・guides/・how-to/・
  **docs/skills（スキルカタログ）**。
  Reference（contract-* / notes-* / design-*）と dev/ は日本語のみで可
  （正確性最優先。翻訳は需要が出た時点で追加し、以後ペア維持）
- **リンクは同言語へ**: 英語ページからは英語ページへ、`.ja.md` からは `.ja.md` へ。
  対訳の無い日本語のみのページへ英語側からリンクする場合は末尾に "(Japanese)" を付記する
- **図・画像**: ラベルは英語で作り両言語で共用（`docs/assets/brand/` 等）。
  Mermaid などページ内に書く図はページの言語に合わせる
- **スキル・プラグイン（2026-10-11 改訂）**: SKILL.md と付属 md の本文は**英語が正典**。
  日本語の対訳は併設しない（人間向けのスキル説明は `docs/skills.md` / `docs/skills.ja.md` の対訳ペアが担う）。
  執筆・修正の指示は日本語でよく、英語正典への反映はエージェントの仕事
- **応答言語**: 各 SKILL.md 冒頭（H1 直後）に、ユーザーへの応答言語をユーザーの使用言語に合わせる旨の
  1 行を必ず置く（従来どおり）
- **言語パック**: 作品の言語（テロップ・字幕・ナレーション・文字起こし）に依存する知識はスキル本文に書かず、
  `skills/<skill>/lang/<code>.md` に置く。パックはその言語で書いてよい（日本語パックは日本語）。
  別言語のパックを翻訳で作らない
- アプリの文言はカタログ（`packages/i18n/locales/<ja|en>/`）に置き、コードには `t('key')` だけを書く。
  キーは両言語に足し、文言を変えてもキーは変えない（規約: [docs/contract-2026-10-11-ui-i18n.md](docs/contract-2026-10-11-ui-i18n.md)）
- 直書きの日本語を増やさない（`npm run lint:i18n`）。
