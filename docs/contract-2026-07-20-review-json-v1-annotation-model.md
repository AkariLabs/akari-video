# review.json v1 注釈モデル（target 5 型）契約

- 日付: 2026-07-20
- 状態: 実装ラウンドの SSOT（`review.json` の `annotations[]` レコード形のみ確定）
- 前提: レビュー第一 UI の方向性メモ §2（本契約はこの節を昇格したもの。
  メモ原本は非公開の内部記録で管理）、
  `contract-2026-07-18-edit-json-v1-sources.md` §3/§4（(src, source 秒) 永続化の鉄則と
  review.json への `src` 伝搬）、`contract-2026-07-17-data-contract-versioning.md`（三原則）、
  `contract-2026-07-14-edit-json-v1-crop.md`（座標系 rationale と劣化規約の先例）
- スコープ: `review.json` の `annotations[]` レコード形のみ。キャプチャ UI（矩形描画・
  ペン・音声同時注釈・asset picker）は扱わない（§9 次段）

## 0. version 運用（後方互換）

**data `version` は `0` のまま据え置く。**bump しない。本契約の追加フィールドはすべて
レコードの**任意フィールド**（`Option`）であり、存在しなければ従来と完全に同じ挙動になる。

- 契約名の「v1」は edit-json v1 系（crop / audio / sources）と同じ**wave 通称**であり、
  data の `version: 0` とは**別軸**（`contract-2026-07-14-edit-json-v1-audio.md` §0 と同じ扱い）。
  schema `$id` の `urn:akari-video:schema:review:v1` も同様に通称側
- 進化は**追加のみ**・読み手は**寛容リーダー**（未知フィールドを保持し、欠落は既定値で
  補う）。読み手が既知より大きい `version` を見たときは推測変換せず read-only で正直に
  停止する（原則 3。`annotation-store.ts` の `parseReview` / `validate-review.mjs` /
  `edit-lint` の三箇所で実装済み）
- 予約フィールド `strokes` の有効化は追加的変更である: 旧実装は読み取り時に警告つきで
  null 化するだけで、**既存行を書き換える経路を持たない**（追記とステータス行置換のみ）
  ため、旧リーダーが新データを破壊するラウンドトリップは発生しない

## 1. 確定スキーマ

正本: `packages/schemas/review.schema.json`（`$id: urn:akari-video:schema:review:v1`、
`additionalProperties: true`）。実例: `packages/schemas/examples/review-v1-sample/review.json`。

```jsonc
{
  "version": 0,
  "annotations": [
    {
      "id": "a-0007",
      "createdAt": "2026-07-20T09:12:00.000Z",

      // --- 時間アンカー（既存。意味変更なし） ---
      "src": "s1",                 // 任意。edit.json v1 sources[].id 参照。null/省略 = 単一ソース互換
      "sourceT": 12.4,             // 必須。source 秒（cuts[].in/out と同一座標系）
      "sourceRange": [12.4, 15.0], // 任意。[start, end) source 秒。null = 瞬間

      // --- 対象の分類（新規・追加のみ） ---
      "targetKind": "region",      // 任意。"instant"|"range"|"region"|"asset"|"insert"|null
                                   // null = 旧レコード（sourceRange の有無で instant/range を解釈）
      "region": { "box": [0.62, 0.08, 0.30, 0.22] }, // 任意。[x,y,w,h] 正規化 0〜1・source フレーム基準
      "strokes": null,             // 予約フィールドを有効化。[[[x,y],...],...] ペンストローク配列
      "refs": null,                // 任意。[{ "src": "s2" } | { "path": "assets/broll/city.mp4" }]
      "insertPosition": null,      // 任意。"before"|"after"|null（targetKind insert 用）

      // --- 意図と本文（メモ §2 の 4 つ組の残り） ---
      "intent": "reframe",         // 任意。自由文字列（推奨語彙は §3）
      "text": "顔がフレームアウトしてる、ここに寄って",  // 既存フィールド = 本文

      // --- 既存フィールド（挙動変更なしのもの） ---
      "timelineT": null,           // 非推奨（§2）。新規書き込みは常に null
      "target": null,              // 旧フィールド。本ラウンドでは意味を与えない（§5）
      "input": "typed",
      "audio": null,
      "poses": null,               // 予約のまま（実演キャプチャ・別機能）
      "status": "open",
      "response": null
    }
  ]
}
```

### フィールド表（新規・変更分のみ。既存フィールドは従来どおり）

