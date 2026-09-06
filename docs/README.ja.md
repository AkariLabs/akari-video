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
| [edit.json の読み方](./guides/edit-json-access.ja.md) | 全文を読まず id で探し、点の変更または edit-store スクリプトで書く |

## Skills

ワークフローは 23 のエージェント側スキルとして同梱されています。[スキルカタログ](./skills.ja.md)が
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
| [contract-2026-09-02-captions-style-preset-v0.md](./contract-2026-09-02-captions-style-preset-v0.md) | `captions[].style_preset` の id 参照・解決順・生成 textstyle カタログ・ピッカー一括適用 RPC・行バッジ・無料字幕テンプレ 3 種 |
| [contract-2026-07-22-render-basics.md](./contract-2026-07-22-render-basics.md) | レンダー基礎機能（速度・クロマキー・トランジション・LUT・音声マスター） |
| [contract-2026-08-12-still-image-cut-source-v0.md](./contract-2026-08-12-still-image-cut-source-v0.md) | 静止画 cut ソース v0 — cuts[] のソースに静止画（拡張子判定）を許可し speed/freeze の適用範囲を拡張 |
| [contract-2026-07-25-r6-audio-tracks-and-trim.md](./contract-2026-07-25-r6-audio-tracks-and-trim.md) | タイムライン配置原則・音源複数トラック・音源トリム・ソーストリマー |
| [contract-2026-09-06-cut-audio-split-v0.md](./contract-2026-09-06-cut-audio-split-v0.md) | 本編（cut）の映像と音声の分離 v0 — 現状の模型・3 案比較・推奨・段取り（草案・未裁定） |
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
| [contract-2026-08-02-preview-parity.md](./contract-2026-08-02-preview-parity.md) | エンジン v2 パリティ契約 — `T → frame` 評価関数 1 個・プレビューの器 2 個・OSR 出口 1 個・golden frame 検収 1 本 |
| [contract-2026-09-03-preview-playback-rate-v1.md](./contract-2026-09-03-preview-playback-rate-v1.md) | プレビュー再生速度 v1 — 0.5×〜3× のプリセット・widget 生存期間の状態保持・出力タイムライン時計・frame-engine / legacy 両音声経路のピッチ保持 |
| [contract-2026-09-03-clip-adjust-v0.md](./contract-2026-09-03-clip-adjust-v0.md) | クリップ色調整 v0 — アイテム単位の基本補正・LUT 参照・セクションのバイパス |
| [contract-2026-09-05-clip-adjust-v1.md](./contract-2026-09-05-clip-adjust-v1.md) | クリップ色調整 v1 — RGB カーブ・CDL ホイール・Hue カーブ・固定の bake 演算順 |
| [contract-2026-08-01-export-nle-beta.md](./contract-2026-08-01-export-nle-beta.md) | export-nle: 他社 NLE への片道書き出し（FCPXML / FCP7 XML / SRT）— **BETA・実 NLE 取り込み未確認** |
| [contract-2026-08-28-osr-export-v0.md](./contract-2026-08-28-osr-export-v0.md) | ページ全体 Electron OSR 書き出し v0 — 4層ページ、seek/paint検証、器のフォールバック、メモリ上限 |
| [contract-2026-08-28-gpu-export-v0.md](./contract-2026-08-28-gpu-export-v0.md) | GPU 直結書き出し v0 — 適格性、読み戻しゼロの WebCodecs 経路、逐次 MP4 mux（moov 予約枠・仮ファイル無し・ffmpeg プロセス無し）、fallback、決定論 gate |
| [contract-2026-08-28-v2-approximation-ledger.md](./contract-2026-08-28-v2-approximation-ledger.md) | エンジン v2 恒久近似清算表 — golden / 実測で解消した項目、残す近似、別票を一件ずつ記録する正本 |
| [contract-2026-09-06-vgpu-layer-v0.md](./contract-2026-09-06-vgpu-layer-v0.md) | vgpu レイヤー v0 — pure WebGPU fragment パス・共有 overlay sheet・プレビュー解像度・GPU 直結書き出し・適格性・失敗時の扱い |

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
| [contract-2026-08-29-media-inspect-cli-v0.md](./contract-2026-08-29-media-inspect-cli-v0.md) | `akari media` 観察コマンド契約 v0 — probe / grab / filmstrip / waveform / transcribe（分析をプル駆動に: 見たいときに見る・見た結果はディスクに残る） |
| [contract-2026-08-29-capture-v0.md](./contract-2026-08-29-capture-v0.md) | `akari capture` 契約 v0 — 今の edit.json の完成フレームを、書き出さずに見る |
| [contract-2026-08-30-edit-json-v2-object-tree-v0.md](./contract-2026-08-30-edit-json-v2-object-tree-v0.md) | edit.json v2 オブジェクトツリー v0 — 再帰 `items`（group）・タグで写す袋グループ（HTML 部品 / captions.json）・部品アイテム（`source.part`）・段の不変条件・1 レコード 1 行の正規直列化・edit-store スクリプト API・AI の読み方（`version: 2` 据え置き） |
| [contract-2026-09-02-item-caption-anchor-v0.md](./contract-2026-09-02-item-caption-anchor-v0.md) | edit.json v2 アイテムの行アンカー — 字幕行 / source 秒区間への時刻従属・at / duration は解決キャッシュ・親相対の解決・mutation・lint 規則 |
| [contract-2026-08-30-motion-and-keyframes-v0.md](./contract-2026-08-30-motion-and-keyframes-v0.md) | 動きとキーフレーム v0 — 4 段階（L0 プリセット `motion` / L1 `keyframes` inline または `motion/<group-id>.json` 袋 / L2 範囲セレクタ `animator` / L3 コード）・easing 語彙・「キーフレームに展開」・タイムライン / インスペクターの表示規則 |
| [contract-2026-09-02-transcript-unrecognized-spans-v0.md](./contract-2026-09-02-transcript-unrecognized-spans-v0.md) | 文字起こしできなかった音声区間の `unrecognized[]` — analysis.json から captions.json へ持ち越し、`words[]` は不変 |
| [contract-2026-09-02-word-book-v0.md](./contract-2026-09-02-word-book-v0.md) | 単語帳 v0 — 語彙項目（`surface` / `variants` / `reading` / `kind`）を project < channel < workspace < builtin の 4 層で解決し、STT 直後に `words[]` 語境界で `text` と `words[]` を同時に直す。`edited: true` は不可侵・`protected_terms` への軟らかい供給・edit-lint 規則（ドラフト・要オーナーレビュー） |
| [contract-2026-08-09-transform-keyframes-v0.md](./contract-2026-08-09-transform-keyframes-v0.md) | transform キーフレーム v0（2026-08-30 にスキーマ `$comment` から復元。motion-and-keyframes v0 §2 が後継） |
| [contract-2026-09-02-export-verify-declared-vs-measured-v0.md](./contract-2026-09-02-export-verify-declared-vs-measured-v0.md) | 書き出し後の宣言 vs 実測検証 v0 — 区間音量は fail closed、カメラワーク静止相関は warning |
| [contract-2026-09-02-audio-envelope-v1.md](./contract-2026-09-02-audio-envelope-v1.md) | 音声エンベロープ・カーネル v1 — 決定論ダッキング（duck_db / attack / release・鍵 = narration ∪ transcript 台詞区間・sidechaincompress 廃止 → amultiply）とクリップ所有の音量キーフレームをプレビュー / 書き出しで共有 |
| [contract-2026-09-02-audio-insert-level-v1.md](./contract-2026-09-02-audio-insert-level-v1.md) | 挿入時の自動レベル合わせ v1 — ebur128 計測（sha1 キャッシュ）・役割別 LUFS 目標 + true peak ガード・`akari-media audio-level --write` が gain_db / 既定フェードを決定論で書き込む |
| [contract-2026-09-02-audio-clip-fx-v1.md](./contract-2026-09-02-audio-clip-fx-v1.md) | 音声クリップ FX v1 — speed（rubberband・ピッチ保持）・pitch_semitones・denoise（fft / nlm）・lowcut_hz。プレビューは FLAC サイドカー（recipe v2）で書き出しと一致 |
| [contract-2026-09-02-asset-reference-model.md](./contract-2026-09-02-asset-reference-model.md) | 素材の参照モデル v0 — マシン単位の共有ライブラリ（`~/.akari/assets`）・プロジェクトの参照台帳 `.akari/asset-references.json`・render-cut / edit-lint のフォールバック解決・実体化コマンド `akari-assets bundle` |
| [contract-2026-09-02-shape-item-v0.md](./contract-2026-09-02-shape-item-v0.md) | 図形アイテム v0 — edit.json v2 の `shape` ソース（rect / rounded-rect / ellipse / line / arrow / speech-bubble）を edit-store が決定論インライン SVG の html オーバーレイへ降下（レンダラ無改修） |

