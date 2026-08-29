---
name: analyze-project
description: プロジェクト内の素材群（analysis.json）と周辺プロジェクト文脈（intake.json・edit.json・planning/・README・過去 PJ）を読み合わせて interpretation.json（解釈層）を作り、事実 + 素材の読みに限定した読み取り専用の分析レポートを描画するスキル。複数素材プロジェクトの内容を素材横断で把握したいとき、analyze-footage が素材ごとの分析を終えたあとの統合、方向性を決める前に一次情報の欠落（取材質問）を洗い出したいときに使う。edit-plan は方針決めの前提としてこのスキルの出力を読む。
---

# プロジェクトを分析する

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

## ハードルール

- **1 パス目を再実行しない**。素材ごとの事実抽出（STT・フレーム解析等の重い処理）は既存
  [analyze-footage](../analyze-footage/SKILL.md) の analysis.json に委ね、無い素材だけ 1 素材 1 実行で
  実行する。既存 analysis.json は無改修で使う。
- **帳面に無い章は「未観察」として描く**。存在しなかったことにせず、素材や別章から推測で埋めない。
  レポートでも該当章を省略せず「未観察」と表示し、`observations[]` があればその実行履歴を根拠にする。
- **2 パス目は素材の再視聴をしない**。1 パス目の出力テキスト（transcript・keyframe note・events）を
  並べて読み直すテキスト推論に限る。素材へ戻るのは、2 パス目がピンポイントで必要と判断した箇所だけ。
- **2 パス目の入力は analysis.json 群に閉じない**。プロジェクトの周辺文脈
  （intake.json・edit.json・`planning/`・README・過去 PJ 参照があればそれも）を読む。
  analysis.json だけでは素材の由来判定（orphan/unclear 等）に確信を持てない実例が
  実地検証（内部リポの multiasset-dogfood 実走・2026-07-22）で確認されている。
- **周辺プロジェクト文脈の読み合わせに `memory` 接続を含める**。`.akari/connections.json` に
  `memory` 宣言（[contract-2026-07-25-memory-connection-v0.md](../../docs/contract-2026-07-25-memory-connection-v0.md)）
  があれば、`entry`（省略時 `INDEX.md`）起点で `include`/`exclude` の範囲だけを読み、
  `interpretation.json` の `inputs.context` に参照ファイルパスを出所として記録する。全文投入は
  禁止。宣言が無ければ何もしない（error にしない）。
- **解釈の全主張に根拠を必須とする**（`assets[].summary`/`role`/`relations`/`flags`、`arc[]` の
  すべて）。根拠は transcript の引用区間または keyframe note 参照に限り、捏造ゼロを守る。
  根拠を示せない主張は書かない（穴が残るなら open_questions へ）。
- **open_questions は取材質問のみ**。「どうしますか」（判断）を聞かない。素材にもネットにも
  載っていない一次情報だけを聞く（例文は [interpretation.md](interpretation.md) と
  [references/open-questions-examples.md](references/open-questions-examples.md) を見る）。
- **停止条件（80 点ライン）= 構成案（arc）が事実の捏造なしに一本通るか**。通れば取材フェーズを
  終える。それ以降の疑問は編集後の微調整（`edit-plan` 側）へ送る。
- **arc（構成案）はレポートに表示しない**。schema データとしては `interpretation.json` に残す
  （取材質問の生成源 + 対話フェーズで AI が提案する種）。表示除去は 2026-07-22 改訂で確定済み。
- [interpretation.schema.json](../../packages/schemas/interpretation.schema.json) にない
  補助フィールドを追加しない。`validate-interpretation.mjs` が PASS した JSON だけを確定版にする。
- **レポートに決定 UI（選択肢・ツマミ・確定ボタン）を一切置かない**。方向性はチャットで決める。
  「どうしますか」ではなく、根拠を示した上で AI が提案する。
- **判断記録は既存の decision_log 慣行（edit-plan 系）に接続する**。新形式を発明しない。
  詳細は [decision-record.md](decision-record.md)。
- OpenMontage は構造上の参考に限り、AGPL の文章・コードを転写しない。

## 実行順と目次

1. [collect.md](collect.md) を読み、プロジェクト内の素材を列挙し、analysis.json の有無を
   確認する。無い素材だけ analyze-footage を 1 素材 1 実行で走らせる。
2. [interpretation.md](interpretation.md) を読み、全 analysis.json + 周辺プロジェクト文脈を
   読み合わせ、根拠必須・捏造ゼロの規律で `interpretation.json` を作る。
3. [validate-and-render.md](validate-and-render.md) を読み、`validate-interpretation.mjs` で
   PASS を確認してから renderer（`--analysis <ref>=<path>` 形式）でレポートを生成し、開く。
   analysis.json に無い章はレポート上で「未観察」と表示されていることを確認する。
4. open_questions が残る場合だけ [interview.md](interview.md) を読み、チャットで取材する
   （「どうしますか」禁止）。回答を得たら interview へ昇格し、interpretation とレポートを
   再生成する（手順 2〜3 に戻る）。
5. [decision-record.md](decision-record.md) を読み、取材の Q&A と 2 パス目の主要判断を
   判断記録へ残す。

詳細を先読みせず、現在の工程に対応するファイルだけを読む。