| フィールド | 型 | 必須 | 既定値 | 単位・座標系 |
|---|---|---|---|---|
| `src` | string \| null | 否 | null | edit.json v1 `sources[].id` 参照（contract-2026-07-18 §4 の昇格） |
| `targetKind` | enum \| null | 否 | null（= 旧レコード解釈） | `instant` / `range` / `region` / `asset` / `insert` |
| `region` | `{ box: [x,y,w,h] }` \| null | 否 | null | 正規化 0〜1・**source フレーム基準**。`faceBox` / `crop.box` と同一形式。`x+w<=1` かつ `y+h<=1` |
| `strokes` | `[[x,y],...][]` \| null | 否 | null | ペンストローク。各点は正規化 0〜1・source フレーム基準。1 ストローク 2 点以上 |
| `refs` | `[{src} \| {path}][]` \| null | 否 | null | 1 エントリにつき `src` / `path` 排他。`path` はプロジェクト相対 |
| `insertPosition` | `"before"` \| `"after"` \| null | 否 | null | アンカー (src, sourceT) の timeline 射影位置の前/後 |
| `intent` | string \| null | 否 | null | 自由文字列（§3 推奨語彙。enum 強制しない） |
| `timelineT` | number \| null | 否 | null | **非推奨**（§2）。新規書き込みは常に null |

## 2. 座標系

### 時間 — (src, source 秒) で永続化する

`contract-2026-07-18` §3 の鉄則をそのまま踏襲する: 注釈は `(src, sourceT/sourceRange)` で
永続化し、**timeline 秒へ変換した結果を永続化してはならない**。表示のたびに、その時点の
`cuts[]` から timeline 秒へ射影する。cut の並べ替え・トリム・同一区間再利用で注釈が
ズレることを防ぐ。

`timelineT` はこの鉄則より前に生まれた旧フィールドであり、**deprecate-in-place** とする:
追加のみ原則によりフィールド削除はしない（型は残る）が、書き込み実装は常に `null` を
書き、非 null を読んだリーダーは警告を出し**値を根拠にしない**。

### 空間 — source フレーム正規化 0〜1

`region.box` / `strokes` の座標は **source フレーム基準**の正規化 0〜1。出力（合成後）
フレーム基準にしない理由は crop 契約 §2 と同型: 出力基準で永続化すると、当該カットの
`crop` キーフレームが後から変わった瞬間に座標が黙って腐る。source 基準なら下流の
リフレーミング判断と独立に安定する。`box` の形式は `analysis.schema.json` の `faceBox` /
`crop.keyframes[].box` と**同一**（`[x, y, w, h]`、`x+w<=1` かつ `y+h<=1`）で、契約を
またいだ矩形表現を 1 つに揃える。

## 3. targetKind の整合と解決規則

`targetKind` は判別子であり、型ごとの期待フィールドは**助言レベル**（warning。エラーに
しない）。null / 省略は旧レコードで、従来どおり `sourceRange` の有無で instant / range を
解釈する。

| `targetKind` | 期待するフィールド | 欠落時 |
|---|---|---|
| `instant` | （`sourceT` のみで十分） | — |
| `range` | `sourceRange` 非 null | warning |
| `region` | `region` または `strokes` 非 null（両方あれば `region.box` が勝ち + warning） | warning |
| `asset` | `refs` 非 null・非空 | warning |
| `insert` | `insertPosition` あり | warning |

### 挿入アンカーの解決（targetKind: insert）

- アンカーは `(src, sourceT)` + `insertPosition`。「この source 瞬間に対応する timeline
  位置の before / after に挿入する」という意味。先頭挿入 = 最初に生き残る瞬間 + `before`、
  末尾挿入 = 最後に生き残る瞬間 + `after`
- アンカーが現在の `cuts[]` に覆われていない（カットで落ちた）場合、注釈は**破棄しない**
  （人間の意図を消さない）。自動配置は未解決とし、`edit-lint` が warning
  `review.insert-anchor-unresolved` を出す
- 同一 `(src, sourceT)` が複数 cut に覆われる場合（v1 の 1 対多写像）は **`cuts[]` 配列順で
  最初にマッチした cut** を採用し、warning `review.insert-anchor-ambiguous` を出す
  （crop 契約 §4「配列順そのままの 0 番目」の先例踏襲）
- v1（マルチソース）で `src` が無い insert アンカーは解決不能 → warning

### intent の推奨語彙（enum 強制しない）

`cut / keep / reframe / insert / replace / reorder / fix / pace / mute / caption /
question / praise / other`。UI・AI のヒント用であり、validator は「空でない文字列」のみ
検査する。語彙追加に version 変更は不要。

## 4. 劣化規約

注釈は**助言データ**であり、書き出し・プレビュー・lint 全体の成否を左右してはならない
（crop 契約 §6・M5「だめなら使わない」と同じ哲学）。読み手（`annotation-store.ts`）は
壊れた要素だけを警告つきで無視し、ファイル全体を落とさない。

