---
lifecycle: draft
created: 2026-10-16
updated: 2026-10-16
---

# showcase-v0（作例 = 完成した 1 本と、そこから辿る根拠）契約

- 日付: 2026-10-16
- 状態: **v0 ドラフト**（語は vocabulary-v0。本契約は作例のデータの形・区間・解決・CLI・スキルを決める。英語名は **Showcase** で確定〈2026-10-16〉。作例と作り方は一緒に扱う〈別々に公開しない〉）
- 前提: `contract-2026-10-16-vocabulary-v0.md` §3〜§7 / `contract-2026-10-15-playbook-v0.md`（作り方・`beats`・`preview`・`provenance`）/
  `contract-2026-10-15-project-manifest-v0.md`（`uses` の線と `kind` 語彙）/ `contract-2026-09-02-asset-reference-model.md`（参照台帳）/
  `contract-2026-10-16-automation-gates-v0.md`（公開は門）/ `contract-2026-09-13-extension-kit-v0.md`（キットで配る）
- 発端: 「この動画のここからここが良かった。これをイメージして作って」と頼んだら、エージェントがその作例の元（元データ・手順・道具の手順）を辿って作れるようにしたい。作り方（手順書）が全部書かれていなくても、完成した 1 本と短いメモがあれば参考にできること
- スコープ: 作例の形（`showcase.json`）・置き場・区間・開けるかの印の判定・解決（inspect）・登録（capture）・新規 / 既存プロジェクトへの適用・出典の記録・検査
- 非スコープ（§9）: Lab への公開と審査 / 作者への還元の率 / URL を貼って外の動画を作例にする分析 / 画面の最終デザイン

## 0. 位置づけ

| 語 | 意味 |
|---|---|
| 作例 | 完成した 1 本（動画）+ そこから辿れる根拠（区間・元データ・作り方・部品・利用条件）。誰が作ったかを問わない |
| 区間 | 作例の中の「ここからここ」。登録済み（id を持つ）と任意（開始–終了）の 2 種 |
| 根拠 | 区間で使われたテンプレート / 素材 / スタイル・edit.json の該当する項目・作り方の該当する節・道具の手順 |
| 開けるか | 説明だけ / 元データ付き / 素材もそろう の 3 段。依存を解決した結果で決め、推測で付けない |
| 登録（capture） | 完成した 1 本を手元の作例にする。公開ではない |
| 参考にして作る | 作例（の区間）を根拠として渡し、新規または既存のプロジェクトで作る |
| 編集データを開く | 元データと素材がそろう作例を、プロジェクトとして開く（ここから始める） |

## 1. 置き場

| 何 | どこ |
|---|---|
| 手元の作例 | `~/.akari/showcases/<id>/{showcase.json, video.mp4?, preview/, sources/?}` |
| チャンネルの作例 | `channels/<channel>/showcases/<id>/…` |
| キットで配る作例 | キットの `showcases/<id>/…`（manifest に `showcases[]` を足す = kit-v0 の改訂票） |
| プロジェクトの出自 | `<project>/.akari/manifest.json` の `uses`（`showcase:<id>@<版>#<区間>`）と参照台帳 |

- 解決順は作り方と同じ **チャンネル → 手元** の 2 択。Lab から入れた作例は手元に symlink
- `<id>` は英小文字・数字・ハイフン。版は `showcaseVersion`（整数）
- `video.mp4` は任意（重い。無ければ `preview/frames/` のコマと外部 URL だけ）。`sources/` は元データ（`edit.json`・シーン・`planning/`・使った素材の参照一覧）。素材の実体は持たず参照で指す（素材は Lab 先行の規律）。自分で撮った映像は `sources/assets/` に**ハードリンクかコピー**で持ってよい（配るときは利用条件の検査で止まる）

## 2. 形 — showcase.json