### 方向性メモ

実装済み契約の設計背景を残すメモ。新規の方向性検討は非公開の内部記録で管理します。

| ファイル | 内容 |
|---|---|
| [notes-2026-07-13-edit-json-v1.md](./notes-2026-07-13-edit-json-v1.md) | edit.json v1 拡張の方向性（crop・レイアウト・音声・サムネ枠の初期案） |
| [notes-2026-07-14-captions-and-cut-editing.md](./notes-2026-07-14-captions-and-cut-editing.md) | 字幕とカット編集の方向性（word 精度カット・captions 第一級化・カラオケ表示） |
| [notes-2026-07-16-qa-lint-and-transcript-ui.md](./notes-2026-07-16-qa-lint-and-transcript-ui.md) | 自己検証ループとトランスクリプト編集 UI の方向性（edit-lint の原型） |
| [notes-2026-08-28-engine-v2-open-items.md](./notes-2026-08-28-engine-v2-open-items.md) | エンジン v2 残課題 — 実機条件、決定論的 seek、OSR 隔離、±0 検収、legacy 退役条件の移管先 |
| [notes-2026-09-05-bake-layer-retired.md](./notes-2026-09-05-bake-layer-retired.md) | bake-layer / ATF テロップ描画の退役 — 消したもの・`kind:"telop"` の後方互換・対象外の線引き |

## 開発者向け

| ページ | 内容 |
|---|---|
| [dev/windows-build.md](./dev/windows-build.md) | Windows ビルドのチェックリスト |

コントリビュートの入口はリポジトリルートの [README](../README.ja.md) と
各パッケージの README を参照してください。
