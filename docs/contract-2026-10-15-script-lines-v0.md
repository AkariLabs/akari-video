---
lifecycle: accepted
created: 2026-10-15
updated: 2026-10-15
---

# script-lines-v0（台本の「予定」と「メモ」の行）契約

- 日付: 2026-10-15
- 状態: **v0 受理（2026-10-15 オーナー GO）**
- 前提: `contract-2026-07-25-project-structure-v0.md`（`planning/` は企画・プランの層）/ `contract-2026-09-24-caption-runs-v0.md`（字幕は `captions.json`）/
  `contract-2026-10-15-playbook-v0.md`（作り方。本契約の「予定」は作り方の内訳 `beats` から作られる）/ `contract-2026-09-25-canvas-v0.md`（空のキャンバス = 区間を持つ仮枠）
- 発端: 台本パネルは字幕の行しか持たず、「ここに何を入れる予定か」「気づいたメモ」を時刻つきで残せない。作り方の内訳（何秒に何を）も、台本とタイムラインに出す場所が無い
- スコープ: 予定とメモの行の **置き場・形・台本パネルとタイムラインでの見せ方・作り方からの生成**
- 非スコープ: 字幕（`captions.json`）の形の変更 / 予定の行から自動でカットを作ること / 複数人の同時編集

## 0. 位置づけ

台本の行は 3 種類。**字幕**（`captions.json`。今のまま）・**予定**（ここに何を入れるつもりか）・**メモ**（気づき・指示）。
予定とメモは `planning/script.json` に持ち、台本パネルは 3 種を時刻順に 1 本の列で見せる。字幕は今までどおり `captions.json` が正本で、本契約は触らない。

## 1. 置き場

- `<project>/planning/script.json`（無ければ予定もメモも無い。台本パネルは字幕だけで今までどおり動く）
- シーンを持つプロジェクト（project-manifest v0）では `scenes/<scene>/planning/script.json`。台本パネルは開いているシーンの 1 本を読む

## 2. 形

```json
{
  "version": 0,
  "kind": "akari-script",
  "lines": [
    { "id": "p-hook",  "kind": "plan", "at": 0,  "duration": 3,  "text": "つかみ: 結論を先に言う", "placeholder": "talking-head", "beat": "hook" },
    { "id": "p-body",  "kind": "plan", "at": 3,  "duration": 40, "text": "本題: 3 つのポイント", "placeholder": "screen", "done": false },
    { "id": "m-01",    "kind": "memo", "at": 12.5, "text": "ここで図解を差し込む" }
  ]
}
```

- `version`: 整数 0（原則 1）。`kind`: 固定 `"akari-script"`
- `lines[]`: 必須（空でよい）。各行は `id`（ファイル内で一意）・`kind`（`plan` / `memo`）・`at`（秒・0 以上）・`text`（1〜500 文字）が必須
- 任意: `duration`（秒・0 より大。予定の区間）/ `placeholder`（作り方の仮枠の `id`）/ `beat`（作り方の内訳の `id`）/ `done`（予定が済んだか）/ `author`（`user` / `ai` / `playbook`）
- 並び: `at` → `id` の安定ソートで保存。書き込みは tmp + rename。読み手は tolerant（未知フィールドは保持、壊れた行は捨てて残りを読む）
- スキーマ: `packages/schemas/script.schema.json`（closed object・additive-only）と `validate-script.mjs`

## 3. 台本パネル（右ドックの「台本」）

- 字幕・予定・メモを `at` の順に 1 本の列で出す。行の頭に種類の印（字幕 / 予定 / メモ）。予定は `duration` があれば区間（`0:00–0:03`）を出し、`done` はチェックで切り替える
- 「＋ メモ」で今の再生位置にメモを足す（`author: user`）。予定・メモの文字はその場で直せる。削除はメニューから
- 行を押すとその時刻へ移動（字幕の行と同じ）。字幕の既存の操作（字幕を作る・カットを整える・QC）は変えない
- 表示の切り替え: 「予定とメモを出す」のオン / オフ（既定オン）。オフなら今までの字幕だけの台本

## 4. タイムライン

- タイムラインの最上段に「台本」の段を 1 本足し、予定を区間の帯、メモを点の印で出す（`script.json` が無ければ段を出さない）。押すとその時刻へ移動。ここでは編集しない（直すのは台本パネル）

## 5. 作り方からの生成

- 作り方（playbook.json）の任意項目 `beats[]`（`{ id, at, duration, title, note?, placeholder? }`・秒）を、`applyPlaybook` が
  予定の行（`kind: plan`・`text` = `title`（`note` があれば「title: note」）・`author: playbook`）として `planning/script.json` に書く。
  同時に、内訳 1 つ = 空のキャンバス 1 つ（名前 = title・`canvas.intent` = note か title）にして仮枠の段に並べる（`beats` が無いときは従来どおり仮枠ごとに 1 つ）
- `record-playbook` は、終わったプロジェクトの `planning/script.json` の予定の行（あれば）と章・見出しから `beats` を起こす

## 6. 開けた問い

1. 予定の行を「済」にしたら、対応する空のキャンバスを畳むか（v0 は何もしない）