```json
{
  "version": 0,
  "kind": "akari-showcase",
  "id": "morning-vlog-60s",
  "showcaseVersion": 1,
  "title": "朝の Vlog 60 秒",
  "author": { "id": "akari-labs", "name": "AKARI Labs" },
  "video": { "path": "video.mp4", "sha256": "…", "durationSec": 60.0, "fps": 30, "width": 1080, "height": 1920, "url": "https://…" },
  "segments": [
    { "id": "s02-hands", "start": 5.0, "end": 12.0, "title": "手元の寄り", "feature": "湯気に合わせて文字がゆっくり出る", "frame": "preview/frames/02.png",
      "edit": { "trackIds": ["v1", "t1"], "itemIds": ["it-14", "it-15", "it-22"] },
      "playbook": { "step": "cut", "beat": "b2" } }
  ],
  "timeMap": [ { "video": [0, 60], "timeline": [0, 60] } ],
  "sources": { "edit": "sources/edit.json", "scenes": [], "planning": "sources/planning/", "references": "sources/asset-references.json" },
  "playbook": { "id": "kaisetsu-vertical-60s", "version": 1, "path": "sources/planning/playbook.md" },
  "parts": [
    { "kind": "template", "id": "hands-closeup-15s", "version": 1, "source": "lab", "license": "LicenseRef-AKARI-Assets-v0", "segments": ["s02-hands"] },
    { "kind": "asset", "category": "overlay", "id": "telop-base-painted-wood", "source": "lab", "license": "CC0-1.0", "segments": ["s02-hands"] },
    { "kind": "style", "uid": "st_01HZ…", "revision": 2, "source": "builtin", "license": "CC0-1.0", "segments": ["s02-hands"] },
    { "kind": "asset", "category": "audio", "id": "light-loop-01", "source": "lab", "license": "LicenseRef-AKARI-Assets-v0", "segments": ["*"] }
  ],
  "openable": "sources",
  "license": "CC0-1.0",
  "provenance": { "fromProject": "morning-vlog", "capturedAt": "2026-10-16T15:00:00+09:00", "akariVersion": "1.5.0", "capturedBy": "capture-showcase" },
  "preview": { "cover": "preview/cover.png", "frames": ["preview/frames/01.png", "preview/frames/02.png", "preview/frames/03.png"] }
}
```

- 必須: `version`（0）・`kind`・`id`・`showcaseVersion`・`title`・`author`・`video`（`durationSec`・`fps`・`width`・`height` は必須。`path` か `url` のどちらか）・`license`・`provenance`・`preview`
- 任意: `segments[]`・`timeMap[]`・`sources`・`playbook`・`parts[]`・`openable`
- **`openable` は書くのではなく計算する**（§4）。ファイルに書くのは登録時の結果で、読むたびに再計算して食い違えば再計算の値を使う
- `segments[].start` / `end` は秒（小数可）。**開始を含み、終了を含まない**。`end` ≤ `video.durationSec`。`id` は作例の中で一意で、版をまたいで安定させる（区間の意味が変わったら新しい id）
- `segments[].feature` = 注目してほしい特徴（作者が書く）。`edit` = `edit.json` の該当する項目（任意。無ければ `timeMap` で時間から引く）。`playbook` = 作り方の節（`steps[].id`・`beats[].id`）
- `timeMap[]` = 書き出した動画の時刻と edit.json のタイムラインの対応（速度・トリムがあるとき。無ければ恒等）
- `parts[]` の語彙は project-manifest v0 / playbook-v0 §2 と同じ（`kind`・`source`・`license`）。`segments` にどの区間で使ったかを持つ（`"*"` = 全体）
- `source: own` / `site` の部品は `parts` に残してよい（作り方と違い、作例は「何を使ったか」の記録なので隠さない）。ただし配るとき（キット・Lab）は利用条件の検査で止まる
- 並びは `segments` が `start` 順、`parts` は `kind` → `id` の安定ソート。書き込みは tmp + rename。読み手は tolerant reader

## 3. 区間の指し方

- 文字列の形: `showcase:<id>[@<版>]#<区間 id>` または `showcase:<id>[@<版>]#<start>-<end>`（秒。例 `#5.0-12.0`）。版を省くと手元の最新
- 区間を時間で指したときは `timeMap` でタイムラインの時刻に直し、重なる項目を `edit.json` から引く
- **区間の外の依存も含める**: 区間に重なる項目が参照する素材・フォント・スタイル・音源（BGM が全体にかかるときはそれも）
- 動画の版が参照より新しいときは「古い版の区間」と明示し、黙って時間をずらさない

## 4. 開けるかの判定（`openable`）

| 値 | 条件 |
|---|---|
| `description` | `video` か `preview` がある（最低条件） |
| `sources` | + `sources.edit` が読め、`parts[]`（または参照台帳）が揃っている |
| `ready` | + `parts[]` のすべてが手元にあるか取得できる（同梱 / Lab で入手可 / `own` で `sources/assets/` にある）。1 つでも欠ければ `sources` に落ち、欠けた物を一覧で出す |

