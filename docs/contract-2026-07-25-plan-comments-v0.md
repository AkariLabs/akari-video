# plan-comments.json v0（承認可能プラン層への構造化差し戻し）契約

- 日付: 2026-07-25
- 状態: **ドラフト・要オーナーレビュー**（データ契約の新設はオーナー裁定事項。本書はレビュー前提の起草）
- 前提: `contract-2026-07-17-data-contract-versioning.md`（三原則の正本）、
  `contract-2026-07-20-plan-json-v0.md`（隣接契約。`confidence` 状態梯子・`slots[].id`・
  `<plan-dir>` 配置規約の先例）、`skills/research-plan/storyboard.md`（`structure-confirm` の
  現行承認手順）、`skills/edit-plan/approvals-and-generation.md`（3 段階チェックポイントの現行承認手順）
- 発端: HyperFrames Studio 実機調査（輸入リスト②）。競合の `STORYBOARD.md` +
  `frame-comments.json` 型「制作中ずっと生きる承認可能プラン層」のうち、AKARI に不足していた
  **構造化コメント往復**をファイル契約として輸入する
- スコープ: `plan-comments.json` のデータ形・置き場所・ライフサイクル規約のみ。
  GUI（プランタブ・ボード UI）、`plan.json` / `research-plan.json` / `edit.json` 本体スキーマの変更、
  `decisions.json`（decision-cards）機構の変更、ステータス梯子の新設は**扱わない**
  （`confidence` が既にある。§0 参照）

## 0. 位置づけ — ステータスを再発明しない

`plan.json` v0（`contract-2026-07-20`）は既に slot 単位の `confidence: proposed | locked | filled` を
持つ。**本契約はこのステータス梯子を再発明せず、欠けていた「対象名指しの修正指示をチャット文脈に
依存しないファイルとして受け取る経路」だけを足す。** `plan-comments.json` は状態を保持しない
（`confidence` の代わりにならない）。人間が GUI やレポート上で「シーン 3 のグラフを差し替えて」の
ように対象名指しで付けたコメントを、スキルが読める構造化ファイルとして受け渡すことが本契約の全て。

版管理三原則（`contract-2026-07-17` §2）を新設契約として初版から適用する:

- トップレベル `version` は**整数・0 起算**
- 進化は**追加のみ**。読み手は**寛容リーダー**（`additionalProperties: true`。未知フィールドは保持し、
  欠落は既定値で補う）
- 既知より大きい `version` を見た読み手は推測変換せず **read-only で正直に停止する**
  （`validate-plan.mjs` と同挙動。§7）
- フィールド命名は **snake_case**（`contract-2026-07-20` §0 の先例を踏襲。schema ファースト契約の系列）

## 1. 確定スキーマ

正本: `packages/schemas/plan-comments.schema.json`（`$id: urn:akari-video:schema:plan-comments:v0`）。
実例: `packages/schemas/examples/plan-comments-v0-sample/plan-comments.json`。

```jsonc
{
  "version": 0,
  "pass": "scaffold",                 // "structure" | "scaffold" | "final"（§4 の対応表）
  "submitted_at": "2026-07-25T09:30:00.000Z",
  "comments": [
    {
      "target_kind": "slot",          // "shot" | "slot" | "cut"
      "target_id": "s-demo",          // shot/cut は配列インデックス文字列・slot は plan.json の slots[].id
      "title": "操作デモ",             // 提出時点の対象名コピー（並べ替え検知用）
      "text": "画面収録の前に、書き出しボタンをクリックする瞬間まで映してほしい。"
    }
  ]
}
```

### フィールド表

