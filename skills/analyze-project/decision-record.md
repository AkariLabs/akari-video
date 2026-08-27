# 判断記録

## 原則

チャットでの判断・取材の Q&A は揮発させず、必ず markdown に残す。ファイル契約が正本、
チャットは注入経路という不変条項（intake v2）の適用であり、スタイル学習・過去 PJ 参照・
次セッションのコンテキスト供給源になる。**形式は発明しない** —
[edit-plan の decision_log 慣行](../edit-plan/report-guide.md#decision_log)にそのまま接続する。

## 何を記録するか

- **2 パス目の主要判断**: 素材の役割づけ・関係づけ・flags の判定（特に `orphan`/`unclear` の
  使い分けなど、根拠はあるが解釈の余地が残る判断）。「根拠 = evidence フィールド」と
  「判断そのものをなぜそう下したか」は別物であり、後者を判断記録に残す。
- **取材の Q&A**: [interview.md](interview.md) で得た質問と回答（`interpretation.json` の
  `inputs.context.interview[]` へも反映済みのはずだが、判断記録には「なぜその質問をしたか」
  「回答をどう解釈に反映したか」まで残す）。
- **停止条件の判定**: 取材フェーズを終える判断（構成案が捏造なしに一本通ると判定した理由）。

## 記録先とフォーマット

[edit-plan/report-guide.md](../edit-plan/report-guide.md#decision_log) が定義する `decision_log`
の慣行（`(category, subject)` をキーとした時刻順追記・ISO 8601 日時・category・subject・決定・
理由・決定者・関連 checkpoint）を**そのまま流用**する。analyze-project 用の category は
`analysis`（2 パス目の判断）/ `interview`（取材の Q&A）を使う。

`editing-report.html` という単一 HTML に埋め込む前提は 2026-07-22 改訂で edit-plan 側から
退いたため（分析専用レポートへの一本化。[edit-plan/report-guide.md](../edit-plan/report-guide.md)
冒頭の改訂注記を参照）、analyze-project と edit-plan は同一プロジェクトの決定を**共有の
独立ファイル** `<project>/decision-log.md` に追記する（analyze-project が先に書き始めて
よく、edit-plan の後続工程がそのまま追記を続ける。1 プロジェクト = 1 ログの単一 SSOT）。
ファイルが無ければ新規作成し、決定行フォーマットの表（category・subject・決定・理由・
決定者・関連 checkpoint の列）をヘッダに 1 度だけ書く。既存行は変更・削除せず、新しい行を
末尾へ追加する。

この置き場所の変更（HTML 内蔵 → 独立 markdown ファイル）は、edit-plan 側が固定レポートの
生成を取りやめたことに伴う**最小限の新設**であり、記録の慣行・フィールド構成そのものは
一切変えていない。

描画は edit-plan と共有の判断記録レポート（`packages/decision-log-report`）で行える。
analyze-project 側の追記後は任意だが、edit-plan の各 Checkpoint では必ず再描画する。

## 記録例

```markdown
| 日時 | category | subject | 決定 | 理由 | 決定者 | 関連 checkpoint |
|---|---|---|---|---|---|---|
| 2026-07-22T10:40:00+09:00 | analysis | asset:bg-cm-prototype/flags | unclear と判定 | 由来元 edit.json・planning/production-notes.md から同一プロダクトの CM 試作と確認できたが、本編 transcript に直接言及が無く編集上の具体的根拠が無いため orphan ではなく unclear とした | AI（2 パス目） | - |
| 2026-07-22T10:55:00+09:00 | interview | oq-01: audio/missing.wav の意図 | 取材質問として open_questions に採用 | source からは確定不能（fieldtest/planning に記録なし）。素材にもネットにも無い一次情報のため取材質問の要件を満たす | AI → オーナーへ回付 | - |
```

## よくある間違い

- 判断記録の形式を新規に発明する（既存の decision_log 慣行を調べずに独自フォーマットを作る）。
- チャットでのやり取りだけで済ませ、markdown への反映を省略する（揮発させない）。
- `interpretation.json` の `inputs.context.interview[]` へは反映したが、判断記録（なぜ聞いたか・
  どう解釈へ反映したか)への記載を省略する。
- 過去の決定行を新しい判断で上書きする（追記専用の原則違反）。