- 判定は依存を実際に引いて行う（推測しない）。結果と欠けた物は `akari showcase inspect` の出力に含める

## 5. 解決 — `akari showcase inspect`

```
akari showcase inspect <id>[@<版>] [--segment <id> | --range <start>-<end>] [--json]
```

出力（JSON のとき）は 4 つに分ける: `found`（辿れた根拠: 区間・項目・部品・作り方の節・道具の手順）/ `missing`（足りない物）/ `authored`（作者が書いた説明: `feature`・作り方の文）/ `inferred`（エージェントや CLI が推測した事: 「この項目はテロップ台と思われる」）。
画面と `create-from-showcase` はこの 4 つを混ぜずに見せる・渡す。

## 6. 登録 — `akari showcase capture`

```
akari showcase capture <project> --id <id> [--title] [--video <exports/…mp4>] [--segments auto|none] [--out ~/.akari/showcases]
```

- プロジェクトの最新の書き出し（`exports/`）を `video` に、`edit.json` と `planning/`・参照台帳を `sources/` に写し、`parts[]` を manifest / 参照台帳から埋める。作り方（`planning/playbook.{md,json}`）があれば `playbook` に結ぶ
- `--segments auto` は作り方の `beats`（無ければ台本の見出し）から区間を起こす。`feature` は空で、あとから人が書く
- 素材の実体は写さない（参照）。`own` の映像は `sources/assets/` にハードリンク（違うボリュームならコピー）
- ライセンス不明の部品があっても**登録は止めない**（作例は記録）。欠けは `missing` に出す。止めるのは配るとき

## 7. 使う

- **参考にして作る**: スキル `create-from-showcase`。入力 = 作例（と区間）+ 依頼者の**注目点**（文字の動き / 色 / テンポ / 構図 / 音。複数可）+ 対象（新規 / 既存プロジェクトの区間）。`inspect` の 4 分類をそのまま文脈に渡し、できたプロジェクトの manifest に `uses: showcase:<id>@<版>#<区間>` と注目点を残す
- **編集データを開く**: `akari new <dir> --from showcase:<id>[@<版>]`。`openable` が `ready` のときだけ。`sources/` を雛形の上に写し、`parts[]` の Lab の部品は入手（門: 有償なら止まる）。`sources` 止まりなら「足りない物」を出して止める
- **テンプレートを使う**: 作例の `parts[]` に `kind: template` があれば、作例の詳細から直接そのテンプレートを置ける（重複表示しない。vocabulary-v0 §2）
- **ホームと編集中**: ホームの「作り始める」に作例の一覧（区間と開けるかの印つき）。編集中は**左のライブラリのパネル**に「作例」の分類で一覧し、押すと**真ん中のパネル**（プレビューの面）に作例のプレビューと詳細（区間・部品・作り方・開けるか・「参考にして作る」「編集データを開く」）を収める（vocabulary-v0 §11-3）

## 8. 出典と利用実績

- イベント: `viewed`（開いた）/ `traced`（inspect した）/ `applied`（参考にして作った・編集データを開いた・テンプレートを置いた）。形 `{ event, kind: "showcase", id, version, segment?, playbook?, at, by }`。置き場は作業場の記憶（`.akari/memory/usage.jsonl`）と、適用したプロジェクトの manifest
- 還元の計算に数えるのは `applied` だけ。`traced` は数えない

## 9. 非スコープ

- Lab への公開・審査・還元の率（クリエイター登録の契約で）
- URL を貼って外の動画を分析し作例にする（別票。playbook-v0 §8 と同じ）
- 画面の最終デザイン
- 動画の実体の配布の最適化（重さ・差分）

## 10. 検査

- `packages/schemas/showcase.schema.json`（closed object・additive-only）と `validate-showcase.mjs`
- 検査項目: 必須項目 / `segments` の範囲と一意性と順序 / `timeMap` の単調 / `parts[]` の語彙 / `video.sha256` が実体と一致（`path` のとき）/ `playbook` の参照先が在る（警告）/ `openable` の再計算と一致（警告）

## 11. 開けた問い

1. `video.mp4` を手元に持つ既定にするか、`preview/frames` + URL を既定にするか（重さ）
2. 区間の `edit.itemIds` を登録時に埋める（捕まえやすい）か、常に `timeMap` から引く（ずれにくい）か
3. （裁定済み: 作例と作り方は一緒に公開する。vocabulary-v0 §11-4）
