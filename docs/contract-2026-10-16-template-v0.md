---
lifecycle: accepted
created: 2026-10-16
updated: 2026-10-16
---

# template-v0（テンプレート = 作り方の深さ 3）契約

- 日付: 2026-10-16
- 状態: **v0 受理（2026-10-16 オーナー GO）**。実装は本契約の範囲に限る
- 前提: `contract-2026-10-15-playbook-v0.md`（作り方。本契約はその §8 の「深さ 3」を、範囲を絞って範囲内に入れる）/
  `contract-2026-09-25-canvas-v0.md`（キャンバスと仮枠 = `source.kind: group` + `canvas.origin: plan`）/
  `contract-2026-09-02-asset-reference-model.md`（参照台帳）/ `contract-2026-10-15-project-manifest-v0.md`（依存グラフ）/
  `contract-2026-09-13-extension-kit-v0.md`（キットで配る）
- 発端: 他の編集ソフトでは、作り込み済みのひとまとまり（音・テロップ・動き・尺が決まっていて、映像だけ空いている）を
  ライブラリからタイムラインへ落とし、中の映像だけを入れ替えて使える。作り方（手順を AI が組み立てる）とは別に、
  「映像を変えるだけでいい」ものを同じ仕組みで持ちたい
- スコープ: テンプレートの**形（playbook.json の `template` と断片ファイル）・置き場・検査・ライブラリの棚・タイムラインへ置く規則・仮枠への差し替え規則・テンプレートを書き出す CLI**
- 非スコープ（§7）: Lab での販売の画面 / タイムラインの右クリックから書き出す画面 / テンプレートの中の文字の一括差し替え / プロジェクト全体（edit.json 全部）の配布

## 0. 位置づけ

| 語 | 意味 |
|---|---|
| 作り方 | 深さ 1・2。手順・設定・仮枠。中身（素材）は持たない（playbook-v0） |
| **テンプレート** | **深さ 3 の作り方**。作り込み済みのまとまり 1 つ（`group` の項目 1 つ + その子）と、その中で使う素材の実体を持つ。空いているのは仮枠だけ |
| （呼び名） | 画面・CLI の表示・説明文では必ず「テンプレート」と書き、「テンプレ」と略さない（略すと伝わらない人がいる。オーナー 2026-10-16）。コードの識別子は `template` |
| スロット | テンプレートの中の仮枠のうち、使う人が埋める枠。`placeholders[]` の 1 行と、断片の中の仮枠の項目 1 つを結ぶ |
| 置く（place） | ライブラリからタイムラインへ落とし、まとまり 1 つとして入れる |
| 差し替える（swap） | スロットへ素材を落とし、枠の尺のまま中身を替える |

- テンプレートは作り方の一種で、新しい `kind` や置き場を作らない。`kind: "akari-playbook"`・`depth: 3`・`template` を持つ
- 深さ 3 のテンプレートでも `steps` は必須のまま（「スロットを埋める → 書き出す」の 2 工程でよい）。プロジェクトを始める入口（`akari new --from`）からも使える（§5）

## 1. 置き場

作り方と同じ棚（`~/.akari/playbooks/<id>/`・`channels/<ch>/playbooks/<id>/`・キットの `playbooks/<id>/`）。テンプレートはその中に次を足す。

```
<id>/
  playbook.json            # depth: 3 と template を持つ
  playbook.md
  preview/                 # 任意（playbook-v0 と同じ）
  template/
    item.json              # 断片 = group の項目 1 つ（下の §2）
    media/<file>           # 断片が使う素材の実体
```

## 2. 形

### playbook.json に足すもの

```json
{
  "depth": 3,
  "template": {
    "item": "template/item.json",
    "fps": 30, "width": 1080, "height": 1920,
    "durationSec": 15,
    "slots": [
      { "placeholder": "main", "item": "slot-main" },
      { "placeholder": "product", "item": "slot-product" }
    ],
    "media": [
      { "path": "template/media/jingle.wav", "sha256": "…", "license": "CC0-1.0", "source": "builtin" }
    ]
  }
}
```

- `template.item`: 断片ファイルの相対パス。中身は edit.json v2 の `itemV2` 1 つで、`source.kind` は `group`（`canvas.origin: user`）。
  子は普通の `items[]`（`at` は親からの相対）。断片の中の素材の参照は **`template/media/<file>` の相対パス**だけ（絶対パス・`assets/` 外・URL は fail）
- `template.fps` / `width` / `height` / `durationSec`: 作ったときの値。置く先のプロジェクトと違えば、置くときに時間はフレームに直し（秒で保つ）、画は edit.json の既存の拡縮の規則に任せる
- `template.slots[]`: `placeholder` は `placeholders[].id`、`item` は断片の中の**仮枠の項目**（`source.kind: group`・`canvas.origin: plan`）の `id`。
  スロットの `kind`（video / image / audio）と尺は、`placeholders[]` と仮枠の項目から読む
