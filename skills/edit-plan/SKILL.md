---
name: edit-plan
description: analyze-project が作る分析レポート（interpretation.json + analysis-report.html）を一次証拠として読み、方針・素材計画・実行をチャットの明示承認で確定したうえで edit.json v0 とオーバーレイ HTML へ落とすスキル。複数素材の編集計画、素材ゼロからの生成計画（質問対話 → plan.json の仮枠タイムライン確定）、分析結果からカットや BGM・SFX・B ロールを決める依頼で使う。
---

# 編集判断を統合する

> **2026-07-22 改訂**: 編集判断レポート（固定 6 章 HTML + 決定カード）の生成は本スキルから
> 退いた。正式なレポートは [analyze-project](../analyze-project/SKILL.md) が作る分析レポートの
> みであり、方向性の引き出しはチャットで行う（オーナー口述 F48 第 20 巡）。詳細と移行理由は
> [report-guide.md](report-guide.md) 冒頭を見る。

## ハードルール

- 判断の正本は検証済み `analysis.json` と人間の明示承認に置き、根拠のない transcript、フレーム、素材、承認を作らない。
- **編集判断は analyze-project の分析レポートを一次証拠として使う**。edit-plan 自身は決定用の
  HTML レポートを新たに生成しない。方針（サムネイル案・カット強度・字幕方針・章立て等）は
  チャットで決め、決定は `decision-log.md` へ記録する。`decision-log.md` の既存行は変更・削除せず、
  常に追記する。
- **方針 → 素材計画 → 実行**の各チェックポイントで停止する。無操作、タイムアウト、過去の包括承認を今回の承認に読み替えない。
- 静止画は生成物として保存し、provenance とともにチャットで提示する。i2v、アバター、その他の動画生成は対応静止画・素材計画・実行の承認がすべて揃うまで行わない。
- 有償または重い生成の前に、使う手、理由、代替案、影響を宣言する。画像生成は Codex 画像生成を先に検討し、次に Akari Cloud を検討する。OpenAI、Gemini 等の API キーを直叩きしない。
- `edit.json` は [M1〜M4 v0 契約](../../docs/contract-2026-07-13-m1-m4.md) の単一 `source` 形を既定とし、勝手に複数 source、音声 track、B ロール track を発明しない。足してよいのは**公開契約が定めたフィールドだけ**である（[sources[]](../../docs/contract-2026-07-18-edit-json-v1-sources.md) / [audio](../../docs/contract-2026-07-14-edit-json-v1-audio.md) / [audio.narration[]](../../docs/contract-2026-07-20-edit-json-v1-narration.md) / [beats[]](../../docs/contract-2026-07-22-edit-json-v1-beats.md)）。契約のない未定義フィールドは足さない。
- 見せ場マーカー（`beats[]`）を書くときは [beats.md](beats.md) の導出規約に従う。`analysis.json` の event / 発話を指せない beat を発明せず、`t` は source 秒で書く。
- 最終オーバーレイでは [overlay-authoring](../overlay-authoring/SKILL.md) スキルを使う。見つからない場合も規約を省略せず、[CLAUDE.md](../../CLAUDE.md) の authoring 規約を正本として使ったことを記録する。
- OpenMontage は構造パターンの参考に限り、AGPL の文章やコードを転写しない。

## 実行順と目次

1. [workflow.md](workflow.md) を読み、分析の収集・並列実行・統合モードを決める。素材がある
   場合は [analyze-project](../analyze-project/SKILL.md) の分析レポート（無ければ先に生成を
   依頼する）を一次証拠として読む。素材がゼロの場合はこの時点で [plan-json.md](plan-json.md) を
   読み、質問対話 → `plan.json`（仮枠タイムライン。[契約](../../docs/contract-2026-07-20-plan-json-v0.md)）の確定を先に行う。
2. [report-guide.md](report-guide.md) を読み、分析レポートの根拠を踏まえて方針（サムネイル案・
   カット強度・字幕方針・章立て）の推奨案と代替案を組み立てる。
3. 方針をチャットで人間に提示し（推奨・代替案・理由・得失を示す。「どうしますか」で丸投げ
   しない）、明示承認または修正指示を得る。確定内容を `decision-log.md` に追記する。
4. [approvals-and-generation.md](approvals-and-generation.md) を読み、生成宣言、provenance、3 段階承認を運用する。Checkpoint 1 はチャットでの明示承認を得るまで編集実行に進まない。
5. 実行承認を得た後だけ [execution.md](execution.md) を読み、`edit.json v0` とオーバーレイ HTML を生成・検証する。
6. 見せ場マーカーを書く工程では [beats.md](beats.md) を読み、`analysis.json` の events / transcript から
   `beats[]` を導出する（マッピング表・座標系・密度ガードレール・worked example）。
7. 承認済みの `beats[]` を演出へ連動させる工程では [beat-sync.md](beat-sync.md) を読み、射影・SE 発火
   規則・章転換のスナップ・SE 既定表に従って `audio.sfx[]` を組む（v0 は SE + カット境界 + 既存
   overlay 部品まで。トランジション語彙の発明とビート連動の BGM 操作をしない）。

現在の工程に必要なリーフだけを読み、後工程を先回りして実行しない。
