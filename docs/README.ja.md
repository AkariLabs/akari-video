[English](./README.md) | **日本語**

# AKARI Video ドキュメント

**動画を投げるだけで、いい感じに編集されている。開いて確認して、直したいところだけ直す。**

- English readers → [English documentation](./README.md)
- はじめての人 → [Introduction](./introduction.ja.md)（思想と全体像）→
  [Getting Started](./getting-started.ja.md)（最初のプロジェクト）
- やりたいことがある人 → [Guides](#guides)
- どのスキルが何をするか知りたい人 → [スキルカタログ](./skills.ja.md)
- 仕組み・運用を知りたい人 → [How-to](#how-to)
- スキーマ・契約を確認したい人 → [Reference](#reference)

## Getting Started

| ページ | 内容 |
|---|---|
| [Introduction](./introduction.ja.md) | AKARI Video とは — 3 つの原則・アーキテクチャ概観・ワークフロー（[English](./introduction.md)） |
| [Getting Started](./getting-started.ja.md) | 3 つの入口・最初のプロジェクト作成・進め方フォーム（[English](./getting-started.md)） |

## Guides

タスク別ガイド。制作の流れ順に並んでいます。

| ページ | 内容 |
|---|---|
| [ゼロから企画する](./guides/plan-from-scratch.ja.md) | ネタ出し → 調査 → 企画書 → 絵コンテ → 撮影リスト（research-plan） |
| [素材を分析する](./guides/analyze-footage.ja.md) | プロキシ・文字起こし・キーフレーム抽出と横断分析（analyze-footage / analyze-project） |
| [編集計画を立てて実行する](./guides/plan-your-edit.ja.md) | 3 段階承認で edit.json へ（edit-plan） |
| [テロップ・字幕・図表・3D を作る](./guides/overlays-and-captions.ja.md) | AI が描く表現と「触れるオーバーレイ」（overlay-authoring） |
| [ナレーションを付ける](./guides/narration.ja.md) | ローカル無償 / 声クローン（generate-narration） |
| [QA・レビューして直す](./guides/review-and-fix.ja.md) | 機械検査・口頭レビューのチケット化・対応（edit-lint / compile-review-session / address-review） |
| [書き出す](./guides/export.ja.md) | 計画 → 承認 → レンダリング → 検証（render-cut） |
| [素材ライブラリを育てる](./guides/asset-library.ja.md) | セットアップ・音源・成果物の入庫（setup-library / setup-audio-library / harvest-asset） |
| [3D シーンをベイクする](./guides/bake-3d.ja.md) | Blender ヘッドレスでレシピを映像素材に（bake-3d） |
| [音源に宣言を付ける](./guides/declare-audio.ja.md) | サビ・キメ・拍を自分の耳で付けて declarations.json へ（declare-audio） |
| [ビート同期で作る](./guides/beat-sync.ja.md) | 宣言済み音源から拍スナップの PV・ショーケースを機械生成（beat-sync-edit） |

## Skills

ワークフローは 22 のエージェント側スキルとして同梱されています。[スキルカタログ](./skills.ja.md)が
その一枚地図です — 各スキルの担当・発動タイミング・接続先の外部ツールと
アニメーションランタイム（3D の 2 経路含む）をまとめています。

## How-to

| ページ | 内容 |
|---|---|
| [接続と API キー](./how-to/connections.ja.md) | 接続レジストリ・doctor 診断・コスト承認ポリシー（manage-connections） |
| [シェル UI: 素材とタイムライン](./how-to/shell-ui.ja.md) | 素材カード・クリップの右クリックメニュー、タイムラインへの D&D、Finder で表示 |
| [プロジェクト構成](./how-to/project-structure.ja.md) | `.akari/` 配下のファイルの役割と削除してよいもの |
| [続きから再開する](./how-to/resume-session.ja.md) | `.akari/events/` と SessionStart hook の仕組み |
| [FAQ・トラブルシューティング](./how-to/faq.ja.md) | よくある質問とエラー対処 |

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
| [contract-2026-08-02-creator-root-v1.md](./contract-2026-08-02-creator-root-v1.md) | 作業場（CreatorRoot）契約 — プロジェクトの上の階層。3 つの場所・所有権 4 層・初回起動動線・可搬性 |
| [contract-2026-08-02-setup-remote-v0.md](./contract-2026-08-02-setup-remote-v0.md) | setup-remote スキル契約 v0 — 遠隔の閲覧・承認 + 素材受け渡し（Tailscale / Taildrop・既定 tailnet 限定） |
| [contract-2026-08-12-chat-approval-v0.md](./contract-2026-08-12-chat-approval-v0.md) | chat-approval 契約 v0 — 承認ゲートのチャット通知 + ボタン承認（Telegram・long polling・公開エンドポイントなし・自由文は指示として扱わない） |
| [contract-2026-08-03-status-integrity-v1.md](./contract-2026-08-03-status-integrity-v1.md) | canonical status・immutable render receipt・人間受理記録・capability absence receipt |
| [contract-2026-08-03-caption-display-encoding-qc-v1.md](./contract-2026-08-03-caption-display-encoding-qc-v1.md) | 共有字幕表示・reference-pixel layout・master encode・audio QC・recipe 境界 |

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
| [contract-2026-08-23-captions-emphasis-words-v0.md](./contract-2026-08-23-captions-emphasis-words-v0.md) | captions.json object ルートの語レベル演出 `emphasis_words[]` 席（edit.json v1 席は後方互換フォールバック） |
| [contract-2026-07-22-render-basics.md](./contract-2026-07-22-render-basics.md) | レンダー基礎機能（速度・クロマキー・トランジション・LUT・音声マスター） |
| [contract-2026-08-12-still-image-cut-source-v0.md](./contract-2026-08-12-still-image-cut-source-v0.md) | 静止画 cut ソース v0 — cuts[] のソースに静止画（拡張子判定）を許可し speed/freeze の適用範囲を拡張 |
| [contract-2026-07-25-r6-audio-tracks-and-trim.md](./contract-2026-07-25-r6-audio-tracks-and-trim.md) | タイムライン配置原則・音源複数トラック・音源トリム・ソーストリマー |
| [contract-2026-08-05-fx-v0.md](./contract-2026-08-05-fx-v0.md) | 画面 FX 小語彙 v0 — **2026-08-11 廃止**（冒頭の廃止追記を参照）。`presets/fx/` は空の参照表として存続 |
| [contract-2026-08-12-region-filter-layer-v0.md](./contract-2026-08-12-region-filter-layer-v0.md) | kind:"filter" レイヤー — region（perspective corners）内だけのルック切り替え（invert / lut / saturation）。追加 `-i` なし |
| [contract-2026-08-12-color-range-normalization-v0.md](./contract-2026-08-12-color-range-normalization-v0.md) | full-range（pc）の H.264 入力を limited range（tv）出力へ正規化 — 全エンコード工程で画素値変換（scale=out_range=tv）とメタデータタグ付け（-color_range tv）を対で実施。verify.color-range を追加 |

### 分析・プラン・レビュー

| ファイル | 内容 |
|---|---|
| [contract-2026-07-13-m5-analysis-report.md](./contract-2026-07-13-m5-analysis-report.md) | 分析パイプライン（analysis.json）+ 編集判断レポート |
| [contract-2026-07-23-analysis-person-matte.md](./contract-2026-07-23-analysis-person-matte.md) | 人物マット抽出（text-behind-person の基盤） |
| [contract-2026-08-11-analysis-vision-tracks-v0.md](./contract-2026-08-11-analysis-vision-tracks-v0.md) | Vision ランドマーク・トラック v0（face-landmarks / hand-pose）— トラックのデータ契約・サイドカー入出力・`layers[].keyframes` への消費 |
| [contract-2026-07-20-plan-json-v0.md](./contract-2026-07-20-plan-json-v0.md) | plan.json v0（仮枠タイムライン・確定度つきスロット列） |
| [contract-2026-07-25-plan-comments-v0.md](./contract-2026-07-25-plan-comments-v0.md) | plan-comments.json v0（承認可能プラン層への構造化差し戻し） |
| [contract-2026-07-20-review-json-v1-annotation-model.md](./contract-2026-07-20-review-json-v1-annotation-model.md) | review.json v1 注釈モデル（target 5 型） |
| [contract-2026-08-11-review-session-ui-events.md](./contract-2026-08-11-review-session-ui-events.md) | レビューセッション UI イベント（events.jsonl 拡張）+ 記録中インジケータ |
| [contract-2026-08-23-stroke-persistence.md](./contract-2026-08-23-stroke-persistence.md) | 注釈ストロークの永続表示（持続オーバーレイ + トグル + セッション再表示 + review.json の `strokeRefs`） |
| [contract-2026-08-03-cut-candidate-bridge-v1.md](./contract-2026-08-03-cut-candidate-bridge-v1.md) | semantic event と A4 pause 短縮の review-only candidate bridge |

### プレビュー・書き出し

| ファイル | 内容 |
|---|---|
| [contract-2026-08-02-preview-parity.md](./contract-2026-08-02-preview-parity.md) | プレビュー・パリティ契約 v0 — Web UI と shell の挙動仕様を単一化（同じ edit.json / captions.json → 同じ見た目・同じ挙動） |
| [contract-2026-08-01-export-nle-beta.md](./contract-2026-08-01-export-nle-beta.md) | export-nle: 他社 NLE への片道書き出し（FCPXML / FCP7 XML / SRT）— **BETA・実 NLE 取り込み未確認** |
| [contract-2026-08-28-osr-export-v0.md](./contract-2026-08-28-osr-export-v0.md) | ページ全体 Electron OSR 書き出し v0 — 4層ページ、seek/paint検証、器のフォールバック、メモリ上限 |

### 素材・個人層

| ファイル | 内容 |
|---|---|
| [contract-2026-07-13-asset-library.md](./contract-2026-07-13-asset-library.md) | 素材ライブラリ契約（meta.json・入庫基準・スコープ階層） |
| [contract-2026-07-14-3d-bake-recipe.md](./contract-2026-07-14-3d-bake-recipe.md) | 3D ベイクレシピ契約（Blender 経路） |
| [contract-2026-07-25-recipe-v0.md](./contract-2026-07-25-recipe-v0.md) | recipe.json v0（確認済み選好の凍結と提示） |
| [contract-2026-07-25-memory-connection-v0.md](./contract-2026-07-25-memory-connection-v0.md) | memory connection v0（外部参照記憶の接続宣言 — connections.json 拡張） |
| [contract-2026-07-26-avatar-registry-v0.md](./contract-2026-07-26-avatar-registry-v0.md) | アバター・レジストリ契約 v0（avatar.json / rendition.json / 段階読み出し） |
| [contract-2026-08-13-avatar-drive-v0.md](./contract-2026-08-13-avatar-drive-v0.md) | 2D アバター差分スプライト駆動 v0（音声エンベロープ口パク・決定論的まばたき・アルファ付きベイク） |
| [contract-2026-08-14-avatar-vrm-v0.md](./contract-2026-08-14-avatar-vrm-v0.md) | VRM アバター駆動バックエンド v0（VRM 0.x/1.0 Expressions・アルファ付きベイク） |
| [contract-2026-08-18-v1-render-parity.md](./contract-2026-08-18-v1-render-parity.md) | v1 レンダー経路パリティ — sources[] 経路での cuts[].at 明示配置（ギャップ）と cuts[].track 多段合成 |
| [contract-2026-08-28-v2-audio-roles-v0.md](./contract-2026-08-28-v2-audio-roles-v0.md) | v2 音声の役割整理 v0 — frame-engine 評価台へ Web Audio で bgm / narration / sfx を供給（ducking はカーネル・AudioContext の時計が master）。書き出しは ffmpeg のマスター処理が正。プレビュー vs 書き出しの差分実測と既定切替までに詰める項目 |

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

コントリビュートの入口はリポジトリルートの [README](../README.ja.md) と
各パッケージの README を参照してください。