| フィールド | 型 | 必須 | 単位・備考 |
|---|---|---|---|
| `version` | integer (const 0) | 要 | — |
| `pass` | enum | 要 | `structure` / `scaffold` / `final`（§4） |
| `submitted_at` | string (ISO8601) | 要 | 提出時刻 |
| `comments[]` | array | 要（空配列可） | 配列順に意味はない（対象名指しの集合） |
| `comments[].target_kind` | enum | 要 | `shot` / `slot` / `cut` |
| `comments[].target_id` | string | 要 | `shot`・`cut` は対象配列のインデックスを文字列化したもの（例 `"2"`）。`slot` は `plan.json` の `slots[].id` をそのまま使う（idごと持ち出せるため並べ替えに強い） |
| `comments[].title` | string | 要 | 提出時点の対象名コピー（`shot` の `description` 冒頭 / `slot` の `label` / `cut` の `src` 等、読み手が実装時に選ぶ）。**並べ替え検知用の目視補助であり、参照解決には使わない**（参照解決は `target_id` のみで行う） |
| `comments[].text` | string | 要 | 指摘の逐語。要約・言い換えをしない |

「要」= 値は空文字列を許さない（`comments[]` 自体は空配列を許す。提出はしたが個別指摘がない回はあり得るため）。

## 2. 置き場所

`<plan-dir>` 配下（`plan.json` / `research-plan.json` と同じディレクトリ。AKARI プロジェクトでは
`planning/` ロールが既定）に **`plan-comments.json`** の 1 ファイルとして置く。

- **1 プロジェクト 1 ファイル**。パスは固定（`slot` や `pass` ごとにファイルを分けない）
- **提出のたび上書き作成**。前回提出分は前段（§3）のライフサイクルにより読み手が処理済みで
  削除しているはずであり、新規提出はこのファイルが存在しない状態から作られる

## 3. ライフサイクル契約 — これが契約の全て

HyperFrames `frame-comments.json` の要点（Studio の per-frame コメント欄が Submit 時に一括で
1 ファイルを書く／スキルはチェックポイントで見つけたら名指し対象だけ直して削除する）を
そのまま規約化する。

1. **書き手**は承認チェックポイントでの差し戻し時、まとめて 1 回で `plan-comments.json` を書く
   （人間の GUI 操作 1 回 = ファイル 1 回書き込み。逐次追記ではない）
2. **読み手スキル**は承認チェックポイントに到達したとき、**チャット返信の解釈より先に**
   `<plan-dir>/plan-comments.json` の有無を確認する
3. ファイルが在れば:
   - `comments[]` で名指しされた対象（`target_kind` + `target_id` で特定）**だけ**を改訂する
     （名指しされていない対象は無変更のまま次の提示に進む）
   - `title` が現在の対象名と一致しない場合は並べ替え・IDズレの疑いとして扱い、対象の再解決を
     試みる。解決できない場合は改訂を行わず、その旨をチャットで報告する（無言で誤爆させない）
   - 改訂が終わったら **`plan-comments.json` を削除する**
   - 改訂結果を人間へ再提示する（レポート再描画・チャット再掲示など、既存の承認導線に従う）
4. ファイルが無ければ、通常どおりチャット返信のみを承認・差し戻しの入力として扱う
5. **回またぎ残存は契約違反**。1 回のチェックポイント処理を跨いで `plan-comments.json` が
   存在し続けてはならない（次の提出前に前回分が残っていたら、読み手は前回分として処理し
   削除する。人間が古い内容のまま連投した場合の事故は書き手側の運用問題として扱う）
6. チャット返信とファイルの二重経路を許すが、**ファイルを先に読む**のが不変の優先順位
   （チャットで「さっきのコメントは無視して」と言われた場合のみ、ファイルの指摘より
   チャットの明示指示を優先してよい — 人間の直近意図が常に最終決定権を持つ）

## 4. `pass` × `target_kind` × 読み手スキルの対応表

| `pass` | 対象 `target_kind` | 読み手スキル | 対象データ |
|---|---|---|---|
| `structure` | `shot` | `skills/research-plan/storyboard.md`（`structure-confirm` 決定カードの差し戻し） | `research-plan.json` の `structure.chapters[]` / `structure.shots[]`（`shot` は `structure.shots[]` の配列インデックス） |
| `scaffold` | `slot` | `skills/edit-plan/approvals-and-generation.md`（Checkpoint 2 素材計画の差し戻し） | `plan.json` の `slots[]`（`target_id` は `slots[].id`） |
| `final` | `cut` | `skills/edit-plan/approvals-and-generation.md`（Checkpoint 3 実行の差し戻し） | `edit.json` の `cuts[]`（`cut` は `cuts[]` の配列インデックス。`cuts[]` は永続 id を持たないため — `contract-2026-07-18-edit-json-v1-sources.md`） |

