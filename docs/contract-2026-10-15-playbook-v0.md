---
lifecycle: accepted
created: 2026-10-15
updated: 2026-10-15
---

# playbook-v0（作り方 = Playbook）契約

- 日付: 2026-10-15
- 状態: **v0 受理（2026-10-15 オーナー GO）**。実装は本契約の範囲に限る
- 前提: `contract-2026-07-25-project-structure-v0.md`（プロジェクト内の置き場所）/
  `contract-2026-07-17-data-contract-versioning.md`（版管理三原則。初版から適用）/
  `contract-2026-09-02-asset-reference-model.md`（参照台帳 `.akari/asset-references.json`）/
  `contract-2026-09-24-style-v0.md`（利用台帳 `.akari/style-usage.json`）/
  `contract-2026-09-13-generation-v0.md`（仮枠。`planning/frames/<stem>.scene.json` と `assets/generated/`）/
  `contract-2026-10-15-project-manifest-v0.md`（依存グラフ。本契約の `parts` と同じ語彙）/
  `skills/create-project/SKILL.md` と `akari new`（雛形の写し。本契約はここに `--from` を足す）
- 発端: 1 本作り終えたプロジェクトの「作り方」を記録し、次のプロジェクトを同じ作り方から始められるようにしたい。
  テンプレート（`templates/project-default` = 器、`channels/<ch>/templates/*.md` = 企画書の下書き）では
  工程・設定値・仮枠・使った部品・要る道具が残らない
- スコープ: 作り方の **形（playbook.md と playbook.json）・置き場・記録の規則（プロジェクト → 作り方）・
  適用の規則（作り方 → 新しいプロジェクト）・確認シート・検査**。深さは ① 流れと設定 と ② 部品と仮枠 まで
- 非スコープ（§8）: ③ 元データごと（edit.json そのもの + 素材の実体）の配布 / Lab での公開・入手 /
  URL から作り方を起こす分析 / クリエイター登録 / 画面の最終デザイン

## 0. 位置づけ — 作り方は「文書 + 目録」で、エンジンではない

作り方（Playbook）は、**人が読む `playbook.md`** と **機械が読む `playbook.json`** の対で 1 つ。
どちらも正本で、`playbook.json` は `playbook.md` の目録に相当する（章と項目が 1 対 1）。
作り方は工程の並びと確認点を書いた文書であり、自動で回す仕組みは持たない（回すのはスキル）。

| 語 | 意味 |
|---|---|
| 作り方 / Playbook | 流れ（工程と確認点）+ 設定値 + 仮枠 + 使った部品 + 要る道具 + ライセンス |
| 記録する（record） | 終わったプロジェクトから作り方を書き出す |
| 始める（apply） | 作り方から新しいプロジェクトを起こす（雛形 + 作り方 + 仮枠つきの骨 + 確認シート） |
| 深さ（depth） | 1 = 流れと設定だけ / 2 = 部品と仮枠も / 3 = 元データごと（非スコープ） |
| 仮枠（placeholder） | 素材を役割に抽象化した空き枠。始めたとき edit.json の骨に並ぶ |

## 1. 置き場

| 何 | どこ | 誰が書く |
|---|---|---|
| プロジェクトの作り方（記録したもの） | `<project>/planning/playbook.md` と `<project>/planning/playbook.json` | `record-playbook` スキル |
| 手元の作り方（自分用の棚） | `~/.akari/playbooks/<id>/{playbook.md, playbook.json, preview/}` | 人・スキル（記録の写し） |
| チャンネルの作り方（配りたいもの） | `channels/<channel>/playbooks/<id>/{playbook.md, playbook.json, preview/}` | 人・スキル |
| 始めたプロジェクトに写したもの | `<project>/planning/playbook.md` と `playbook.json`（出どころを `provenance` に残す） | `akari new --from` |
| 確認シート | `<project>/.akari/reports/playbook-sheet.html`（読み取り専用・派生） | `akari new --from` |

