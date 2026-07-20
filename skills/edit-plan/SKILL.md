---
name: edit-plan
description: 1 本以上の動画素材の analysis.json を統合し、サムネイル案を先頭に置く編集判断レポートを作り、方針・素材計画・実行の明示承認後に edit.json v0 とオーバーレイ HTML へ落とすスキル。複数素材の編集計画、素材ゼロからの生成計画（質問対話 → plan.json の仮枠タイムライン確定）、分析結果からカットや BGM・SFX・B ロールを決める依頼で使う。
---

# 編集判断を統合する

## ハードルール

- 判断の正本は検証済み `analysis.json` と人間の明示承認に置き、根拠のない transcript、フレーム、素材、承認を作らない。
- レポートは固定 6 章を順守し、同じ HTML を段階的に更新する。`decision_log` の既存行だけは変更・削除せず、常に追記する。
- **方針 → 素材計画 → 実行**の各チェックポイントで停止する。無操作、タイムアウト、過去の包括承認を今回の承認に読み替えない。
- 静止画はレポートへ埋め込む。i2v、アバター、その他の動画生成は対応静止画・素材計画・実行の承認がすべて揃うまで行わない。
- 有償または重い生成の前に、使う手、理由、代替案、影響を宣言する。画像生成は Codex 画像生成を先に検討し、次に Akari Cloud を検討する。OpenAI、Gemini 等の API キーを直叩きしない。
- `edit.json` は [M1〜M4 v0 契約](../../docs/contract-2026-07-13-m1-m4.md) の単一 `source` 形を変えない。複数 source、音声 track、B ロール track などの未定義フィールドを足さない。
- 最終オーバーレイでは [overlay-authoring](../overlay-authoring/SKILL.md) スキルを使う。見つからない場合も規約を省略せず、[CLAUDE.md](../../CLAUDE.md) の authoring 規約を正本として使ったことを記録する。
- OpenMontage は構造パターンの参考に限り、AGPL の文章やコードを転写しない。

## 実行順と目次

1. [workflow.md](workflow.md) を読み、分析の収集・並列実行・統合モードを決める。素材がゼロの場合はこの時点で [plan-json.md](plan-json.md) を読み、質問対話 → `plan.json`（仮枠タイムライン。[契約](../../docs/contract-2026-07-20-plan-json-v0.md)）の確定を先に行う。
2. [report-guide.md](report-guide.md) を読み、[report-template.html](../../packages/decision-cards/report-template.html) から固定 6 章のレポートを作る。同時に必須 4 カード（`thumbnail` / `cut-policy` / `captions-policy` / `structure`）と、対になる `<レポートパス>.decisions.json` の雛形（全カードの `answer` に AI 推奨の既定値、`byDefault: true` / `answeredAt: null` / `completedAt: null`）を書く。
3. `node packages/decision-cards/report-helper.mjs <レポートパス>` を起動し、表示 URL を人間に提示する。decisions.json の `completedAt` が非 null になるまでポーリングで待つ（ヘルパー不通・decisions 破損時はチャットの明示承認で代替し、その旨を記録）。確定したら `byDefault: false` になった変更点（おまかせ確定なら「全カード AI 推奨のまま」）を `decision_log` に追記する。
4. [approvals-and-generation.md](approvals-and-generation.md) を読み、生成宣言、provenance、3 段階承認を運用する。Checkpoint 1 は `completedAt` または明示承認まで編集実行に進まない。
5. 実行承認を得た後だけ [execution.md](execution.md) を読み、`edit.json v0` とオーバーレイ HTML を生成・検証する。

現在の工程に必要なリーフだけを読み、後工程を先回りして実行しない。
