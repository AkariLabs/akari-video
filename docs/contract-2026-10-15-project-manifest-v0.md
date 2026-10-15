---
lifecycle: accepted
created: 2026-10-15
updated: 2026-10-16
---

# project-manifest-v0（プロジェクトの依存グラフ）契約

- 日付: 2026-10-15
- 状態: **accepted**（2026-10-16。同日の裁定で「作品」の器を廃し、プロジェクトで閉じる形に改訂。開けた問い 2 つは §8 の既定で確定）
- 前提: `contract-2026-07-17-data-contract-versioning.md`（版管理三原則。本契約は初版から適用する）/
  `contract-2026-09-02-asset-reference-model.md`（プロジェクトの参照台帳 `.akari/asset-references.json`）/
  `contract-2026-09-24-style-v0.md`（スタイルの利用台帳 `.akari/style-usage.json`）/
  `contract-2026-10-10-channel-people-design-v0.md`（チャンネルの人物 `people.json`・デザイン素材）/
  `contract-2026-07-25-project-structure-v0.md`（プロジェクト内の置き場所）/
  `contract-2026-09-13-world-map-v0.md`（ワールドマップ `planning/world-map.json`。世界観がプロジェクトの中に置かれる先例）
- 発端: 1 本の動画を超えるもの（複数のシーン・ワールド・人物・外の道具の出力を束ねるもの）を
  扱うとき、「何が何を使っているか」だけを 1 枚で持ちたい。edit.json は 1 本の並びの正本であり、
  シーンをまたぐ広がりは持たない。参照台帳と利用台帳は素材・スタイルに限られ、シーン・ワールド・
  人物・道具の出力を表せない。**単位は増やさない**: 器は従来どおりプロジェクト 1 つで、
  シーンはその中に 1 段だけ入れ子にする（「作品」という別の器は作らない）
- スコープ: プロジェクト単位の依存グラフ `manifest.json` の**置き場・形・語彙・解決規則・派生物**と、
  シーンを持つプロジェクトの最小の構成（§1）。既存の edit.json / 参照台帳 / 利用台帳は変えない（§5）。
  **相関図や構成の木の UI 実装、Lab への公開形式、外の道具との自動連携、既存プロジェクトの一括移行、
  アプリが入れ子の edit.json を開く実装は非スコープ**（§7）

## 0. 位置づけ — 持つのは「関係」だけ

manifest は「このプロジェクトに、何が、どの版で関わっているか」の目録である。実体（動画・3D・
Blender のファイル）は持たず、編集の中身（カットの位置・字幕）も持たない。

| 正本 | 持つもの |
|---|---|
| `edit.json` | 1 本（1 シーン）の中の並び（カット・素材の使用範囲・字幕の時刻） |
| `.akari/manifest.json`（本契約） | プロジェクトに関わるものの一覧（nodes）と、誰が誰を使うかの線（edges） |
| `.akari/asset-references.json` | 参照する素材の `{category, id}`（従来どおり） |
| `.akari/style-usage.json` | 当てたスタイルの `style_uid` と `revision`（従来どおり） |

manifest から派生するもの（読み取り専用。正本に書き戻さない）:
相関図（HTML・inline SVG）/ 構成の木（プロジェクト → シーン → カット）/ 取り込む前の確認シート
（件数・入手先・要る道具・大きさ）/ 壊れ検査（§4）/ 作り方（playbook）の「使った部品」の章。

## 1. 置き場 — プロジェクトで閉じる

```text
<project>/                      ← 器はこれ 1 つ（従来どおり）
├─ edit.json  captions.json     ← 1 本のプロジェクトはここに（従来どおり・変更なし）
├─ planning/  assets/  .akari/  ← project-structure-v0 のまま
├─ scenes/                      ← シーンを持つプロジェクトだけ。入れ子はこの 1 段だけ
│  ├─ scene-01/  edit.json  captions.json  assets/  .akari/   ← 中身は 1 本のプロジェクトと同じ構成
│  ├─ scene-02/  …
│  └─ scene-03/  …  assets/scene3d/<id>/{scene.py, params}   ← 道具のレシピ（手で開く道具だけ tools/）
├─ world/<id>/world.json        ← 世界観（置き場・小物・色。中身は別契約・未起票）
├─ people.json                  ← このプロジェクトの人物。無ければチャンネルの people.json
└─ .akari/manifest.json         ← 本契約。プロジェクトの外を指さない
```

- manifest は `<project>/.akari/manifest.json` の 1 箇所。**プロジェクトの外（他のプロジェクト・
  チャンネルの別フォルダ）を `where` で指さない**。プロジェクトをまたいで共有したいもの
  （世界・人物・スタイル・キット）はライブラリかチャンネル経由の参照（`source`）で持ち、
  実体はプロジェクトに取り込むか、ライブラリで解決する
