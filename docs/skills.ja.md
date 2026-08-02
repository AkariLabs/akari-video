[English](./skills.md) | **日本語**

# スキルカタログ

AKARI Video のエージェント側ワークフローは **19 のスキル**に分割されている（工程ごとに 1 つ + 横断 2 つ）。このページはその一枚地図 — 各スキルが何を担当し、いつ発動し、どの外部ツール・ランタイムに接続するかをまとめる。

正本は各 `skills/<name>/SKILL.md`。ここは索引であり、手順・ハードルールの詳細は各 SKILL.md と関連契約（[Reference](./README.ja.md#reference)）に従う。

## 制作フロー順の一覧

### 企画

| スキル | 担当 | 外部ツール・接続 |
|---|---|---|
| [research-plan](../skills/research-plan/SKILL.md) | ネタ出し → ターゲット/競合/トレンド調査 → 企画書・構成案・絵コンテ・撮影リスト。ネタ選定と構成は decision-cards 型の承認ゲート | Web 調査 |

### プロジェクト・素材の準備

| スキル | 担当 | 外部ツール・接続 |
|---|---|---|
| [create-project](../skills/create-project/SKILL.md) | 新規プロジェクトの headless 作成（雛形コピー・作成レポート） | git（安全な場合のみ初期化） |
| [setup-library](../skills/setup-library/SKILL.md) | 初回セットアップ。道具チェック → スターターパック提案 → 取得・配置・検証 | ffmpeg / whisper-cli / headless Chrome（存在検査） |
| [setup-audio-library](../skills/setup-audio-library/SKILL.md) | BGM・SFX の半自動入庫（候補リスト → 手動 DL 照合 → 試聴 keep/drop） | フリー音源配布元（ダウンロードは人間） |
| [setup-remote](../skills/setup-remote/SKILL.md) | 遠隔セットアップ。Tailscale doctor → 導入ガイド（人間手番）→ プレビューサーバーの tailnet 限定 HTTPS 化 → Taildrop 受信を作業場 inbox/ へ接続 → 疎通確認。公開インターネットへは既定で一切出さない | Tailscale / Taildrop（導入・ログインは人間） |
| [harvest-asset](../skills/harvest-asset/SKILL.md) | 案件で作った高コスト成果物の素材ライブラリ入庫 | — |
| [bake-3d](../skills/bake-3d/SKILL.md) | 3D シーンを映像素材（クリップ）に焼く。レシピ `scene.py` の作成・調整・再ベイク | **Blender**（ヘッドレス・bpy） |

### 分析

| スキル | 担当 | 外部ツール・接続 |
|---|---|---|
| [analyze-footage](../skills/analyze-footage/SKILL.md) | 素材 1 本の編集前分析（720p プロキシ・文字起こし・キーフレーム・編集イベント）→ analysis.json | ffmpeg、STT 3 層（macOS SpeechAnalyzer / whisper.cpp / クラウドは承認制） |
| [analyze-project](../skills/analyze-project/SKILL.md) | 素材横断の解釈層 interpretation.json と読み取り専用の分析レポート | — |

### 編集

| スキル | 担当 | 外部ツール・接続 |
|---|---|---|
| [edit-plan](../skills/edit-plan/SKILL.md) | 分析レポートを一次証拠に、方針・素材計画・実行を明示承認で確定し edit.json v0 + オーバーレイへ | — |
| [overlay-authoring](../skills/overlay-authoring/SKILL.md) | オーバーレイ HTML の authoring ルーター（テロップ・字幕・表グラフ・3D・モーション・サムネ・人物の後ろに文字） | CSS keyframes / WAAPI、Three.js + glTF（宣言型のみ。→ [対応ランタイム](#対応アニメーションランタイム)） |
| [generate-narration](../skills/generate-narration/SKILL.md) | 原稿 → ナレーション音声生成 → edit.json の audio.narration[] へ | VOICEVOX（ローカル・無償） / fal Qwen3-TTS（クラウド・自声クローン・承認制） |

### QA・レビュー

| スキル | 担当 | 外部ツール・接続 |
|---|---|---|
| [edit-lint](../skills/edit-lint/SKILL.md) | edit.json + analysis.json / captions.json / メディアの決定的検査。PASS 後のフレーム視認まで | 同梱の決定的 CLI |
| [compile-review-session](../skills/compile-review-session/SKILL.md) | 録音レビューセッションを文字起こし → 参照解決 → review.json の open チケットへコンパイル | STT 3 層（analyze-footage と同じ） |
| [address-review](../skills/address-review/SKILL.md) | open チケットへの実対応 → edit-lint → チケット更新の型どおり執行（状態機械） | 同梱 `bin/respond.mjs` |

### 書き出し

| スキル | 担当 | 外部ツール・接続 |
|---|---|---|
| [render-cut](../skills/render-cut/SKILL.md) | 承認済み edit.json から最終 MP4 の計画 → 明示承認 → ローカル書き出し → 検証 → キーフレーム視認 | ffmpeg / ffprobe |
| [export-nle](../skills/export-nle/SKILL.md) | **BETA（実 NLE 取り込み未確認）**: edit.json → FCPXML（Final Cut / Resolve）・FCP7 XML（Premiere）・SRT の片道書き出し。移せないフィールドは dropped[] で明示 | 同梱の決定的 CLI（ffprobe は任意） |

### 横断

| スキル | 担当 | 外部ツール・接続 |
|---|---|---|
| [manage-connections](../skills/manage-connections/SKILL.md) | 生成プロバイダ・SNS・memory 接続・API キー参照・モデル選択・コスト承認ポリシーの一元管理。**有償生成・外部公開の唯一の入口** | `.akari/connections.json` + 無償・読み取り専用の doctor |
| [verify](../skills/verify/SKILL.md) | タスク契約の検証はしご（L0 / L1 / L2）の実行手順 | 現行 Theia スタックのビルド・テスト |

## 3D は 2 経路

「3D」は 1 つのスキルではなく、用途で 2 経路に分かれる。振り分けの正本は [3D ベイクレシピ契約](./contract-2026-07-14-3d-bake-recipe.md)。

| 経路 | 用途 | ランタイム | 入口 |
|---|---|---|---|
| A: Three.js オーバーレイ | 映像の**上に重なる**ライブ 3D（ロゴ回転・VideoTexture スクリーン等） | 透明 canvas + 宣言型 JSON + 同梱 Three.js | [overlay-authoring/3d.md](../skills/overlay-authoring/3d.md) |
| B: Blender ベイク | 3D シーンを動かして**映像素材（クリップ）そのもの**を作る | なし（焼いた mp4 は通常素材） | [bake-3d](../skills/bake-3d/SKILL.md) |

判定基準: **タイムラインにクリップとして置くなら B、映像の上に重ねるなら A**。

経路 B が Blender である理由（契約より）:

1. 焼いた mp4 は通常素材としてエンジン無改修で preview / export を通る。映像そのものが真実なので WYSIWYG が構造的に成立する
2. エディタ内に 3D オーサリング機能（小さな DCC の自作）は作らない。オーサリングは bpy スクリプト（エージェントが書く）に寄せる
3. レシピ（scene.py + params）= SSOT、ベイク出力 = 再生成可能キャッシュ。edit.json と同じ決定性の規律

## 対応アニメーションランタイム

オーバーレイ fragment には 2 つの設計ゲートがある:

- **任意 JavaScript を実行しない**（信頼済みランタイムが非実行の宣言を読む）
- **決定的シーク** — 同じタイムライン時刻へシークしたら同じ絵が再現される（wall-clock 禁止、時刻は `currentTime` で外部から注入）

この 2 つを通るものだけがランタイムとして載る。

| ランタイム | 状態 | 形 |
|---|---|---|
| CSS keyframes | ✅ 主経路 | ランタイムが animation を pause し `currentTime = localTime * 1000` を設定 |
| Web Animations API (WAAPI) | ✅ 主経路 | 同上（`getAnimations()` 経由で時刻注入） |
| Three.js + glTF | ✅ 宣言型のみ | 非実行の `<script type="application/json">` 宣言 + 同梱 pinned ランタイム。fragment 内の任意 JS は実行しない |
| Blender | ✅（ランタイムではなくベイク） | mp4 に焼いて通常素材として搬入（経路 B） |
| Lottie / Anime.js / GSAP / TypeGPU ほか | ❌ 未対応 | 汎用 JS seek hook は未実装。追加する場合は「宣言型 + 信頼済みランタイム」の型（Three.js オーバーレイと同型）に載せるのが前提 |

補足: 未対応群の中では Lottie が最も型に馴染む候補（アセットが自前のタイムラインを持ち、再生ヘッドを外部制御できるため）。採用時期は未定。

## 関連ページ

- [Guides](./README.ja.md#guides) — 各スキルのタスク別ガイド（使い方）
- [Reference](./README.ja.md#reference) — データ契約（スキーマ）の正本
- ルート [README](../README.ja.md) — ワークフロー全体図
