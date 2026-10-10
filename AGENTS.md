# AGENTS.md — AKARI Video

エージェント非依存の入口。リポジトリの構成・authoring 規約・検証ルールの正本は [CLAUDE.md](CLAUDE.md) にある。
**どのハーネスで作業していても、まず CLAUDE.md を読むこと**（内容はハーネス非依存）。

Node ESM のエントリポイントガードは両辺を realpath で比較する
（symlink 経由で無言終了するため）。

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

スキル数: 26

| スキル | 発動条件（description） | 正本 |
|---|---|---|
| `address-review` | Handle open review.json annotations through actual edit.json changes, edit-lint, and ticket updates in the prescribed sequence. Use for requests such as “Address a-0002 and a-0003” or “Address all open tickets”. The consumer side of the QA loop; bin/respond.mjs atomically enforces open → addressed with mandatory response, immutable resolved tickets, and no silent dismissal. | `skills/address-review/SKILL.md` |
| `akari` | Create, open, or resume AKARI Video projects. Use when asked to make a video in a folder without `.akari/`, or to check an AKARI project's state. | `skills/akari/SKILL.md` |
| `analyze-footage` | 動画素材 1 本を分析レベル L0〜L3 のプル駆動で観察し、見た結果だけを analysis.json v0（帳面）に積み上げるスキル。既定は L0 メタ + L1 音（`akari media probe` → `waveform` → 喋りがあるときだけ `transcribe`。ローカル既定・クラウド文字起こしは承認制）。視認済みキーフレーム・編集イベント・フック採点（L2）と人物トラック（L3）は依頼で明示されたときだけ。新しい撮影素材を取り込むとき、素材単体の編集前分析を頼まれたとき、または edit-plan の前処理として素材ごとの分析が必要なときに使う。 | `skills/analyze-footage/SKILL.md` |
| `analyze-project` | Read project assets (analysis.json) together with surrounding context (intake.json, edit.json, planning/, README, and past projects), create the interpretation layer interpretation.json, and render a read-only analysis report limited to facts and readings of the material. Use to understand a multi-asset project across sources, integrate completed analyze-footage results, or identify missing primary information for interviews before choosing a direction. edit-plan reads this output before deciding direction. | `skills/analyze-project/SKILL.md` |
| `bake-3d` | Blender ヘッドレスで 3D ベイクレシピ（scene.py）を mp4 へ焼き、検証し、素材ライブラリ / プロジェクトへ配置する。**3D の既定は Three.js オーバーレイ（overlay-authoring/3d.md）** であり、本スキルは「宣言型ランタイムで出せない絵（被写界深度・モーションブラー・レイトレース反射・GI・パーティクル）」「同時 3D シーンを 2 枚以下へ減らすための事前焼き」「素材ライブラリへ納品するクリップ」のいずれかに当てはまるときだけ使う。 | `skills/bake-3d/SKILL.md` |
| `beat-sync-edit` | 宣言済み音源（declarations.json の BPM・頭拍・キメ・区間）を唯一の時刻ソースにして、拍にスナップした edit.json とオーバーレイ一式を「生成器」から機械生成する制作スキル。音に合わせて画面が動く PV・ハイライト・ショーケースを、手打ちの秒数ゼロで作る。「リズムに合わせて動画を作って」「この曲で PV を作って」「拍に合わせて切り替えたい」「音に反応するモーションにして」で発動。宣言づけ自体は declare-audio（別物）、素材ゼロからの企画は edit-plan（別物）。 | `skills/beat-sync-edit/SKILL.md` |
| `compile-review-session` | Transcribe recorded review-session audio.wav, events.jsonl, edit.snapshot.json, and session.json using analyze-footage's same 3-layer STT. Segment utterances, resolve references from the interaction trace, normalize imperative instructions, and produce open review.json annotations plus a compilation report. Use to turn spoken QA sessions into tickets, compile recorded/transcribed sessions, or explicitly recompile compiled sessions. | `skills/compile-review-session/SKILL.md` |
| `create-project` | Create an AKARI Video project headlessly. Recursively copy `templates/project-default/`, record the template version, initialize git only when safe, and generate an HTML creation report. No app launch is needed. Use to create a video project or fill in an existing folder as an AKARI Video project. | `skills/create-project/SKILL.md` |
| `critique-cut` | Read a human-assembled edit.json and observe only the source ranges used in its timeline, then return findings without editing. This read-only skill never modifies edit.json. Use for requests such as “How does this look?”, “Look at this cut”, or “Critique the current timeline”. | `skills/critique-cut/SKILL.md` |
| `declare-audio` | 手元の音源に「サビはどこか・キメはどこか・拍はどこか」を自分の耳で付ける（宣言づけ）。ブラウザで開くタイムライン画面を起動し、人が波形にサビ区間とキメのピンを打ち、BPM・頭拍を確定して declarations.json へ保存する。付けた宣言は BGM 自動提案（suggest-bgm）がそのまま読み、実測 BPM とサビ頭出し（audio.bgm.in）付きの提案になる。「この曲のサビを教えたい」「BGM の提案が雑」「拍に合わせて切りたい」「宣言を自分で作りたい」で発動。音源を増やすのは setup-audio-library（別物）。 | `skills/declare-audio/SKILL.md` |
| `design-world` | 「ワールドを作って」「地図で見せる動画」「紙からブラウザの中へ入っていく映像」など、複数の世界と停留所を連続カメラで結ぶ flat ワールドを設計・検査・組み立てるときに使う。 | `skills/design-world/SKILL.md` |
| `edit-lint` | Check edit.json and optional analysis.json / captions.json / media with a deterministic CLI, then finish QA with frame inspection and reporting after PASS. Use immediately after writing or modifying edit.json, before export, and after applying review feedback. | `skills/edit-lint/SKILL.md` |
| `edit-plan` | analyze-project が作る分析レポート（interpretation.json + analysis-report.html）を一次証拠として読み、方針・素材計画・実行をチャットの明示承認で確定したうえで edit.json とオーバーレイ HTML へ落とすスキル。複数素材の編集計画、素材ゼロからの生成計画（質問対話 → plan.json の仮枠タイムライン確定）、分析結果からカットや BGM・SFX・B ロールを決める依頼で使う。 | `skills/edit-plan/SKILL.md` |
| `export-nle` | BETA（実 NLE 取り込み未確認）: edit.json を Final Cut Pro / DaVinci Resolve（FCPXML）・Premiere Pro（FCP7 XML）・SRT 字幕へ書き出す。「Premiere で開きたい」「Final Cut に持っていきたい」「Resolve 用に書き出して」「SRT がほしい」で使う。移せないフィールドは dropped[] で必ず報告する。 | `skills/export-nle/SKILL.md` |
| `generate-media` | 静止画の仮枠から動画生成・再取得までを扱うスキル。「静止画で仮枠を組みたい」「このクリップを動画にして」「生成が落ちた・再取得」「文字カードで尺だけ先に」と頼まれたときに使う。 | `skills/generate-media/SKILL.md` |
| `generate-narration` | 原稿テキストから VOICEVOX（ローカル・無償の既製声）、Gemini（fal 経由の gemini-tts / gemini-3.1-flash-tts、または Google AI 直接の gemini-3.8-flash-tts）、Fish Audio（fish-s2.1-pro）、fal Qwen3-TTS（自声クローン）などでナレーション音声を生成し、edit.json の audio.narration[] へ書き込むスキル。ナレーションを作ってほしいと頼まれたとき、仮ナレ（下書き試聴）が欲しいとき、声プロファイルを新規に作りたいとき、または既存のナレーションをエンジンや声で差し替えたいときに使う。 | `skills/generate-narration/SKILL.md` |
| `harvest-asset` | Use to turn costly, reusable project overlays, 3D, motion, captions, thumbnail layouts, audio, and B-roll into AKARI Video library assets. Assess admission, draft meta.json, create previews, update INDEX, and validate. | `skills/harvest-asset/SKILL.md` |
| `manage-connections` | Centrally manage AKARI Video generation providers, social connections, API-key references, model selection, and cost-approval policies. Use for initial setup, connection checks, adding providers/models, and gates before paid generation or external publication. Works with `.akari/connections.json` and a free, read-only doctor. | `skills/manage-connections/SKILL.md` |
| `overlay-authoring` | AKARI Video のオーバーレイ HTML、字幕、表・グラフ、Three.js 3D、モーショングラフィックス、サムネイル、人物の後ろに文字を置く表現を設計・生成・レビューするときに発動する authoring ルーター。 | `skills/overlay-authoring/SKILL.md` |
| `render-cut` | 承認済み edit.json と edit-lint PASS を入力に、最終 MP4 の計画、明示承認、ローカル書き出し、ffprobe 検証、キーフレーム視認を完了する。編集が承認済みで、納品用動画の書き出しや最終レンダーを求められたときに使う。 | `skills/render-cut/SKILL.md` |
| `research-plan` | 動画の企画・調査工程（ネタ出し → ターゲット/競合/トレンド調査 → 企画書・構成案・絵コンテ・撮影リスト）を headless で一周するときに発動する router。ネタ選定と構成の確定は decision-cards 型承認ゲート（HTML レポート + decisions.json）で人間の判断を受け取る。 | `skills/research-plan/SKILL.md` |
| `setup-audio-library` | Use to expand the BGM and sound-effects library. Default to bulk acquisition of first-party AKARI Sounds directly from GitHub Releases, providing all BGM and jingles. Supplement only missing families (applause, failure sounds, Japanese-style impacts) with a free-source candidate HTML list and drop-folder matching or assisted acquisition. Semi-automated setup ends with keep/drop decisions in the listening gallery. A sibling of setup-library / harvest-asset, separated because audio requires a different workflow. | `skills/setup-audio-library/SKILL.md` |
| `setup-chat-approval` | Set up Telegram notifications at approval gates and return approvals with a button tap. Use doctor to assess state, guide BotFather token issuance and credentials.env registration (human actions), identify the chat ID, register the connection, and verify real-device notification and button approval. Use for requests to approve in chat, receive phone notifications, or configure a Telegram bot. Free-text instructions and agent startup are outside scope (separate contract). | `skills/setup-chat-approval/SKILL.md` |
| `setup-library` | Use for first-time AKARI Video setup or when the current project needs more usable assets. This first-run skill checks ffmpeg / whisper-cli (and can install with approval), reads catalog/ to propose a starter pack, obtains explicit human approval, then acquires, places, validates, and updates INDEX entries. | `skills/setup-library/SKILL.md` |
| `setup-remote` | Set up remote access to approval reports and previews from another device such as a phone, and send footage to the workspace. Use doctor to assess Tailscale, guide installation and login (human actions), expose the preview server (default 4567) and approval report helper over tailnet-only HTTPS with tailscale serve, connect Taildrop reception to workspace inbox/, and verify access from another device. Use for requests to view reports on a phone, approve remotely, send footage from a phone, or set up remote access. Public internet exposure (funnel) is outside the default scope. | `skills/setup-remote/SKILL.md` |
| `verify` | Use to execute the L0 / L1 / L2 verification ladder required by an AKARI Video task contract on the current Theia stack. Read when acceptance criteria specify levels such as L0 or L0+L1, to determine exactly what to run and how at each level. | `skills/verify/SKILL.md` |

<!-- END GENERATED skills-index -->

索引は `scripts/gen-skills-index.mjs` が SKILL.md frontmatter から生成する（`npm run gen:skills-index`）。
手で編集しない。CI が symlink の整合と索引のドリフトを検査する（`npm run check:skills-index`）。