- 一覧の解決順は **チャンネル → 手元** の 2 択だけ（`create-project` の雛形解決と同じ規律。他の経路を作らない）
- `preview/` は任意（下の項）
- `preview` のパスはすべて **playbook.json からの相対**。棚（手元・チャンネル）では `preview/cover.png`（任意）と `preview/frames/01.png`〜`05.png`（重要な場面のコマ 3〜5 枚・長辺 640px 以下・作り方の画面比）を置く。表紙が無ければ `frames` の 1 枚目を表紙にする。動画（sample.mp4）は持たない（重いため）。プロジェクトの中では `planning/playbook-preview/frames/` に置く
- `<id>` は英小文字・数字・ハイフン。同じ `id` は版で区別する（`version` 整数）

## 2. 形 — playbook.json

```json
{
  "version": 0,
  "kind": "akari-playbook",
  "id": "kaisetsu-vertical-60s",
  "name": "縦の解説 60 秒",
  "playbookVersion": 1,
  "depth": 2,
  "category": "explainer",
  "tags": { "form": ["vertical"], "length": ["30-60s"], "technique": ["live-action"], "tools": ["voicevox"],
            "style": [], "industry": [], "materials": ["talking-head", "screen-capture"], "scale": ["solo"] },
  "requires": { "cli": ">=1.4.0", "tools": ["voicevox"], "skills": ["edit-plan", "render-cut"] },
  "steps": [
    { "id": "intake",   "title": "素材を置く",        "what": "画面収録と顔出しを assets/ に置き、analyze-footage を回す", "skill": "analyze-footage", "checkpoint": false },
    { "id": "script",   "title": "台本を確定する",    "what": "planning/script.md を書き、冒頭 3 秒のつかみを決める",        "skill": "research-plan",   "checkpoint": true },
    { "id": "cut",      "title": "カットを整える",    "what": "無音を詰め、字幕を当てる",                                 "skill": "edit-plan",       "checkpoint": false },
    { "id": "export",   "title": "書き出す",          "what": "1080x1920 で exports/ に出す",                             "skill": "render-cut",      "checkpoint": false }
  ],
  "settings": {
    "aspect": "9:16", "fps": 30, "targetDurationSec": 60,
    "captions": { "styleUid": "st_01HZ…", "position": "lower" },
    "transitions": { "default": "cut" },
    "audio": { "roles": { "voice": -14, "bgm": -24 } }
  },
  "placeholders": [
    { "id": "talking-head", "role": "話している本人の寄り", "kind": "video", "durationHintSec": 40, "sample": { "category": "sample", "id": "placeholder-talking-head" } },
    { "id": "screen",       "role": "画面収録",           "kind": "video", "durationHintSec": 20 },
    { "id": "bgm",          "role": "軽めの BGM",         "kind": "audio", "sample": { "category": "audio", "id": "light-loop-01", "source": "lab" } }
  ],
  "parts": [
    { "kind": "style", "id": "caption-pop", "uid": "st_01HZ…", "revision": 2, "source": "builtin", "license": "CC0-1.0" },
    { "kind": "asset", "category": "audio", "id": "light-loop-01", "source": "lab", "license": "LicenseRef-AKARI-Assets-v0", "tier": "free" }
  ],
  "license": "CC0-1.0",
  "provenance": { "fromProject": "akari-howto", "recordedAt": "2026-10-15T10:00:00+09:00", "akariVersion": "1.4.0", "recordedBy": "record-playbook" }
}
```

- 必須: `version`（0 固定。原則 1）・`kind`（`"akari-playbook"`）・`id`・`name`・`playbookVersion`・`depth`・
  `category`・`steps[]`・`settings`・`license`・`provenance`。`tags` / `requires` / `placeholders` / `parts` は
  省略可（depth 1 では `placeholders` と `parts` を持たない）
- 任意: `preview`（`{ "cover"?: string, "frames"?: string[] }`。パスは上の規則）・`example`（`true` なら見本として配る例。画面に「例」の印を出す）
- 任意: `beats`（`{ id, at, duration, title, note?, placeholder? }[]`・秒。作り方の内訳。始めたとき空のキャンバスと台本の予定の行になる。script-lines-v0 §5）
- `category` は 1 つだけ。語彙は閉じる: `film` / `short-drama` / `mv` / `explainer` / `product` / `vlog` / `cm` /
  `education` / `clip` / `logo`。足すときは本表に追記してから
