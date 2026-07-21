---
name: research-plan
description: 動画の企画・調査工程（ネタ出し → ターゲット/競合/トレンド調査 → 企画書・構成案・絵コンテ・撮影リスト）を headless で一周するときに発動する router。ネタ選定と構成の確定は decision-cards 型承認ゲート（HTML レポート + decisions.json）で人間の判断を受け取る。
---

# 企画・調査を一周する

> 本スキルは暫定で雛形同梱（v0）。スキルカタログ + setup インストール機構が立った時点で参照配布へ移行する。同梱は暫定運用であり、leaf を含めテキストのみ・バイナリ資産なし。

## ハードルール

1. **有償 API を呼ぶ前に想定コストを明示し、状態ファイル（`.decisions.json` 等）の承認後にのみ実行する。** チャット上の承認だけで課金を実行しない。
2. **接続は [manage-connections](../manage-connections/SKILL.md)（`.akari/connections.json`）経由のみを使う。** `.env` 探索・API キー直書きをしない。
3. **出力は JSON + HTML に限定し、GUI アプリを起動しない**（headless-first 不変条件。アプリを一切インストールしなくても本工程が完結する）。
4. **参考にした外部スキル・リポジトリのコード・文面を転記しない。** Hub/Hero/Help 分類、並列ギャップ分析、収益化ポテンシャル付きランキングといった**工程分解の型だけ**を抽出する（例外は検証済み MIT/Apache のみ）。出力スキーマは自社統一。
5. **日本語 SNS 事情を必須調査軸に含める。** `research-plan.json` の `target.japan_sns.notes` を空にしない（無償手段で確認できない場合もその旨と理由を書く）。
6. **CLAUDE.md / AGENTS.md に触らない。**
7. **無償枠のみで一周が成立する既定にする。** 有償手段が使えない環境でも停止しない（結果は劣化してよいが、完走はする）。

## 実行順と目次

現在の工程に必要なリーフだけを読み、後工程を先回りして実行しない。

1. [ideate.md](ideate.md) を読み、ネタ出し（Hub/Hero/Help 分類 + 収益化ポテンシャル軸）で候補をランキングする。`topic.candidates[]` に落とす。
2. [competitor.md](competitor.md) を読み、ターゲットと競合を調査・構造化する（4 並列ギャップ分析 + 日本語 SNS 事情）。`target` に落とす。
3. [trends.md](trends.md) を読み、無償手段を既定にトレンドを取得する。知見は専用フィールドを持たず、候補の `rationale` / 競合の `gap` に溶け込ませ、出典だけ `sources[]` に残す。
4. レポートを起票し（下記「レポートと承認ゲート」）、`topic-select` 決定カードで**ネタ選定**の承認を人間から受ける。`completedAt` が入るまで次工程へ進まない。
5. [storyboard.md](storyboard.md) を読み、承認済みネタから企画書・構成案・絵コンテのショットカードを作る（`structure.chapters[]` / `structure.shots[]`）。同じレポートに `structure-confirm` 決定カードを追加し、**構成の確定**の承認を受ける。
6. [shotlist.md](shotlist.md) を読み、確定した絵コンテから撮影リスト・収録チェックリストを作る（`shot_list[]`）。
7. `research-plan.json` へ確定内容を書き、`node packages/schemas/bin/validate-research-plan.mjs <パス>` で検証する（exit 0 を確認するまで完了扱いにしない）。

## レポートと承認ゲート（decision-cards 型の再利用）

新しい承認機構は作らない。[edit-plan](../edit-plan/SKILL.md) が使う仕組みをそのまま再利用する。

- [report-template.html](../../packages/decision-cards/report-template.html) を複製し、`node packages/decision-cards/report-helper.mjs <レポートパス>` で提示する。カードの data 属性・雛形の書式・「全部おまかせ」+ 要約ビュー必須・`decision_log` 追記専用の規律は [edit-plan/report-guide.md](../edit-plan/report-guide.md) と同型（`byDefault` / `completedAt` / ポーリング / ヘルパー不通時のチャット代替も同じ）。
- レポートは固定 5 面を順守する（空でも省略せず理由を書く）:
  1. **候補ネタランキング表**（[ideate.md](ideate.md) の証拠。`topic-select` カードが載る）
  2. **競合分析サマリー**（[competitor.md](competitor.md) の証拠。日本語 SNS 事情を含む。決定カードは持たない評価面）
  3. **構成案タイムライン**（[storyboard.md](storyboard.md) の証拠。`structure-confirm` カードの一部）
  4. **絵コンテのショットカード**（[storyboard.md](storyboard.md) の証拠。`structure-confirm` カードの一部）
  5. **撮影チェックリスト**（[shotlist.md](shotlist.md) の証拠。決定カードは持たない評価面 — 変更したい場合は `shot_list` を直接編集し、次ラウンドの状態差分として拾う）
- 決定カードは 2 枚のみ（契約上の判断点は「ネタ選定」「構成の確定」の 2 点で固定）。
  - `topic-select`: `answer` は `{ "choice": "<topic.candidates[].id>", "requestMore": false, "note": null }`。AI 推奨（ランキング 1 位の候補）に `data-default="true"` を付ける。
  - `structure-confirm`: `answer` は `{ "chapters": [{ "id": "<structure.chapters[].id>", "adopt": true }], "openingHook": "<key>" | null }`。
- `completedAt` が非 null になるまで、当該チェックポイント以降の工程（`topic-select` なら競合/トレンド確定後の企画着手、`structure-confirm` なら撮影リスト作成）に進まない。ヘルパー不通・decisions.json 破損時はチャットの明示承認で代替し、その旨をレポート内の `decision_log` に記録する。
- 未承認のまま `research-plan.json` の `topic.selected` / `structure.confirmed` を書かない。`decided_at` / `confirmed_at` は decision-cards の確定時刻（またはチャット承認時刻）をそのまま転記する。

## 成果物

プロジェクトの `planning/` 配下に置く。

```
planning/
├── research-plan-report.html               # 固定 5 面のレポート
├── research-plan-report.html.decisions.json
└── research-plan.json                      # 企画の SSOT。version 必須
```

- **由来記録**: 外部調査の出典（URL・取得日時・無償/有償の別）を `research-plan.json` の `sources[]` に残す。トレンド調査専用のフィールドは持たない。
- **後段接続**: `research-plan.json` は撮影後の footage 突合、編集構成案の参照から読める形にする。配信後分析からの還流フィールドは `feedback`（`reserved: true`）に予約のみで、v0 では実装しない。

## よくある間違い

- Hub/Hero/Help や 4 並列ギャップ分析の**説明文まで**参考ソースから転記する（型だけを自分の言葉で書く）。
- `topic.selected` を人間の承認前に埋める、または `decided_at` を確定時刻より前に記入する。
- `target.japan_sns.notes` を空にする、または「省略」で済ませる。
- 有償トレンド API・有償検索 API を承認前に呼ぶ。
- レポートの 5 面のうち評価専用の面（競合分析サマリー・撮影チェックリスト）にも決定カードを追加し、承認ゲートを 2 点から増やす。
- `research-plan.json` を書いた後に `validate-research-plan.mjs` を通さない。