3 つの組は 1 対 1 対応（`pass` が決まれば `target_kind` も決まる）。スキーマは
この対応をハード制約にしない（`target_kind` は `pass` と独立した enum）が、書き手・読み手の
双方がこの表の対応で運用する規約とする。

## 5. 劣化規約

`plan-comments.json` は一時的な差し戻し伝票であり、検証失敗時に他の工程を巻き込んで
失敗させない。

| 状況 | 挙動 |
|---|---|
| ファイルが無い | 正当な状態（§3 の 4）。検証対象がないだけで error にしない |
| `comments` が空配列 | 許容（提出したが名指し指摘なしの回） |
| `title` が現在の対象名と不一致 | 読み手スキルの運用判断（§3 の 2）。スキーマ検証は関知しない |
| `version > 0` | read-only で正直に停止する（原則 3。`validate-plan-comments.mjs` 実装） |

## 6. データ設計意図

- **`title` を持つ理由**: `target_id` だけでは、人間がコメントを付けた後に対象が並べ替わった
  ケースを読み手が検知できない。`title` は提出時点の対象名の**コピー**であり、読み手が
  現在の対象名と目視・機械比較することで「ズレ」を検知するための補助情報（正典は `target_id`）
- **`shot`/`cut` がインデックス文字列である理由**: `research-plan.json` の `structure.shots[]` は
  id を持つが、Studio 由来の per-frame コメントモデルに揃え、GUI 側の実装を「今何番目の
  カードにコメントしたか」で完結させる。`slot` だけ `plan.json` の `slots[].id` を使うのは、
  plan.json の slot が並べ替え時も id で安定して指せる設計（`contract-2026-07-20` §2）だから
  ——同じ理由で cut は id を持たないため slot と同じ扱いにできない
- **`comments[]` を配列（連想配列でない）にした理由**: 同一対象への複数コメントを許す
  （1 対象 1 コメントに制限しない）
- **状態を持たない理由**: `plan-comments.json` はイベント（差し戻し 1 回分）の記録であり、
  永続的な状態は `confidence`（plan.json）や `decisions.json`（decision-cards）が既に持つ。
  ここに新しい状態を作ると二重管理になる（§0）

## 7. よくある間違い

- **`plan-comments.json` を処理後も残す** — 誤り。§3 の 5。回またぎ残存は契約違反
- **チャット返信を先に解釈してからファイルを読む** — 誤り。§3 の 2。ファイル先読みが不変の優先順位
- **名指しされていない対象まで一緒に直す** — 誤り。名指し対象だけを改訂する（§3 の 3）
- **`plan-comments.json` に `confidence` のような永続状態を持たせる** — 誤り。§0・§6。
  状態は plan.json 側の責務
- **`slot` の `target_id` にインデックスを使う** — 誤り。`slot` は `plan.json` の `slots[].id`
  を使う（`shot`/`cut` とは扱いが違う。§6）
- **提出のたび追記する（過去の `comments[]` を残したまま足す）** — 誤り。§2。1 回の提出 = 1 回の
  上書き作成。回収済みの指摘を残さない

## 8. マイグレーション

（空欄 — `version` bump は発生していない。bump する場合はここに旧→新の機械実行可能な
変換手順を必ず併記する。`contract-2026-07-17` 原則 2）

## 9. 次段（本契約のスコープ外）

- GUI（将来のビューワー「プランタブ」ボード UI。本契約はファイル契約の読み書きだけで
  会話が成立する状態を作るところまでが本ラウンドの目的）
- `decisions.json`（decision-cards）機構との統合（現時点では疎結合のまま。§0）
- `plan.json` / `research-plan.json` / `edit.json` 本体スキーマへの `plan-comments.json` 参照
  フィールドの追加（例: `decision_ref` 的な紐付け）
- 差し戻し履歴のアーカイブ（削除する契約のため、削除前の内容を残したい場合の retention 方針は
  別途検討）