- `tags` の 8 軸は開いた語彙（自由に足せる）。軸の名前だけ固定: `form` / `length` / `technique` / `tools` /
  `style` / `industry` / `materials` / `scale`。`tools` は `requires.tools` から機械的に写す
- `steps[]`: `id`・`title`・`what` が必須。`skill` は公開リポの `skills/<name>` の名前。`checkpoint: true` は
  **人の確認点**（自動で回すときはここで止まる。始めるときの確認シートにも出す）
- `settings`: 自由なオブジェクト。推奨キーは上の例（`aspect` / `fps` / `targetDurationSec` / `captions` /
  `transitions` / `audio`）。edit.json の値をそのまま写さず、**次のプロジェクトで最初に当てる値**だけを書く
- `placeholders[]`: `id`・`role`・`kind`（`video` / `image` / `audio`）が必須。`sample` は見本の素材参照
  （参照台帳と同じ `{category, id}` + `source`）。**素材の実体は持たない**。`source: own` / `site` の素材は
  必ず仮枠にし、`sample` を付けない（外部由来を見本に映さない）
- `parts[]`: project-manifest v0 の `kind` 語彙（`asset` / `style` / `kit`）と `source`（`builtin` / `lab` / `own` /
  `site` / `ai`）。`license` は素材の `meta.json` から写す。`own` / `site` の部品は `parts` に残さず仮枠へ
- `license`: 作り方そのもののライセンス。無料で配るものは `CC0-1.0`、有償は `LicenseRef-AKARI-Assets-v0`
- 並びは `steps` が記述順、他は `id` の安定ソート。書き込みは tmp + rename。読み手は tolerant reader

## 3. 形 — playbook.md（章立て固定）

```markdown
# 縦の解説 60 秒            ← name。直下に 1 行で「何ができるか」
## 目的とできあがり         ← category と、できあがりの説明（尺・形・雰囲気）
## 流れ                     ← steps を番号つきで。確認点は「☑ ここで確認」と明記
## 設定値                   ← settings を表で（キー / 値 / 意味）
## 必要な素材（仮枠）        ← placeholders を表で（役割 / 種類 / 尺の目安 / 見本）
## 内訳                     ← beats を表で（時刻 / 見出し / メモ / 仮枠）
## 使った部品               ← parts を表で（種類 / 名前 / 入手先 / ライセンス）
## 要る道具                 ← requires（CLI の版・道具・スキル）。無いときの代案を 1 行
## ライセンス               ← license と、外部由来を仮枠にした旨
## 出どころ                 ← provenance（どのプロジェクトから・いつ・どの版で）
```

章の追加は末尾のみ（additive-only）。章の名前は上の表記で固定し、読み手はこの見出しで章を引く。
例外として「内訳」の 1 章だけは「必要な素材（仮枠）」の直後に置く。

## 4. 記録する — プロジェクト → 作り方（`record-playbook` スキル）

入力はプロジェクトのルート。出力は `planning/playbook.md` と `planning/playbook.json`（既にあれば `playbookVersion` を上げて上書き。他は `flag:'wx'`）。

| 章 / 項目 | 取り出し元 | 規則 |
|---|---|---|
| `steps` | `decisions.json`（判断の記録）・`planning/` の文書・使ったスキルの痕跡（`.akari/reports/` の種類） | 工程として並べ、`checkpoint` は決定ログで人が承認した点に立てる。取り出せないときは `steps` を 4 つの既定（素材を置く / 台本を確定する / カットを整える / 書き出す）で埋め、`what` に「要確認」と書く |
| `settings` | `edit.json`（アスペクト・fps・字幕スタイル・トランジションの既定・音のロール） | 値をそのまま写さず「最初に当てる値」に丸める（例: 尺は target、個々のカットの長さは写さない） |
| `placeholders` | `edit.json` の sources と `analysis.json` のタグ・話者 | 素材 1 つ = 仮枠 1 つではなく**役割で束ねる**（同じ役割の素材は 1 枠に `durationHintSec` を足し合わせる）。`own` / `site` は `sample` なし |
| `parts` | `.akari/asset-references.json`・`.akari/style-usage.json` | `builtin` / `lab` / `ai` だけ残す。`own` / `site` は仮枠へ |
| `requires` | 使ったスキル・レシピの `requires`（`blender` 等）・CLI の版 | — |
| `license` | 人が決める。既定は `CC0-1.0` | スキルは既定を書き、`playbook.md` の章に「要確認」と残す |
| `provenance` | プロジェクト名・現在時刻・`akari --version` | — |

