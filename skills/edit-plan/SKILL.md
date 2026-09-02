---
name: edit-plan
description: analyze-project が作る分析レポート（interpretation.json + analysis-report.html）を一次証拠として読み、方針・素材計画・実行をチャットの明示承認で確定したうえで edit.json とオーバーレイ HTML へ落とすスキル。複数素材の編集計画、素材ゼロからの生成計画（質問対話 → plan.json の仮枠タイムライン確定）、分析結果からカットや BGM・SFX・B ロールを決める依頼で使う。
---

# 編集判断を統合する

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

> **2026-07-22 改訂**: 編集判断レポート（固定 6 章 HTML + 決定カード）の生成は本スキルから
> 退いた。正式なレポートは [analyze-project](../analyze-project/SKILL.md) が作る分析レポートの
> みであり、方向性の引き出しはチャットで行う。詳細と移行理由は
> [report-guide.md](report-guide.md) 冒頭を見る。

> **edit.json v2 語彙**: v2 のトップレベルは exact で、`version` / `output` / `sources` /
> `tracks` / `audio` / `captions` / `thumbnail` 以外を書けない。`beats` / `emphasis_words` /
> `direction` を v2 の `edit.json` へ書かない。語レベル演出の書き先は字幕 SSOT である
> `captions.json` object ルートの `emphasis_words[]` とする。

## ハードルール

