# AGENTS.md — AKARI Video

エージェント非依存の入口。リポジトリの構成・authoring 規約・検証ルールの正本は [CLAUDE.md](CLAUDE.md) にある。
**どのハーネスで作業していても、まず CLAUDE.md を読むこと**（内容はハーネス非依存）。

## スキル

このリポにはスキル（[Agent Skills オープン標準](https://agentskills.io) / SKILL.md 形式）が同梱されている。
正本は `skills/<name>/SKILL.md`。

- **ネイティブ対応ハーネス**: `.opencode/skills/`（opencode）/ `.claude/skills/`（Claude Code）/ `.cursor/skills/`（Cursor Agent）/ `.agents/skills/`（agentskills.io
  互換ハーネスの標準位置。新しめの Codex 等）/ `.codex/skills/`（Codex CLI 0.144 系の旧探索位置）に
  同一実体への symlink があり、自動発見・自動発動する
- **スキル探索非対応のハーネス**: 着手前に下の索引を確認し、タスクが description に合致したら
  **該当 SKILL.md を読み、その手順に従うこと**
- Codex のスラッシュメニューに `/prompts:<スキル名>` として出したい場合は
  `node scripts/setup-codex-prompts.mjs` を一度実行する（`~/.codex/prompts/` にスタブを生成。任意）

<!-- BEGIN GENERATED skills-index — scripts/gen-skills-index.mjs が生成。手で編集しない -->

スキル数: 17

| スキル | 発動条件（description） | 正本 |
|---|---|---|
| `address-review` | review.json の open チケット（annotation）を edit.json への実対応 → edit-lint → チケット更新まで型どおりに執行するスキル。「a-0002 と a-0003 に対応して」「open チケット全部に対応して」で発動する。状態機械（open → addressed + response 必須・resolved 不可侵・黙殺禁止）を bin/respond.mjs が原子的に守る QA ループの消費側。 | `skills/address-review/SKILL.md` |
| `analyze-footage` | 動画素材 1 本から 720p プロキシ、ローカル既定の文字起こし（Mac は macOS SpeechAnalyzer / 共通は whisper.cpp・クラウドは承認制）、視認済みキーフレーム、編集イベント、人物関連トラックを作り、analysis.json v0 にまとめるスキル。新しい撮影素材を取り込むとき、素材単体の編集前分析を頼まれたとき、または edit-plan の前処理として素材ごとの分析が必要なときに使う。 | `skills/analyze-footage/SKILL.md` |
| `analyze-project` | プロジェクト内の素材群（analysis.json）と周辺プロジェクト文脈（intake.json・edit.json・planning/・README・過去 PJ）を読み合わせて interpretation.json（解釈層）を作り、事実 + 素材の読みに限定した読み取り専用の分析レポートを描画するスキル。複数素材プロジェクトの内容を素材横断で把握したいとき、analyze-footage が素材ごとの分析を終えたあとの統合、方向性を決める前に一次情報の欠落（取材質問）を洗い出したいときに使う。edit-plan は方針決めの前提としてこのスキルの出力を読む。 | `skills/analyze-project/SKILL.md` |
| `bake-3d` | 3D シーンを映像素材（クリップ）として使いたいとき、3D ベイクレシピ（scene.py）を新規作成・調整・再ベイクするときに発動する。Blender ヘッドレスでレシピを mp4 に焼き、検証し、素材ライブラリ / プロジェクトへ配置するまでを担う。映像の上に重なるオーバーレイ 3D は対象外（overlay-authoring/3d.md へ）。 | `skills/bake-3d/SKILL.md` |
| `compile-review-session` | 録音 review セッションの audio.wav・events.jsonl・edit.snapshot.json・session.json を、analyze-footage と同じ 3 層 STT で文字起こしし、発話区切り・軌跡からの参照解決・命令形への正規化を経て review.json の open annotation とコンパイルレポートへ着地する。喋りながら行った QA セッションをチケット化するとき、recorded / transcribed セッションをコンパイルするとき、または compiled セッションを明示的に再コンパイルするときに使う。 | `skills/compile-review-session/SKILL.md` |
| `create-project` | AKARI Video の新規プロジェクトを headless で作成する。`templates/project-default/` を再帰コピーし、雛形バージョンを記録し、安全な場合のみ git 初期化して、作成結果レポート HTML を生成する。アプリ起動は不要。新しい動画プロジェクトを作るとき、または既存フォルダを AKARI Video プロジェクトとして補完するときに使う。 | `skills/create-project/SKILL.md` |
| `edit-lint` | edit.json と任意の analysis.json / captions.json / メディアを決定的 CLI で検査し、PASS 後のフレーム視認とレポートまで QA を完了する。edit.json を書いた、または変更した直後、書き出し前、レビュー指摘を反映した後の再確認で使う。 | `skills/edit-lint/SKILL.md` |
| `edit-plan` | analyze-project が作る分析レポート（interpretation.json + analysis-report.html）を一次証拠として読み、方針・素材計画・実行をチャットの明示承認で確定したうえで edit.json v0 とオーバーレイ HTML へ落とすスキル。複数素材の編集計画、素材ゼロからの生成計画（質問対話 → plan.json の仮枠タイムライン確定）、分析結果からカットや BGM・SFX・B ロールを決める依頼で使う。 | `skills/edit-plan/SKILL.md` |
| `generate-narration` | 原稿テキストから VOICEVOX（ローカル・ゼロ円の既製声）または fal Qwen3-TTS（自声クローン）でナレーション音声を生成し、edit.json の audio.narration[] へ書き込むスキル。ナレーションを作ってほしいと頼まれたとき、仮ナレ（下書き試聴）が欲しいとき、声プロファイルを新規に作りたいとき、または既存のナレーションをエンジンや声で差し替えたいときに使う。 | `skills/generate-narration/SKILL.md` |
| `harvest-asset` | 案件で作った高コスト・再利用価値の高いオーバーレイ、3D、モーション、テロップ、サムネ構図、音源、B ロールを AKARI Video の assets ライブラリへ素材化するときに発動する。入庫判定、meta.json 下書き、preview、INDEX 更新、検証を行う。 | `skills/harvest-asset/SKILL.md` |
| `manage-connections` | AKARI Video の生成プロバイダ・SNS 接続・API キー参照・モデル選択・コスト承認ポリシーを一元管理する。初回セットアップ、接続状態の確認、provider やモデルの追加、有償生成・外部公開の実行前ゲートで発動し、`.akari/connections.json` と無償・読み取り専用の doctor を扱う。 | `skills/manage-connections/SKILL.md` |
| `overlay-authoring` | AKARI Video のオーバーレイ HTML、字幕、表・グラフ、Three.js 3D、モーショングラフィックス、サムネイル、人物の後ろに文字を置く表現を設計・生成・レビューするときに発動する authoring ルーター。 | `skills/overlay-authoring/SKILL.md` |
| `render-cut` | 承認済み edit.json と edit-lint PASS を入力に、最終 MP4 の計画、明示承認、ローカル書き出し、ffprobe 検証、キーフレーム視認を完了する。編集が承認済みで、納品用動画の書き出しや最終レンダーを求められたときに使う。 | `skills/render-cut/SKILL.md` |
| `research-plan` | 動画の企画・調査工程（ネタ出し → ターゲット/競合/トレンド調査 → 企画書・構成案・絵コンテ・撮影リスト）を headless で一周するときに発動する router。ネタ選定と構成の確定は decision-cards 型承認ゲート（HTML レポート + decisions.json）で人間の判断を受け取る。 | `skills/research-plan/SKILL.md` |
| `setup-audio-library` | BGM・効果音の音源ライブラリを増やしたいときに発動する。フリー配布元の候補リスト HTML を生成し、ユーザーが手動保存したファイルをドロップフォルダから照合・登録するか、ユーザーの指示があればエージェントが取得を代行する。試聴ギャラリーで keep/drop するまでの半自動セットアップ。setup-library / harvest-asset の姉妹スキル（音源だけ流儀が異なるため独立）。 | `skills/setup-audio-library/SKILL.md` |
| `setup-library` | AKARI Video を初めてセットアップするとき、または現在のプロジェクトに使える素材が足りず新しく揃えたいときに発動する。ffmpeg / whisper-cli / headless Chrome の道具チェック、catalog/ を読んだスターターパック提案、人間の明示承認、取得・配置・検証・INDEX 更新までを一気通貫で行う first-run スキル。 | `skills/setup-library/SKILL.md` |
| `verify` | AKARI Video（現行 Theia スタック）のタスク契約が要求する検証はしご（L0 / L1 / L2）を実行するときに発動する。タスクの受け入れ条件が「verify 層: L0」「L0+L1」等を指定しているとき、各層で実際に何を・どう叩くかを確認するために読む。 | `skills/verify/SKILL.md` |

<!-- END GENERATED skills-index -->

索引は `scripts/gen-skills-index.mjs` が SKILL.md frontmatter から生成する（`npm run gen:skills-index`）。
手で編集しない。CI が symlink の整合と索引のドリフトを検査する（`npm run check:skills-index`）。