- `template.media[]`: 断片が参照する素材を**全部**載せる（載っていない参照は fail・載っているのに使われていないものは警告）。
  `sha256` は必須。`source` は playbook-v0 の語彙のうち `builtin` / `lab` / `ai` / `own`（作った人が自分で作り権利を持つもの）。**`site` は fail**。
  `license` は必須。テンプレートそのものの `license` より緩いものは不可（例: テンプレートが `LicenseRef-AKARI-Assets-v0` なら素材はそれか CC0）
- depth 3 は `template` が必須。depth 1・2 は `template` を持たない

### 検査（`validate-playbook.mjs` に足す）

- 上の fail / 警告。断片の JSON が edit.json v2 の `itemV2` の形であること（edit.schema の該当定義で検査）
- スロットの `item` が断片の中に在り、仮枠の項目であること。`placeholders[]` のうちスロットに結ばれていないものは警告
- `media[].sha256` が実体と一致すること

## 3. ライブラリの棚（2026-10-16 改訂 — vocabulary-v0 §2）

- **ライブラリに並べるのはテンプレートだけ**。深さ 1・2 の作り方は文書なので棚に並べない（ホームの「作り始める」が入口）。表紙は `preview`、タイルに「尺・空き枠の数」の印
- 棚からドラッグできるのはテンプレート。落とすと §4 のとおり 1 つのまとまりになる
- （改訂前は「作り方の棚」を足し、深さ 2 も落とせるとしていた。深さ 2 を骨として置く機能は「作り方から始める」側に寄せる）

## 4. 置く・差し替える

### 置く

1. 落とした位置のフレーム・落としたトラックに、まとまり 1 つとして入れる。そのトラックのその区間が埋まっていれば、新しいトラックを足して入れる（既存の素材のドロップの規則に合わせる）
2. 断片の素材は `<project>/assets/templates/<playbook-id>/` へ写す（同じボリュームならハードリンク・違えばコピー。同名で中身が違えば `-2` を付ける = シーンの共通素材と同じ規則）。参照をそのパスに書き換える
3. 項目の `id` はすべて新しく振り直す（同じテンプレートを 2 回置いても衝突しない）。まとまりの `name` はテンプレートの `name`
4. 参照台帳に写した素材を載せる。プロジェクトに `.akari/manifest.json` があれば `uses` の線（そのシーン / プロジェクト → `asset:...`）を足す
5. 1 回の取り消しで全部戻る

### 差し替える

- 仮枠（テンプレートのスロットに限らず、`canvas.origin: plan` の項目すべて）に素材を落としたとき:
  - 空なら今の規則のまま中へ入れる（枠の尺に収める）
  - **すでに素材が 1 つ入っていれば、その素材を入れ替える**（位置と尺は枠に合わせたまま。音は入れ替えない）
- 合わない素材を落としたとき（スロットが映像なのに音を落とした 等）は入れずに知らせる。尺が足りない映像は入れたうえで「足りない」と知らせる
- タイムラインで、テンプレートから置いたまとまりの中のスロットは、まとまりを閉じたままでもドロップの的になる

## 5. 始める（`akari new --from` と `akari playbook apply`）

- テンプレートを `akari new --from <id>` で始めたときは、新しいプロジェクトの edit.json の 0 秒にまとまりを 1 つ置く（§4 の「置く」と同じ処理）。
  既存のプロジェクトへの `akari playbook apply` も同じ（最後のフレームの後ろに置く）

## 6. 書き出す（CLI）

- `akari playbook template <project> --item <group-item-id> --id <playbook-id> [--name ...] [--out ~/.akari/playbooks]`:
  edit.json の group の項目 1 つを断片にし、中で使う素材を `template/media/` へ写し、`sha256` と `license` を埋めてテンプレートを書く
  - 子の仮枠（`canvas.origin: plan`）をスロットにする。`placeholders[]` は仮枠の `intent` を `role` に、中身の種類を `kind` に
  - 素材の `license` / `source` は参照台帳と `meta.json` から写す。分からない素材があれば**書き出さずに止め**、どれが分からないかを出す（`--license-own <license>` を付けたときだけ、出どころ不明を `own` として通す）
  - `site` の素材が入っていれば止める（その素材を仮枠にしてから書き出す案内）

## 7. 非スコープ

- Lab での販売・審査の画面（キットで配る経路は既存のまま使える）
- タイムラインの右クリック「テンプレートとして書き出す」の画面（CLI だけ先に）
- テンプレートの中の文字（テロップ）をまとめて差し替える入力欄
- プロジェクト全体の配布（edit.json 全部 + 全素材）
