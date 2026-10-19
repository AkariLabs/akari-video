# 文書の事実を機械で揃える（docs facts）

画面の語（ボタン名・コマンド・数・版）は 1 か所の正から写す。正は i18n（`packages/i18n/locales/{ja,en}/*.json`）、CLI は launcher と `cli.json`、スキルは `skills/*/SKILL.md` の frontmatter、版は git のタグ。文書はそこから生成器が写し、人はマーカーの外を書くだけにする。

## 事実シートとマーカー

- 事実シート `docs/facts.json`（生成物・コミットする）: `meta`（version / releaseDate / shippedTag）・`ui.ja` / `ui.en`・`cli`・`paths`・`skills`（本数・名前・BETA）・`shipped`（配布中のタグと現在の語の差分）。
- マーカーは 3 種。生成器はマーカーの内側だけを書き換える。
  - 行内 `<!-- F ui.home.startButton -->＋ 新しい動画を始める<!-- /F -->`（画面の表示名 1 語。言語は `.ja.md` かどうかで決まる）
  - 区間 `<!-- BEGIN GENERATED facts:cli.new -->` … `<!-- END GENERATED facts:cli.new -->`（文面ごと差し替え）
  - 印 `facts:stamp`（「この文書は AKARI Video vX.Y.Z（YYYY-MM-DD 公開）時点の説明です。」日付はタグの日付）

マーカーの中は手で直さない。直したければ正（i18n など）を直す。未知のキーや対応の取れない区間は `--check` が赤になる。

## 生成と検査

- `npm run gen:docs-facts` … facts.json とマーカー区間を再生成する
- `npm run check:docs-facts` … 再生成して差分が出たら赤（CI の `skills-index` ジョブが走らせる）

## 版の選び方（安定版優先）

候補は (a) HEAD から届くタグ（`git describe`）と (b) 親 commit が HEAD の祖先である `v*` タグ。候補のうち**安定版（`-` を含まない）があればその中で semver が最も高いもの**を、安定版が無いときだけプレリリースの最高を採る。main に `v1.6.0-beta.1` を打った時点で docs の印が beta に変わると、配布中の安定版を使う人向けの説明とずれるため。

## リリース後の工程

安定版タグ `vX.Y.Z` を push すると、`docs-facts-release` ワークフローが main の docs をそのタグに合わせて再生成し、ブランチ `docs-facts/<tag>` と PR（組織の設定で PR 作成が無効なら比較リンク）を出す。メンテナが PR を合流する。プレリリースタグでは何もしない。

タグ push の直後から PR 合流までの間、main の `check:docs-facts` は「版がタグとずれている」ため赤になる（docs の印が旧版を指したまま、生成器は新タグを選ぶ）。PR がそのずれを直すので、早めに合流する。

試運転はブランチ・PR を作らず diff の要約だけ出す:

```
gh workflow run docs-facts-release.yml -f tag=v1.5.0 -f dry_run=true
```

## アップデート投稿の下書き

`scripts/release/gen-update-post.mjs` が Discord「アップデート」投稿の骨組みを事実（`shipped` の差分・新規スキル）から吐く。見どころは人が書く。

```
node scripts/release/gen-update-post.mjs --tag v1.5.0 --previous v1.4.1
```