- 判断の正本は検証済み `analysis.json` と人間の明示承認に置き、根拠のない transcript、フレーム、素材、承認を作らない。
- **編集判断は analyze-project の分析レポートを一次証拠として使う**。edit-plan 自身は決定用の
  HTML レポートを新たに生成しない。方針（サムネイル案・カット強度・字幕方針・章立て等）は
  チャットで決め、決定は `decision-log.md` へ記録する。`decision-log.md` の既存行は変更・削除せず、
  常に追記する。`decision-log.md` を読み取り専用 HTML へ派生描画する判断記録レポート
  （[report-guide §decision_log](report-guide.md#decision_log)）は決定 UI を持たない記録の写しであり、
  この原則の例外ではない。
- **方針 → 素材計画 → 実行**の各チェックポイントで停止する。無操作、タイムアウト、過去の包括承認を今回の承認に読み替えない。
- Checkpoint 1 で semantic keep/drop を明示承認した後、pause 候補が必要な場合だけ
  [workflow.md](workflow.md) の cut candidate bridge を使う。bridge の全候補は
  `REVIEW_REQUIRED` であり、`approved_to_apply:false` の report を作るだけである。
  `edit.json` や `decision-log.md` を自動更新せず、候補 review 後も Checkpoint 3 の実行承認まで停止する。
  適用後は [execution.md](execution.md) の cut 後 ASR 再検証、情報保持、UI timing、audio 境界を人間が
  同じ版で確認し、`HUMAN_APPLY_GATE` を明示承認するまで完成扱いにしない。
- 静止画は生成物として保存し、provenance とともにチャットで提示する。i2v、アバター、その他の動画生成は対応静止画・素材計画・実行の承認がすべて揃うまで行わない。
- **生成素材は `<project>/assets/generated/` に保存する（素材パネルの守備範囲。2026-08-12 改訂）**。プロジェクト外や `<plan-dir>/` 配下に置かない。生成はプロジェクト内でのみ行う（技術的強制はスコープ外。規約として明記）。
- 生成素材には由来を再検証できるよう `<file>.meta.json` を添え、`provenance.origin` と `provenance.generator` を記録する。
- **静止画はタイムラインへ直接置ける**: 画像（png / jpg / webp / bmp / gif）は visual 段の `items[]` に media クリップとして置く（[execution.md](execution.md) §静止画素材の扱い）。静止画を並べるためだけに ffmpeg で連結して 1 本の動画へ焼き込まない — 個々の画像の編集性が失われ、`edit.json` の SSOT が壊れる。
- 有償または重い生成の前に、使う手、理由、代替案、影響を宣言する。画像生成は Codex 画像生成を先に検討し、次に Akari Cloud を検討する。OpenAI、Gemini 等の API キーを直叩きしない。
- `edit.json` は **v2（`sources[]` + `tracks[].items[]`）だけを書く**。段は `lane` と配列順、クリップの内容は `source.kind` で表し、旧 `cuts` / `layers` / `overlays` キーを作らない。足してよいのは v2 公開契約が定めたフィールドだけである。
- 見せ場マーカーは [beats.md](beats.md) の導出規約で分析・判断に使うが、v2 の `edit.json` へ `beats` を書かない。
- 語レベル演出は [emphasis-detection.md](emphasis-detection.md) の検出規約で導出し、
  `captions.json` object ルートの `emphasis_words[]` へ書く。v2 の `edit.json` へは書かない。
- 最終オーバーレイでは [overlay-authoring](../overlay-authoring/SKILL.md) スキルを使う。見つからない場合も規約を省略せず、[CLAUDE.md](../../CLAUDE.md) の authoring 規約を正本として使ったことを記録する。
- OpenMontage は構造パターンの参考に限り、AGPL の文章やコードを転写しない。

## 実行順と目次

1. [workflow.md](workflow.md) を読み、分析の収集・並列実行・統合モードを決める。素材がある
   場合は [analyze-project](../analyze-project/SKILL.md) の分析レポート（無ければ先に生成を
   依頼する）を一次証拠として読む。素材がゼロの場合はこの時点で [plan-json.md](plan-json.md) を
   読み、質問対話 → `plan.json`（仮枠タイムライン。[契約](../../docs/contract-2026-07-20-plan-json-v0.md)）の確定を先に行う。
2. [report-guide.md](report-guide.md) を読み、分析レポートの根拠を踏まえて方針（サムネイル案・
   カット強度・字幕方針・章立て）の推奨案と代替案を組み立てる。方針提示の前に
   [recipe.md](recipe.md) の recall 手順で `~/.akari/recipes/`（`workflow: "edit"`）を確認し、
   出所付きの推奨として添える（今回の依頼は上書きしない）。同じ方針提示の前段で
   `.akari/connections.json` の `memory` 宣言
   （[contract-2026-07-25-memory-connection-v0.md](../../docs/contract-2026-07-25-memory-connection-v0.md)）
   も確認する。あれば `entry`（省略時 `INDEX.md`）起点で `include`/`exclude` の範囲だけを読み、
   参照したファイルパスを `decision-log.md` に出所として記録する。全文投入は禁止。宣言が
   無ければ何もしない（error にしない）。
3. 方針をチャットで人間に提示し（推奨・代替案・理由・得失を示す。「どうしますか」で丸投げ
   しない）、明示承認または修正指示を得る。確定内容を `decision-log.md` に追記する。
4. [approvals-and-generation.md](approvals-and-generation.md) を読み、生成宣言、provenance、3 段階承認を運用する。Checkpoint 1 はチャットでの明示承認を得るまで編集実行に進まない。
5. Checkpoint 1 の承認後に無音短縮を検討する場合は [workflow.md](workflow.md) の専用 keep plan を組み、
   `bin/propose-cut-candidates.mjs` で review-only report を提示する。候補の採否・classification 修正を
   チャットで確認し、`decision-log.md` へ人間承認に基づき追記する。helper 自身には追記させない。

`edit.json` / `captions.json` は全文 Read せず、id で grep して該当行だけ読む（[edit.json の読み方](../../docs/guides/edit-json-access.md)）。
書き込みは該当行の Edit か edit-store のスクリプト API を使う。

6. Checkpoint 3 の実行承認を得た後だけ [execution.md](execution.md) を読み、v2 の `edit.json` とオーバーレイ HTML を生成・検証する。完了処理として [recipe.md](recipe.md) の freeze 手順を確認し、そのプロジェクトで未申し出なら一度だけ（offer-once）レシピ化を人間に申し出る。
7. 見せ場マーカーを書く工程では [beats.md](beats.md) を読み、`analysis.json` の events / transcript から
   見せ場候補を導出する（v2 の `edit.json` へは書かず、マッピング表・根拠を判断記録へ残す）。
8. 承認済みの見せ場候補を演出へ連動させる工程では [beat-sync.md](beat-sync.md) を読み、射影・SE 発火
   規則・章転換のスナップ・密度ガードレール・SE 既定表に従って audio 段の media クリップを組む。
9. シーンごとに使う表現手段を決める工程では [expression-selection.md](expression-selection.md) を読み、
   意味 → 手段の対応表・演出カードの `allowed_means` によるハードフィルタ・カタログ接続
   （`when_to_use` / `tags` 検索とライセンス確認）・選択根拠の記録に従って候補を決める
   （候補の決め方であり、素材計画の承認ゲートは従来どおり通す）。
10. 語レベル演出を書く工程では [emphasis-detection.md](emphasis-detection.md) を読み、`analysis.json` の
   `transcript[].words` から語レベル演出候補を導出し、`captions.json` object ルートの
   `emphasis_words[]` へ書く（v2 の `edit.json` へは書かず、対象 tier・見せ場連動・密度・根拠を判断記録へ残す）。
11. 人・キャラクター（アバター）の挿入を求められた工程では [avatar-resolution.md](avatar-resolution.md) を読み、段階読み出し（L0/L1/L2）・rendition 解決・decision card・記録の手順に従う。

現在の工程に必要なリーフだけを読み、後工程を先回りして実行しない。
