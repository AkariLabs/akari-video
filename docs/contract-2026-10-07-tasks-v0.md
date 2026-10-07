# tasks.json v0 — 依頼タスクの運用情報

## 位置づけ

`.akari/tasks.json` は、AI への依頼の運用情報を持つプロジェクトのサイドカーである。状態、優先度、送信先、戻すための履歴、および注釈以外の依頼を保存する。注釈の本文は `review.json` が正本である。

## 置き場

プロジェクトの `.akari/tasks.json` に置く。ルート直下には置かない。これはプロジェクト構造契約の「契約サイドカー」に当たる。ファイルは履歴に残す。`.akari/cache/outbox/` の依頼文は再生成できる一時ファイルであり、送信後の記録は tasks.json に残す。

## 形

top の必須フィールドは `version: 0` と `tasks` 配列である。各タスクの必須フィールドは `id`、`source`、`state`、`createdAt` のみ。`id` は `t-0001` のような連番で、既存の最大番号の次を使う。

| フィールド | 型・値 | 用途 |
|---|---|---|
| `source` | `annotation` / `lint` / `proposal` / `export` | タスクの出どころ |
| `state` | `unsent` / `sent` / `review` / `done` | 進行状態 |
| `via`, `priority`, `rank` | 文字列、`high` / `normal` / `low`、数値または null | 入口と並び |
| `outcome` | null または `edited` / `declined` / `failed` / `dismissed` | 結果 |
| `title`, `body`, `target` | 文字列、文字列、文字列または null | 表示とアンカーのない指示 |
| `anchor`, `ref` | object または null | 素材時刻と元データへの参照 |
| `attachments` | `{kind, path, external?}` の配列 | 添付ファイル |
| `gate`, `needsConfirm` | `auto-ok` / `ask`、真偽値 | 実行前の扱い |
| `undo` | `{reversible, historyId?, before?, after?, undoneAt?}` | 戻すための記録 |
| `batchId`, `sentAt`, `sentTo` | 文字列、文字列または null、`{agent, form, route}` | 送信記録 |
| `response` | null または `{summary, action, respondedAt}` | 応答。`action` は `edited` / `declined` |
| `createdBy`, `updatedAt`, `orphaned` | `human` / `app` / `ai`、文字列、真偽値 | 作成者と追跡 |
| `kind`, `targetDetail`, `evidence` | 文字列、object、object | 取り込み時の分類・対象・根拠 |
| `confidence`, `question`, `risk`, `route` | 文字列 | 確信度、質問、外部送出の危険、担当 |
| `dependsOn`, `origin`, `mergedFrom` | id 配列、object、id 配列 | 依存、出所、統合元 |

`anchor` は `{sourceT, sourceRange}`、`ref` は `{kind, id|key|path|rule}`。`targetDetail` は `refs[]`, `outputT`, `src`, `sourceT`, `cutIndex`, `region`（0〜1 の `[x,y,w,h]`）を持てる。`evidence` は `memo`, `speech`（`[開始秒, 終了秒]`）, `quote`, `ink[]`、`origin` は `kind`, `memo`, `job`, `ref` を持てる。`risk: outbound` は `gate: ask` とし、自動実行しない。未知の任意列挙値は警告として扱う。

```json
{
  "version": 0,
  "tasks": [
    {
      "id": "t-0001",
      "source": "annotation",
      "state": "unsent",
      "createdAt": "2026-10-07T08:10:00.000Z",
      "ref": { "kind": "annotation", "id": "a-0003" },
      "priority": "normal",
      "gate": "ask"
    }
  ]
}
```

## 状態と遷移

`unsent → sent → review → done` が基本形。リントの再検査で指摘が消えたときのみ `sent → done` とできる。人による再依頼・復元は `review → unsent`。人の無視は任意の状態から `done` とし、`outcome: dismissed` を記録する。AI は `done` に進めない。

## 注釈との関係

`ref.kind: annotation` の本文、対象、時刻、ペンの線は `review.json` を正本とする。tasks.json は運用情報を重ねる。注釈の `open` は `unsent`、`addressed` は `review`、`resolved` は `done` に写す。`open` でも送信記録が `sent` なら `sent` を保つ。その他の食い違いは `review.json` を優先する。参照先の注釈が消えたタスクは `orphaned: true` として残す。`review.json` の形は変更しない。

## 読み手の規約

ファイルが無ければ空の `version: 0` として読む。未知フィールドを保持し、未知の `source` / `state` は表示だけして変更しない。必須フィールドの欠落は警告に残し、タスクを捨てない。JSON が壊れたファイルは上書きしない。`version > 0` は「新しい形式です。スキル / アプリを更新してください」として拒否する。

## 書き手の規約

`.akari/tasks.json.lock` ディレクトリを確保し、ロック内でファイル全文を読み直す。60 秒を超えた古いロックは回収する。`tasks.json.tmp` に 2 スペース整形・末尾改行で書き、rename で原子的に置き換える。注釈の参照があるタスクの本文は書き写さない。状態の変更ごとに個別の git commit は作らない。

## 検証

`node packages/schemas/bin/validate-tasks.mjs <tasks.json>` を実行する。形式と意味のエラーは終了コード 1、警告のみなら 0、引数の誤りは 2。id の重複と `risk: outbound` + `gate: auto-ok` はエラーである。

## 互換

古いアプリやスキルは `review.json` をそのまま使える。tasks.json が無いプロジェクトでも注釈から仮想タスクを作る。「送った」注釈 id の既存保存は初回に取り込める。`.akari/tasks.json` は保持対象、ロックと `.akari/cache/outbox/` は一時データとして扱う。
