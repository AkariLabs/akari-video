# AKARI Video ドキュメント

**動画を投げるだけで、いい感じに編集されている。開いて確認して、直したいところだけ直す。**

- はじめての人 → [Introduction](./introduction.md)（思想と全体像）→
  [Getting Started](./getting-started.md)（最初のプロジェクト）
- やりたいことがある人 → [Guides](#guides)
- 仕組み・運用を知りたい人 → [How-to](#how-to)
- スキーマ・契約を確認したい人 → [Reference](#reference)

## Getting Started

| ページ | 内容 |
|---|---|
| [Introduction](./introduction.md) | AKARI Video とは — 3 つの原則・アーキテクチャ概観・ワークフロー |
| [Getting Started](./getting-started.md) | 3 つの入口・最初のプロジェクト作成・進め方フォーム |

## Guides

タスク別ガイド。制作の流れ順に並んでいます。

| ページ | 内容 |
|---|---|
| [ゼロから企画する](./guides/plan-from-scratch.md) | ネタ出し → 調査 → 企画書 → 絵コンテ → 撮影リスト（research-plan） |
| [素材を分析する](./guides/analyze-footage.md) | プロキシ・文字起こし・キーフレーム抽出と横断分析（analyze-footage / analyze-project） |
| [編集計画を立てて実行する](./guides/plan-your-edit.md) | 3 段階承認で edit.json へ（edit-plan） |
| [テロップ・字幕・図表・3D を作る](./guides/overlays-and-captions.md) | AI が描く表現と「触れるオーバーレイ」（overlay-authoring） |
| [ナレーションを付ける](./guides/narration.md) | ローカル無償 / 声クローン（generate-narration） |
| [QA・レビューして直す](./guides/review-and-fix.md) | 機械検査・口頭レビューのチケット化・対応（edit-lint / compile-review-session / address-review） |
| [書き出す](./guides/export.md) | 計画 → 承認 → レンダリング → 検証（render-cut） |
| [素材ライブラリを育てる](./guides/asset-library.md) | セットアップ・音源・成果物の入庫（setup-library / setup-audio-library / harvest-asset） |
| [3D シーンをベイクする](./guides/bake-3d.md) | Blender ヘッドレスでレシピを映像素材に（bake-3d） |

## How-to

| ページ | 内容 |
|---|---|
| [接続と API キー](./how-to/connections.md) | 接続レジストリ・doctor 診断・コスト承認ポリシー（manage-connections） |
| [プロジェクト構成](./how-to/project-structure.md) | `.akari/` 配下のファイルの役割と削除してよいもの |
| [続きから再開する](./how-to/resume-session.md) | `.akari/events/` と SessionStart hook の仕組み |
| [FAQ・トラブルシューティング](./how-to/faq.md) | よくある質問とエラー対処 |

## Reference

データ契約（スキーマ）と設計文書。**正典は本リポ。** すべての契約は
[版管理三原則](./contract-2026-07-17-data-contract-versioning.md)（version 必須・追加のみ進化・
明示マイグレーション）に従います。

### 設計・横断規約

| ファイル | 内容 |
|---|---|
| [design-2026-07-13-agent-native-architecture.md](./design-2026-07-13-agent-native-architecture.md) | agent-native アーキテクチャの思想の正本（サンドイッチ 3 層・編集モデル・MVP マイルストーン） |
| [contract-2026-07-17-data-contract-versioning.md](./contract-2026-07-17-data-contract-versioning.md) | データ契約の版管理・移行原則（横断契約） |
| [contract-2026-07-25-project-structure-v0.md](./contract-2026-07-25-project-structure-v0.md) | 生成物の置き場所契約（層の定義・ルート直下原則・削除安全） |

### edit.json（編集のセーブデータ）

| ファイル | 内容 |
|---|---|
| [contract-2026-07-13-m1-m4.md](./contract-2026-07-13-m1-m4.md) | edit.json スキーマ v0 の確定契約 |
| [contract-2026-07-18-edit-json-v1-sources.md](./contract-2026-07-18-edit-json-v1-sources.md) | v1 sources（複数素材・(src, source 秒) 永続化の鉄則） |
| [contract-2026-07-14-edit-json-v1-crop.md](./contract-2026-07-14-edit-json-v1-crop.md) | v1 crop（リフレーミング） |
| [contract-2026-07-14-edit-json-v1-audio.md](./contract-2026-07-14-edit-json-v1-audio.md) | v1 音声（BGM / SFX） |
| [contract-2026-07-20-edit-json-v1-narration.md](./contract-2026-07-20-edit-json-v1-narration.md) | v1 ナレーション |
| [contract-2026-07-22-edit-json-v1-beats.md](./contract-2026-07-22-edit-json-v1-beats.md) | v1 ビート（音楽同期） |
| [contract-2026-07-23-edit-json-v1-direction.md](./contract-2026-07-23-edit-json-v1-direction.md) | v1 演出（direction） |
| [contract-2026-07-23-edit-json-v1-emphasis-words.md](./contract-2026-07-23-edit-json-v1-emphasis-words.md) | v1 強調ワード |
| [contract-2026-07-22-render-basics.md](./contract-2026-07-22-render-basics.md) | レンダー基礎機能（速度・クロマキー・トランジション・LUT・音声マスター） |
| [contract-2026-07-25-r6-audio-tracks-and-trim.md](./contract-2026-07-25-r6-audio-tracks-and-trim.md) | タイムライン配置原則・音源複数トラック・音源トリム・ソーストリマー |

### 分析・プラン・レビュー

| ファイル | 内容 |
|---|---|
| [contract-2026-07-13-m5-analysis-report.md](./contract-2026-07-13-m5-analysis-report.md) | 分析パイプライン（analysis.json）+ 編集判断レポート |
| [contract-2026-07-23-analysis-person-matte.md](./contract-2026-07-23-analysis-person-matte.md) | 人物マット抽出（text-behind-person の基盤） |
| [contract-2026-07-20-plan-json-v0.md](./contract-2026-07-20-plan-json-v0.md) | plan.json v0（仮枠タイムライン・確定度つきスロット列） |
| [contract-2026-07-25-plan-comments-v0.md](./contract-2026-07-25-plan-comments-v0.md) | plan-comments.json v0（承認可能プラン層への構造化差し戻し） |
| [contract-2026-07-20-review-json-v1-annotation-model.md](./contract-2026-07-20-review-json-v1-annotation-model.md) | review.json v1 注釈モデル（target 5 型） |

### 素材・個人層

| ファイル | 内容 |
|---|---|
| [contract-2026-07-13-asset-library.md](./contract-2026-07-13-asset-library.md) | 素材ライブラリ契約（meta.json・入庫基準・スコープ階層） |
| [contract-2026-07-14-3d-bake-recipe.md](./contract-2026-07-14-3d-bake-recipe.md) | 3D ベイクレシピ契約（Blender 経路） |
| [contract-2026-07-25-recipe-v0.md](./contract-2026-07-25-recipe-v0.md) | recipe.json v0（確認済み選好の凍結と提示） |

### 方向性メモ

実装済み契約の設計背景を残すメモ。新規の方向性検討は非公開の内部記録で管理します。

| ファイル | 内容 |
|---|---|
| [notes-2026-07-13-edit-json-v1.md](./notes-2026-07-13-edit-json-v1.md) | edit.json v1 拡張の方向性（crop・レイアウト・音声・サムネ枠の初期案） |
| [notes-2026-07-14-captions-and-cut-editing.md](./notes-2026-07-14-captions-and-cut-editing.md) | 字幕とカット編集の方向性（word 精度カット・captions 第一級化・カラオケ表示） |
| [notes-2026-07-16-qa-lint-and-transcript-ui.md](./notes-2026-07-16-qa-lint-and-transcript-ui.md) | 自己検証ループとトランスクリプト編集 UI の方向性（edit-lint の原型） |

## 開発者向け

| ページ | 内容 |
|---|---|
| [dev/windows-build.md](./dev/windows-build.md) | Windows ビルドのチェックリスト |

コントリビュートの入口はリポジトリルートの [README](../README.md) と
各パッケージの README を参照してください。