- `scenes/<scene>/` の中は 1 本のプロジェクトと同じ構成で、`edit.json` を持つ。
  **`scenes/` の下にさらに `shots/` `layers/` のような層を作らない**（入れ子は 1 段まで）
- **シーンを開く**: アプリはシーンのフォルダ `scenes/<scene>/` をそのまま作業フォルダとして開く（中身が 1 本の
  プロジェクトと同じ構成なので、edit.json・captions.json・assets/ の解決は 1 本のときと同じ）。
  そのとき containment の根は**プロジェクト**（`scenes/` の 1 つ上）で、シーンの edit.json から
  プロジェクト共通の `assets/` を `../../assets/<file>` で参照してよい。根の外（プロジェクトの外）は従来どおり拒否する。
  シーンのフォルダかどうかは「親の親に `.akari/` があり、親の名前が `scenes`」で判定する
- 1 本のプロジェクトは `scenes/` を持たず、従来どおりルートの `edit.json` で動く。
  manifest は無くてもよい（§5）
- 外の道具は 2 種に分ける。**エージェントが回せる道具**（Blender の bpy・生成 AI の API・ffmpeg）は
  レシピが正本で、出力は再生成できるキャッシュ（`contract-2026-07-14-3d-bake-recipe.md`。
  レシピは `assets/scene3d/<id>/`、出力は通常の素材）。**人が手で開く道具**だけ
  `<project または scene>/tools/<tool>/` に入力の覚え書き・出力ファイル（またはそのリンク）・記録を
  置いて往復する。どちらも道具の作業フォルダ本体は置かない
- `assets/` は平らに置く。AI がフォルダを切らない。意味づけ・分析は `analysis.json` と `meta.json` の側に持ち、
  画面の分類はそこから派生で描く

## 2. 形

```json
{
  "version": 0,
  "kind": "akari-project-manifest",
  "project": { "id": "hoshi-no-oji", "name": "星の王子さま", "revision": 3 },
  "nodes": [
    { "id": "world:desert",      "kind": "world",       "rev": 2, "where": "world/desert" },
    { "id": "person:prince",     "kind": "person",      "rev": 5, "where": "people.json#p-prince" },
    { "id": "scene:01",          "kind": "scene",       "rev": 1, "where": "scenes/scene-01" },
    { "id": "asset:still/rose",  "kind": "asset",       "rev": 1, "source": "lab", "category": "still" },
    { "id": "style:caption-a",   "kind": "style",       "rev": 2, "uid": "st_01HZ…" },
    { "id": "tool:blender/s01",  "kind": "tool-output", "rev": 1, "tool": "Blender 4.2",
      "where": "scenes/scene-01/assets/generated/<id>.mp4" }
  ],
  "edges": [
    { "from": "scene:01", "uses": "world:desert" },
    { "from": "scene:01", "uses": "person:prince" },
    { "from": "scene:01", "uses": "tool:blender/s01" },
    { "from": "tool:blender/s01", "uses": "person:prince", "note": "レンダーに使ったモデル" }
  ]
}
```

- `version`: 整数。初版は 0（原則 1）。`kind` は固定文字列 `"akari-project-manifest"`
- `project`: 任意。`id` は英小文字・数字・ハイフン。`revision` はプロジェクトの版（整数・増えるだけ）
- `nodes[]`: 必須。各要素は `id`・`kind`・`rev` が必須。`where` は**プロジェクトルートからの相対パス**
  （`..` を含めない。`people.json#<id>` のようなフラグメント指定を許す）。
  `source` は `builtin` / `lab` / `own` / `site` / `ai` / `channel`（入手先。参照台帳の
  `sourceKind` と同じ語彙 + `ai` + `channel`）。`tool` は道具の名前と版の自由文。`tool-output` は任意で `recipe`（作ったレシピの `<id>@<版>`）・
  `connector`（呼んだ接続〈サービス・ソフトウェア〉の名前と版）・`inputs_sha256`（入力のハッシュ）を持てる（再現と壊れ検査用）
- `edges[]`: 必須（空でもよい）。`from` と `uses` は nodes の `id`。`note` は任意。
  同じ `{from, uses}` の重複は持たない。自己参照と循環は持たない（§4 で検査）
- 並び: nodes は `kind` → `id`、edges は `from` → `uses` の安定ソート。書き込みは
  tmp + rename の原子的更新。読み手は tolerant reader（未知フィールドは保持、欠損は既定値）

## 3. 語彙（kind と id の接頭辞）