| 状況 | 挙動 |
|---|---|
| `targetKind` が未知の値 | null 扱い + warning（レコード自体は表示する） |
| `region` / `strokes` が不正形 | 当該フィールドのみ null + warning |
| `strokes` の一部ストロークが不正 | 不正なストロークだけ捨てて残りを使う + warning |
| `refs` の一部エントリが不正（src/path 両方・両方なし等） | 不正エントリだけ捨てる + warning |
| `refs[].path` の実体ファイルが無い | edit-lint warning `review.refs-file`（エラーにしない） |
| insert アンカーがカットで落ちている | 自動配置を未解決化 + warning（§3。注釈は残す） |
| `timelineT` 非 null | 警告 + 値は使わない（cuts[] から再射影） |
| `poses` 非 null | 予約フィールドとして無視 + warning（従来どおり） |
| `version > 0` | **read-only で正直に停止**（原則 3）。「新しい形式です。スキル / アプリを更新してください」 |

## 5. データ設計意図

- **フラットな任意フィールド + 判別子であり、ネスト union（`target: {kind, ...}`）に
  しない理由**: 既存レコードが `sourceT` / `sourceRange` をフラットに持っており、
  `annotation-store.ts` の行単位手術編集（1 レコード = 1 行、`serializeAnnotationLine` の
  フィールド逐次連結）と整合する。旧レコード（判別子なし）がそのまま有効であり続ける
- **旧 `target: string | null` フィールドに触らない理由**: 実装上一度も非 null を書かれた
  ことがなく、文書化された意味も無い。改名は破壊的変更（bump 必須）になるため今回は
  据え置き、`targetKind` との名前衝突をここに開示するに留める。将来の整理は次段
- **`refs` にカタログ参照（category/id/scope）を持たせない理由**: 素材ライブラリ契約の
  copy-don't-link 規律により、注釈が具体参照を持てる時点で対象はプロジェクト内の実体
  パスか `sources[].id` になっている。スコープ解決の語彙をサイドカーへ持ち込まない
- **本メモ §2 の 4 つ組との対応**: 対象 = (`src`, `sourceT`, `sourceRange`, `targetKind`,
  `region`, `strokes`, `refs`, `insertPosition`) の束、意図 = `intent`、本文 = `text`
  （改名しない）、参照 = `refs`

## 6. よくある間違い

- **`target` と `targetKind` を混同する** — `target` は旧・実質未使用フィールド（§5）。
  対象分類は `targetKind`
- **`region.box` / `strokes` を出力（合成後）フレーム座標で書く** — 誤り。source フレーム
  基準（§2）。キャプチャ UI は表示座標から **crop 変換の逆写像**を通してから永続化する
  こと（crop が効いたプレビュー上の描画をそのまま保存すると腐る）
- **`timelineT` に値を書く** — 誤り。timeline 位置は表示のたびに `cuts[]` から射影する
- **`intent` を閉じた enum として検証する** — 誤り。自由文字列 + 推奨語彙（§3）
- **`refs[].src` が edit.json v0（単一 source）でも解決されると期待する** — `src` 参照の
  整合検査は edit.json v1 のときのみ（captions の `src` と同じ扱い）
- **`sourceRange` の end を含む区間だと誤解する** — `[start, end)`（`cuts[].in/out` と同じ）

## 7. マイグレーション

（空欄 — `version` bump は発生していない。bump する場合はここに旧→新の機械実行可能な
変換手順を必ず併記する。`contract-2026-07-17` 原則 2）

## 8. 検証責務

| 層 | 実体 | 責務 |
|---|---|---|
| 参照文書 | `packages/schemas/review.schema.json` | 形の SSOT（`additionalProperties: true` の寛容リーダー） |
| 単一ファイル検査 | `packages/schemas/bin/validate-review.mjs` | 構造・値域・id 一意性。targetKind 整合は warning（stderr）で exit code に影響しない |
| 横断検査 | `packages/edit-lint`（`validateReview`） | `src` / `refs[].src` の edit.json v1 参照整合、insert アンカー解決、`refs[].path` 実在、fixtures = 実行可能仕様 |
| アプリ読み書き | `annotation-store.ts` | 寛容パース（劣化規約 §4）と行単位手術書き込み。version ガード |

validate-review と edit-lint の検査重複は意図的（validate-edit / edit-lint の既存関係と
同じ。単体はスキーマ隣接の速い門番、edit-lint はプロジェクト横断の門番）。

## 9. 次段（本契約のスコープ外）

- キャプチャ UI: 矩形描画・フリーハンドペン・音声同時注釈・asset picker（本契約の
  フィールドを埋める側。逆写像の注意は §6）
- `poses` の有効化（実演キャプチャ — 別機能）
- 旧 `target` フィールドの整理（bump を伴うため独立判断）
- `.akari/events` の `annotation-created` イベントへの targetKind メタデータ付与
- 応答 3 チャネル（decisions.json / review.json / git diff）との関係整理の深掘り
  （`response` フィールドの現行挙動は変更していない）