スキルは確認を人に 1 回だけ取る（`name` と `category` と `license`）。それ以外は自走し、終わりに
`playbook.md` の要約（流れ・仮枠の数・部品の数・要る道具）を 1 画面で報告する。

## 5. 始める — 作り方 → 新しいプロジェクト（`akari new --from`）

```sh
akari new <target-dir> --from <playbook-dir | id> [--lang <bcp47>]
```

1. `--from` が `id` のときは §1 の解決順（チャンネル → 手元）で `playbook.json` を探す。無ければ非 0 で終わる
2. `templates/project-default` を従来どおり写す（既存の規律と作成レポートはそのまま）
3. `planning/playbook.md` と `planning/playbook.json` を写し、`provenance.appliedFrom` に出どころ
   （パスと `playbookVersion`）と時刻を足す
4. `settings` を edit.json の初期値に当てる（アスペクト・fps・字幕スタイル・音のロール）。
   `placeholders` を **仮枠として edit.json の骨に並べる**（generation-v0 の仮枠の形を使う。
   `sample` があれば見本として参照し、無ければ空の仮枠）。素材の実体は置かない
5. `requires.tools` を道具チェックに掛け、無い道具は作成レポートと確認シートに「無い」と出す（止めない）
6. 確認シート `.akari/reports/playbook-sheet.html` を書く（§6）
7. 標準出力に作成レポートと確認シートのパスを出す

`--from` を付けないときの挙動は一切変えない（`--template` との併用は可。雛形の解決経路は増やさない）。

## 6. 確認シート（読み取り専用 HTML）

取り込む前に見る 1 枚。既存の作成レポートと同じ生成器・同じ見た目（自己完結 HTML・決定 UI なし）で、
行は固定: **名前と目的 / 深さ / 流れ（確認点つき） / 設定値の数と主な値 / 仮枠（役割・種類・見本の有無）/
使った部品（入手先・ライセンス・Pro 要否）/ 要る道具（持っていないものを明記）/ ライセンス / 出どころ**。
画面側（シェル）はこの HTML をそのまま表示し、ボタン（白紙から / 取り込んで始める）は HTML の外に置く。

## 7. 検査

- `packages/schemas/playbook.schema.json`（closed object・additive-only）と `validate-playbook.mjs`
- 検査項目: 必須項目 / `category` の語彙 / `steps[].skill` が存在するスキル名か（警告）/ `placeholders[].sample`
  に `source: own` / `site` が無いこと（**fail**）/ `parts[]` に `own` / `site` が無いこと（**fail**）/
  `playbook.md` の章立てが §3 と一致すること（見出しの有無のみ）

## 8. 非スコープ

- 深さ 3（元データごと）。edit.json そのものと素材の実体の配布
- Lab での公開・入手・検索・タグ俯瞰・クリエイター登録・還元
- URL を貼って作り方を起こす分析
- 画面の最終デザイン（ポップアップの出だしは別の実装票。本契約は形と CLI と確認シートまで）
- 自動で回す仕組み（作り方は文書。回すのはスキルと人）

## 9. 開けた問い（オーナー裁定待ち）

1. `settings` の推奨キーをこの 6 つに固定するか、edit.json の該当キー名と揃えるか
2. 仮枠の見本（`sample`）を `~/.akari/playbooks/<id>/preview/` に実体で持たせるか、参照だけにするか