| kind | id の形 | 指すもの | 版の正本 |
|---|---|---|---|
| `project` | `project:<id>` | プロジェクトそのもの（親を指すときだけ使う） | manifest の `project.revision` |
| `scene` | `scene:<id>` | `scenes/<id>/`（中は 1 本のプロジェクトと同じ構成） | そのシーンの `edit.json` の更新 |
| `world` | `world:<id>` | 世界観（場所・小物・色の束。`world/<id>/`） | `world.json` の revision（別契約・未起票） |
| `person` | `person:<id>` | `people.json` の 1 件（人・アバター・団体）。プロジェクトに無ければチャンネル | `people.json` の `edited` |
| `asset` | `asset:<category>/<id>` | 素材（参照台帳と同じ `{category, id}`） | `.meta.json` の版 |
| `style` | `style:<id>` | スタイル（`style_uid` と `revision`） | `style.json` の revision |
| `kit` | `kit:<channel>` | チャンネルのキット（将来） | kit の revision |
| `playbook` | `playbook:<id>` | 作り方（将来） | playbook の version |
| `tool-output` | `tool:<tool>/<id>` | 外の道具が出したファイル（レシピから焼いたものは provenance を持つ） | レシピ由来は provenance の版、手作業は `rev` を手で上げる |
| `doc` | `doc:<name>` | 台本・ストーリーボード・企画書など読む文書 | ファイルの mtime |

新しい kind は**この表に追記してから**使う。未知の kind を読んだ読み手は捨てず保持し、
相関図では「その他」として描く（原則 3）。

## 4. 解決と検査

- 解決: `where` はプロジェクトルートからの相対で解決する。`person` と `kit` だけは、プロジェクトに
  無ければチャンネル（`channels/<channel>/`）で再解決してよい（`source: channel`）。`asset` は
  参照台帳と同じ順（プロジェクト実体 → 共有ライブラリ）で解決する。どの経路でも字句・realpath の
  containment を満たさないパスは fail-closed で拒否する
- 検査（`akari project check` を想定。exit 非 0 は要修正）:
  1. `edges` の `from` / `uses` が nodes に無い → 欠落
  2. `where` の実体が無い → 未取得（`asset` で `source: lab` なら「未取得」、それ以外は「欠落」）
  3. 参照先の版が node の `rev` より新しい → 古い（情報。自動では直さない）
  4. 自己参照・循環 → 壊れ
  5. `source: site` または `own` で外部の実体を含む node が、公開用の写し（§6）に残っている → 公開不可
- 検査結果は `.akari/reports/manifest-check.json` に書き、HTML の派生と画面の帯はそこから描く

## 5. 既存ファイルとの関係（追加のみ・移行なし）

- `.akari/asset-references.json` と `.akari/style-usage.json` は**そのまま**。manifest の
  `asset` / `style` の nodes は、この 2 つから機械的に生成できる（`akari project sync`。
  シーンを持つプロジェクトでは各 `scenes/<id>/.akari/` の台帳を束ねる）。
  手で足した nodes（world・person・tool-output・doc）は sync で消さない
- `edit.json` は変えない。`scene` の node から `scenes/<id>/edit.json` を開けばカットの並びが見える
- 1 本のプロジェクトでは manifest を作らなくてもよい（無ければ 2 つの台帳だけで従来どおり動く）

## 6. 公開用の写し

作り方やプロジェクトを手元の外へ出すときは、manifest の**公開用の写し**を別に作る。写しでは
`where` を落として `id`・`kind`・`rev`・`source` だけを残し、`source: own` / `site` の
node は仮枠（`placeholder: true`）に置き換える。写しの形は本契約と同じ（`version: 0`）。
どの node を仮枠にするかの規則と、見本の扱いは作り方（playbook）側の契約で定める（未起票）。

## 7. 非スコープ

- 相関図・構成の木の画面（派生の描き方は別途）
- アプリが `scenes/<id>/edit.json` を開く実装（現状はルートの `edit.json` のみ）
- Lab での公開形式・取り込みの UI
- 外の道具（Blender 等）との自動連携・起動
- 既存プロジェクトへの manifest の一括生成
- `world` の中身の契約（`world.json`）と `kit` / `playbook` の契約

## 8. 裁定済みと開けた問い

- 裁定（2026-10-15）: 器はプロジェクト 1 つ。「作品」という別の器は作らず、シーンは `scenes/` に
  1 段だけ入れ子にする。manifest はプロジェクトの外を指さない
- 確定（2026-10-16。次の既定を採用）:
  1. `person` の版は v0 では `people.json` の `edited`（ISO 時刻）を整数に写さず、node に `edited` を
     そのまま持たせて比べる（`rev` は sync が `edited` の変化ごとに 1 上げる）。専用の revision は足さない
  2. `tool-output` の `rev` は手で上げてよいが、node に任意の `sha256` を持たせ、sync は実体のハッシュが
     変わったら `rev` を 1 上げる（手作業の上げ忘れを拾う）
- CLI: `akari project sync`（台帳 → nodes の生成・手で足した nodes は保持）/ `akari project check`
  （§4 の検査 → `.akari/reports/manifest-check.json`・exit 非 0 は要修正）/ `akari project scene add <id>`
  （`scenes/<id>/` を 1 本のプロジェクトと同じ雛形で作り、manifest に `scene` の node を足す）
