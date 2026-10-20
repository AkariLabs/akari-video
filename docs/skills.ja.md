[English](./skills.md) | **日本語**

# スキルカタログ

AKARI Video のエージェント側ワークフローは **28 のスキル**に分割されている（工程ごと + 横断スキル）。このページはその一枚地図 — 各スキルが何を担当し、いつ発動し、どの外部ツール・ランタイムに接続するかをまとめる。

正本は各 `skills/<name>/SKILL.md`。ここは索引であり、手順・ハードルールの詳細は各 SKILL.md と関連契約（[Reference](./README.ja.md#reference)）に従う。

## スキルの改名

- `skills/renames.json` に 1 行足す（`from` / `to` / `since`）。アプリとプロジェクトの同期は旧名を新名へ解決する。
- 改名した SKILL.md の description の末尾に「（旧名: <from>）」を 1 回だけ書く。
- `skills/`・`docs/`・`AGENTS.md`・`README*`・`plugin/`・`templates/` に旧名の参照を残さない（検査あり。CHANGELOG とリリースノートは除外）。

## 制作フロー順の一覧

動画 1 本の流れに沿った並び: 企画 → 準備 → 分析 → 編集計画 → 表現 → QA・レビュー → 書き出し → 素材化・作り方の記録。

### 企画

| スキル | 担当 | 外部ツール・接続 |
|---|---|---|
| [research-plan](../skills/research-plan/SKILL.md) | ネタ出し → ターゲット/競合/トレンド調査 → 企画書・構成案・絵コンテ・撮影リスト。ネタ選定と構成は decision-cards 型の承認ゲート | Web 調査 |

### 準備

| スキル | 担当 | 外部ツール・接続 |
|---|---|---|
| [akari](../skills/akari/SKILL.md) | プロジェクトを作る・開く・続きから再開する入口。素材に合う作りを最大 3 つ薦めて選ばれたものを当てる。外の道具が要る作業は道具の手順（recipe）に回す | akari CLI（`init` / `new` / `status` / `playbook` / `recipe`） |
| [create-project](../skills/create-project/SKILL.md) | 新規プロジェクトの headless 作成。土台（空のプロジェクトの構造）をコピーし、版を記録して作成レポートを出す。`--from` で作り方から始める | akari CLI（`new`）、git（安全な場合のみ初期化） |
| [setup-library](../skills/setup-library/SKILL.md) | 初回セットアップ。道具チェック → スターターパック提案 → 取得・配置・検証。つないだ Lab アカウントの無料素材と購入済みの Pro 素材の取得も扱い、音（BGM・効果音）のライブラリも受け持つ（AKARI Sounds の一括取得、候補リスト → 手動 DL 照合 → 試聴 keep/drop） | ffmpeg / whisper-cli、`akari assets`・`akari store connect`、GitHub Releases（AKARI Sounds）／フリー音源配布元（ダウンロードは人間） |
| [declare-audio](../skills/declare-audio/SKILL.md) | 手元の音源に「サビ・キメ・拍」を自分の耳で付ける宣言づけ（ブラウザのタイムライン画面 → `declarations.json`）。付けた宣言は BGM 自動提案がサビ頭出し付きで読む | ブラウザ（宣言を決めるのは人間） |
| [setup-remote](../skills/setup-remote/SKILL.md) | 遠隔セットアップ。Tailscale doctor → 導入ガイド（人間手番）→ プレビューサーバーの tailnet 限定 HTTPS 化 → Taildrop 受信を作業場 inbox/ へ接続 → 疎通確認。公開インターネットへは既定で一切出さない | Tailscale / Taildrop（導入・ログインは人間） |
| [setup-chat-approval](../skills/setup-chat-approval/SKILL.md) | チャット承認セットアップ。doctor → BotFather でのトークン発行と credentials.env 登録（人間手番）→ chat ID 許可リスト → 通知 + ボタン → タップで `decisions.json` 更新。long polling のみで公開エンドポイントを作らず、自由文は指示として扱わない | Telegram Bot API（トークンの発行・登録は人間） |

### 分析

| スキル | 担当 | 外部ツール・接続 |
|---|---|---|
| [analyze-footage](../skills/analyze-footage/SKILL.md) | 素材 1 本を頼まれたレベルまでプル駆動で分析（L0 メタ・L1 音・L2 映像・L3 人物トラック。既定は L0 + L1）→ analysis.json | `akari media`（文字起こしはまずローカル。クラウドは承認制） |
| [analyze-project](../skills/analyze-project/SKILL.md) | 素材横断の解釈層 interpretation.json と、画像込みの読み取り専用の分析レポート | — |

### 編集計画

| スキル | 担当 | 外部ツール・接続 |
|---|---|---|
| [edit-plan](../skills/edit-plan/SKILL.md) | 分析レポートを一次証拠に、方針・素材計画・実行をチャットの明示承認で確定し edit.json v2 と動く部品へ。素材なしからの質問 → 仮の編集計画も扱う | — |
| [edit-to-beat](../skills/edit-to-beat/SKILL.md) | 宣言済み音源の拍・キメ・区間を唯一の時刻ソースにして、拍にスナップした edit.json と動く部品一式を「生成器」から機械生成する（音に合わせて画面が動く PV・ショーケース） | ffmpeg / ffprobe（宣言は declare-audio で人間が付ける） |
| [design-world](../skills/design-world/SKILL.md) | ブリーフ → 土台 → 台本 → `world-map.json` → flat ワールド映像の検査・組み立て・実測・俯瞰 | 同梱 `akari world` CLI |

### 表現

| スキル | 担当 | 外部ツール・接続 |
|---|---|---|
| [overlay-authoring](../skills/overlay-authoring/SKILL.md) | 2D の動く部品（HTML の素材。テロップ・字幕・表グラフ・ガラス・モーション・サムネ・人物の後ろに文字）の authoring ルーター。3D は author-scene3d へ | CSS keyframes / WAAPI、宣言型のガラス・WebGPU・Canvas 2D ワールド（→ [対応ランタイム](#対応アニメーションランタイム)） |
| [author-scene3d](../skills/author-scene3d/SKILL.md) | 3D の入口は 1 本。既定は Three.js + glTF のライブ 3D、宣言型ランタイムで出せない絵だけ Blender で焼く（`scene.py` → mp4）。振り分けはスキル内の判断表 | **Blender**（ヘッドレス・bpy）は焼く経路だけ |
| [generate-narration](../skills/generate-narration/SKILL.md) | 原稿 → ナレーション音声生成 → edit.json の audio.narration[] へ。ローカルのエンジンは無償、クラウド（自分の声のクローン含む）は費用承認のあとだけ | VOICEVOX / Irodori（ローカル・無償）、fal・Google AI Gemini TTS・Fish Audio（クラウド・承認制） |
| [generate-image](../skills/generate-image/SKILL.md) | プロンプト → 静止画を素材・仮枠としてタイムラインへ。generate-video から参照される薄いスキルで、尺や動画の連鎖は持たない | manage-connections で許可された画像モデル（有償は費用承認） |
| [generate-video](../skills/generate-video/SKILL.md) | 静止画・文字カードの仮枠 → 1 クリップずつ動画生成 → 再取得可能な同一タイムライン item の差し替え | manage-connections で許可された動画 provider（費用承認） |

### QA・レビュー

| スキル | 担当 | 外部ツール・接続 |
|---|---|---|
| [review-cut](../skills/review-cut/SKILL.md) | 人間が先に組んだ edit.json を読み、使われている素材区間だけを観察して、現在のカットへ読み取り専用の所見を返す | `akari media` / `akari capture` |
| [verify-edit](../skills/verify-edit/SKILL.md) | edit.json + analysis.json / captions.json / メディアの決定的検査。PASS 後のフレーム視認まで | 同梱の決定的 CLI |
| [review-from-recording](../skills/review-from-recording/SKILL.md) | レビューの録音を文字起こし → 参照解決 → review.json の open コメントにまとめる | STT 3 層（analyze-footage と同じ） |
| [edit-from-review](../skills/edit-from-review/SKILL.md) | open コメント（アプリの注釈パネルで付けた注釈も review.json に入る）への実対応 → verify-edit → コメント更新の型どおり執行（状態機械） | 同梱 `bin/respond.mjs` |

### 書き出し

| スキル | 担当 | 外部ツール・接続 |
|---|---|---|
| [render-cut](../skills/render-cut/SKILL.md) | 承認済み edit.json から最終 MP4 の計画 → 明示承認 → ローカル書き出し（`--engine auto` は対象なら GPU、それ以外は OSR）→ 検証 → キーフレーム視認 | ffmpeg / ffprobe |
| [export-nle](../skills/export-nle/SKILL.md) | **BETA（実 NLE 取り込み未確認）**: edit.json → FCPXML（Final Cut / Resolve）・FCP7 XML（Premiere）・SRT の片道書き出し。移せないフィールドは dropped[] で明示 | 同梱の決定的 CLI（ffprobe は任意） |

### 素材化・作り方の記録

| スキル | 担当 | 外部ツール・接続 |
|---|---|---|
| [harvest-asset](../skills/harvest-asset/SKILL.md) | 案件で作った高コスト成果物の素材ライブラリ入庫。入庫の見極め・ツマミ付き `meta.json`・プレビュー・INDEX・検証 | — |
| [record-playbook](../skills/record-playbook/SKILL.md) | 完成プロジェクトの工程・設定値・役割別仮枠・部品・要る道具を作り方（`planning/playbook.md` + `playbook.json`）として記録し、重要な場面のコマを添えて手元の棚へ写す | 同梱の決定論的補助と作り方検査器、ffmpeg / ffprobe（プレビューのコマ） |

### 横断

| スキル | 担当 | 外部ツール・接続 |
|---|---|---|
| [manage-connections](../skills/manage-connections/SKILL.md) | 生成プロバイダ・SNS・memory 接続・API キー参照・モデル選択・コスト承認ポリシーの一元管理。**有償生成・外部公開の唯一の入口** | `.akari/connections.json` + 無償・読み取り専用の doctor |
| [connect](../skills/connect/SKILL.md) | AKARI の道具と、素材生成・文字起こしで実際に使うサービスの状態を調べる | `akari connect list` / `akari connect exec` |
| [verify-project](../skills/verify-project/SKILL.md) | タスク契約の検証はしご（L0 / L1 / L2）の実行手順 | 現行 Theia スタックのビルド・テスト |

## 3D は 2 経路

`author-scene3d` は 1 つのスキルで、中に 2 経路を持つ。どちらを選ぶか（焼くのはどんなときか）の判断表は [author-scene3d/SKILL.md](../skills/author-scene3d/SKILL.md) に 1 回だけ書いてある。焼く経路の仕様の正本は [3D ベイクレシピ契約](./contract-2026-07-14-3d-bake-recipe.md)。

| 経路 | 用途 | ランタイム | 葉 |
|---|---|---|---|
| ライブ 3D（**既定**） | 3D 全般。透過で合成され、画面に動画も差せ、glb 内蔵クリップで動く | 透明 canvas + 宣言型 JSON + 同梱 Three.js | [live.md](../skills/author-scene3d/live.md) |
| Blender ベイク（例外） | ライブ 3D で出せない絵・同時枚数の削減・素材ライブラリ納品 | なし（焼いた mp4 は通常素材） | [bake.md](../skills/author-scene3d/bake.md) |

焼く経路が Blender である理由（契約より）:

1. 焼いた mp4 は通常素材としてエンジン無改修で preview / export を通る。映像そのものが真実なので WYSIWYG が構造的に成立する
2. エディタ内に 3D オーサリング機能（小さな DCC の自作）は作らない。オーサリングは bpy スクリプト（エージェントが書く）に寄せる
3. レシピ（scene.py + params）= SSOT、ベイク出力 = 再生成可能キャッシュ。edit.json と同じ決定性の規律

## 対応アニメーションランタイム

動く部品（HTML の素材）には 2 つの設計ゲートがある:

- **任意 JavaScript を実行しない**（信頼済みランタイムが非実行の宣言を読む）
- **決定的シーク** — 同じタイムライン時刻へシークしたら同じ絵が再現される（wall-clock 禁止、時刻は `currentTime` で外部から注入）

この 2 つを通るものだけがランタイムとして載る。

| ランタイム | 状態 | 形 |
|---|---|---|
| CSS keyframes | ✅ 主経路 | ランタイムが animation を pause し `currentTime = localTime * 1000` を設定 |
| Web Animations API (WAAPI) | ✅ 主経路 | 同上（`getAnimations()` 経由で時刻注入） |
| Three.js + glTF | ✅ 宣言型のみ | 非実行の `<script type="application/json">` 宣言 + 同梱 pinned ランタイム。fragment 内の任意 JS は実行しない |
| ガラスの屈折 | ✅ 宣言型のみ | `data-akari-glass-scene` 宣言 + 同梱ランタイム。背景は静止画で、下の映像は取り込まない（[glass.md](../skills/overlay-authoring/glass.md)） |
| WebGPU レイヤー（vgpu） | ✅ 宣言型のみ | `data-akari-vgpu-scene` のフルスクリーン fragment パスを、外から渡された時刻で描く（[vgpu レイヤー契約](./contract-2026-09-06-vgpu-layer-v0.md)） |
| Canvas 2D ワールド | ✅ 宣言型のみ | `data-akari-world-scene` の flat ワールドを純粋な `camera(t)` で動かす。[design-world](../skills/design-world/SKILL.md) が使う（[world.md](../skills/overlay-authoring/world.md)） |
| Blender | ✅（ランタイムではなくベイク） | mp4 に焼いて通常素材として搬入（author-scene3d の焼く経路） |
| Lottie / Anime.js / GSAP / TypeGPU ほか | ❌ 未対応 | 汎用 JS seek hook は未実装。追加する場合は「宣言型 + 信頼済みランタイム」の型（Three.js の動く部品と同型。手順は overlay-runtime パッケージの README）に載せるのが前提 |

補足: 未対応群の中では Lottie が最も型に馴染む候補（アセットが自前のタイムラインを持ち、再生ヘッドを外部制御できるため）。採用時期は未定。

## 同梱 capability surface を検索する

実際に追跡されている skill の leaf、契約、package README / manifest、manifest が宣言する
公開 CLI entry は `akari capability <query> --json` で検索できる。frontmatter だけでなく nested
Markdown も対象なので、`beat-sync` は `skills/edit-plan/beat-sync.md` まで到達する。

text match が 0 件のときに限り、`--record-miss` で調べた source set の hash を現在の
project の `.akari/reports/absence/` に記録できる。固定 verdict は review 必須を表し、
`approved_to_build:false` である。これは「記述が見つからなかった」証拠であり、新設許可ではない。
CLI は checkout と npm tarball で動作する。CLI の無い copied Claude plugin は独自 catalog を
推測せず、capability 検索を unsupported と明示する。

## 関連ページ

- [Guides](./README.ja.md#guides) — 各スキルのタスク別ガイド（使い方）
- [Reference](./README.ja.md#reference) — データ契約（スキーマ）の正本
- ルート [README](../README.ja.md) — ワークフロー全体図

<!-- BEGIN GENERATED facts:stamp -->
この文書は AKARI Video v1.5.1（2026-10-19 公開）時点の説明です。
<!-- END GENERATED facts:stamp -->
