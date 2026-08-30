---
lifecycle: accepted
created: 2026-08-30
updated: 2026-08-30
---

# edit.json v2 オブジェクトツリー契約 v0 — 木は edit.json だけが持つ・中身は袋・人間は JSON を触らない

- 日付: 2026-08-30
- 状態: **v0（オーナー裁定済み 2026-08-29〜30・実装未）**。実装タスクで判明した齟齬は追記で解消する
- 前提:
  - `contract-2026-07-17-data-contract-versioning.md`（版必須・追加のみ進化。**本契約は `version: 2` を据え置く**）
  - `packages/schemas/edit.schema.json` の `editV2` / `itemV2` / `trackV2`（v2 の現行形。08-18 の 5 段〔schema → 内部モデル → 描画 → 書き込み / 移行 → 語彙〕は合流済み）
  - `contract-2026-08-02-preview-parity.md`（プレビュー / osr / gpu の 3 出口で同じ絵）
  - `contract-2026-07-25-project-structure-v0.md`（プロジェクト直下の正本ファイル。`motion/` を本日追記）
  - `contract-2026-07-22-render-basics.md` §4-4（`keyframes` の既存意味論）
- スコープ: edit.json v2 の**木の再帰（グループ）・袋（HTML / captions.json / motion/）からの写し・部品アイテム・段の不変条件・保存形式・読み書き規約・edit-store のスクリプト API**。UI（タイムラインの木行・インスペクター・フォーカスモード）は別契約
- 姉妹契約: `contract-2026-08-30-motion-and-keyframes-v0.md`（動きの 4 段階・`motion/` 袋・L2 アニメーター）
- 設計の正本（非公開）: 内部リポ `akari-video-internal` の判断メモ「オブジェクトツリー / タイムライン / インスペクター設計ラウンド（2026-08-29）」。
  他エディタ（Diffusion Studio・HyperFrames Studio・Theatre.js・Lottie）は**設計参照のみ・コード移植なし**

## 0. 位置づけ — 一言で言い切る

**正本は edit.json。木（段 → アイテム → アイテム…）は edit.json だけが持ち、量が出る中身は袋に置く。人間は JSON を触らない。**

- 木 = `tracks[]`（段）→ `items[]`（アイテム）→ `items[]`（子）… **アイテムは再帰**する。グループの入れ子・順序・時間は全部 edit.json
- 袋 = HTML 断片 / `captions.json` / `motion/<group-id>.json`。袋の中身（部品・字幕行・キーフレーム曲線）は edit.json に**書かない**。
  edit.json には**判断に要る情報だけ**（構造・時間・変形の静的値・プリセット・参照 + 件数）を載せる。既存の作り（HTML 断片・captions.json・analysis.json が外にあり edit.json は参照するだけ）と同じ規則の一般化
- **人間は JSON を一切触らない**。AI が読み書きし、人間はツマミと UI だけを触る。書式は AI の grep / Edit と git diff のためだけに決める（§5）
- 素材ファイル（HTML / captions.json / 3D）は編集操作で**書き換えない**。分離・グループ化・時間ずらしは木の操作であって袋の操作ではない

## 1. データ模型（`version: 2` のまま追加のみ）

**新しいサブスキーマはここに列挙した以外増やさない。** 部品も字幕行もグループも「普通のアイテム」で、共通フィールド（`id` / `at` / `duration` / `transform` / `opacity` / `blend` / `crop` / `perspective` / `keyframes`）をそのまま使う。

### 1.1 再帰 — アイテムは `items[]` を持てる

```jsonc
{ "id": "g-hook", "name": "フック", "at": 0, "duration": 90,
  "source": { "kind": "group" },
  "items": [
    { "id": "h-title", "at": 0,  "duration": 90, "source": { "kind": "telop", "preset": "ref3_title", "params": { "text": "…" } } },
    { "id": "h-logo",  "at": 12, "duration": 78, "source": { "kind": "html", "path": "overlays/logo.html" } }
  ] }
```

- 全アイテムに任意 `items: itemV2[]`。**子の `at` は親相対の整数フレーム**（親の `at` を 0 とする）。子は親の `[0, duration)` に収まる（lint error）
- 子の変形・不透明度は親のものと**合成**される（親の transform を適用した座標系の中に子が置かれる。`opacity` は乗算）
- **`items[]` の順 = z 順（後ろが手前）**。グループの子は 1 つずつが独立した「行」で、子同士の時間重なりに制約は無い（段の不変条件 §2 は**最上段の `tracks[]` にだけ**かかる。木の形は最上段の入れ物を「段」と呼ぶ点だけが違う）
- 深さに上限は設けない（lint は循環と自己参照を弾く。JSON なので構造上は起きない）

### 1.2 純グループ `source.kind: "group"`

- 中身の無い入れ物。`name` 任意。自身も `at` / `duration` / `transform` / `opacity` / `blend` / `keyframes` / `motion` を持つ（= 小さなコンポジション）
- 「まとめる」（§3.2）が作るのはこれ。変形を持たないグループで包む → 座標・時間は不変

### 1.3 袋グループ — `html` / `captions` のアイテムに `items[]` を持たせたもの

**袋 = 名札つき部品の入れ物**。HTML 断片の名札は `data-akari-part="<id>"`、`captions.json` の名札は行 `id`。将来の 3D（glTF ノード名）/ Lottie（レイヤー名）も同じ形で足す（本契約では未定義・語彙予約のみ）。

```jsonc
// HTML 袋（取り込み時点で常にこの形。折りたたみは UI の表示状態であってデータではない）
{ "id": "s01", "name": "オープニング", "at": 0, "duration": 120,
  "source": { "kind": "html", "path": "overlays/s01.html", "exclude": ["C"] },
  "items": [
    { "id": "s01.B", "at": 6, "duration": 114, "transform": { "y": -40 },
      "source": { "kind": "html", "path": "overlays/s01.html", "part": "B" } }
  ] }
```

- **見える子 = 袋の名札から写す（projection）**。edit.json には書かない。上の例で `s01.html` に部品 A / B / C があれば、A は写し（触っていない・既定の時間 = 袋と同じ）、B は明示（触ったので `items[]` に居る）、C は `exclude`（袋の中では表示しない = 別の場所へ「出した」か、消した）
- **触った子だけ明示アイテムになる**。明示アイテムは袋の子として `items[]` に置くか、木の別の場所に置く（= 分離 §3.1）。どちらでも袋側は `source.exclude` に id を持つ
- **袋の中では並びを変えない・ばらさない**（HTML の DOM 順 / captions.json の行順が正）。変えたい部品は出す
- 名札の無い断片は「袋ごと 1 アイテム」（`part` 無し・`items` 無し）。既存の overlays はこれ（**回帰なし**）
- 名札の読み取り（HTML の走査）は**描画・プレビュー側の仕事**（§4）。edit.json の読み込み層は袋を「子を持ち得るアイテム」として扱うだけ

### 1.4 部品アイテム `source: { kind: "html", path, part }`

- 既存 `itemSourceHtmlV2` に任意キーを 3 つ足す: `part: string`（名札）/ `style: { "<css-prop>": "<value>" }`（部品ルートの inline style。開いた map・lint は CSS 値を検証しない）/ `text: string`（本文の差し替え）
- `vars` / `params`（既存のツマミ経路）は部品アイテムでも使える。`style` / `text` は「設計済みのツマミが無い所を直す」ための逃げ道で、これで HTML を書き換えずに見た目の自由度を持つ
- 部品アイテムの `at` / `duration` / `transform` / `opacity` / `keyframes` は共通フィールド。**部品専用のサブスキーマは無い**

### 1.5 字幕 = 袋グループ（専用トラックの廃止）

```jsonc
{ "id": "captions", "name": "字幕", "at": 0, "duration": 5400,
  "source": { "kind": "captions", "path": "captions.json", "exclude": ["c-0042"] },
  "items": [] }
```

- 字幕は**専用の段ではなくグループ**。HTML 袋と同じ形（袋 = captions.json・子 = 行）。畳める・前後へ動かせる・別グループの中に入れられる・行を「出す」は部品と同じ操作。段は全部無名になる（§2）
- 子（行）の時間は captions.json の**ソース秒**のまま（既存契約）。写しの `at` / `duration` は読み込み層がタイムライン写像で導出する（edit.json に焼かない）
- **行の分離**: `{ "id": "cap-42", "at": 1210, "duration": 48, "transform": { "y": -120 }, "source": { "kind": "caption", "path": "captions.json", "id": "c-0042" } }`。文字・スタイルは captions.json の行が正本のまま、位置と時間だけ木の側で上書きする
- **テロップに変換**: `source: { "kind": "telop", "preset": "…", "params": { "text": "…" }, "from": "captions.json#c-0042" }`。以後は独立したテロップ（`from` は来歴。元の行は `exclude`）
- 同時刻に 2 行あるときの表示（副行）は描画側の規則であってデータではない。編集ミスの重なりは lint warning
- **旧形 `tracks[].content: { from: "captions.json" }` は読める（tolerant reader）が deprecated**。読み込み層は袋グループと同じ内部表現に落とす。書き手（shell / スキル）は袋グループ形を出し、`akari migrate` が旧形を袋グループ形に正規化する。lint は旧形に warning `v2.captions-content-deprecated`

### 1.6 切り出し `source.derivedFrom`

- 分離（§3.1）は台紙 1 枚のまま（クローンマスク §4）。**切り出し**は明示操作で、部品を派生ファイル `overlays/s01.C.html` に書き出し、`source.path` を差し替え、`source.derivedFrom: "overlays/s01.html#C"` を来歴として残す。元 HTML は不変。以後その部品は独立 HTML として自由に書き直せる（元との連動は切れる）

### 1.7 アイテム共通の任意フィールド（追加）

| キー | 型 | 意味 |
|---|---|---|
| `name` | string | 表示名（グループ・袋・任意のアイテム）。無ければ UI が `source` から導出 |
| `hidden` | boolean | 描画しない（プレビュー・書き出しとも。「見えるもの = 出力されるもの」）|
| `locked` | boolean | UI で動かせない。描画には影響しない |
| `items` | itemV2[] | 子（§1.1）|
| `motion` | object | L0 プリセット動き（姉妹契約 §1）|
| `animator` | object[] | L2 アニメーター（姉妹契約 §4）|
| `keyframes` | array **or** `{ path, count }` | L1。inline 配列（既存 `keyframeV2[]`）または `motion/` 袋への参照（姉妹契約 §2-§3）|

- 折りたたみ・選択・フォーカス中のスコープは**表示状態**で、edit.json に保存しない
- `id` は木全体で一意（袋から写した子の id は `<袋 id>.<名札>` を UI が合成する。明示アイテムにした時点でその id が edit.json に書かれる）

## 2. 段（`tracks[]`）の不変条件

| # | 不変条件 | 破ったとき |
|---|---|---|
| 1 | **1 段に 2 つは重ねない** — 同じ段の `items[]` は出力時間 `[at, at+duration)` が互いに重ならない | lint **error**（書き手が守る。edit-store の操作は重なる場所へ置くとき段を生やす）|
| 2 | **重なるなら段が生える** — 重なる位置へ置く操作は、その段の**上**に新しい段を作って置く（隣を削って詰めない）| edit-store の操作規則（データ変換）|
| 3 | **空の段は消える** — `items` が空の段は保存時に削除し、番号を下から V1, V2, … と詰め直す（表示名は無名。`name` は任意の注記に過ぎない）| edit-store が保存時に正規化 |
| 4 | **上の段ほど手前** — `tracks[]` 配列順 = 下から上 = z 順（既存 v2 裁定）。グループ内は `items[]` 順 = z 順で同じ | 描画規則（既存）|

- 段は無名（V1..Vn は表示上の番号）。`lane`（visual / audio）は既存のまま
- 分離（§3.1）は不変条件 1 の帰結として**必ず新しい段を生やす**（同じ段に重ねられないため）。戻せば（⌘Z）段は消える
- 音声段も同じ 4 条件に従う（既存の重なり禁止と同じ）

## 3. 操作の意味論（データ変換として定義。UI のコマンド・キー割り当ては別契約）

操作は **出す / まとめる / ばらす** の 3 つ + 切り出し・テロップに変換。**「戻す」は無い**（⌘Z のみ。再グループ化は「まとめる」で足りる）。

### 3.1 出す（detach）

- 入力: 子アイテム 1 個（写しでも明示でもよい）と、置き先（段 or 別グループ）
- 変換: (1) 写しなら明示アイテム化（袋の既定値を書き出す）(2) `at` を親相対 → 置き先相対（段なら絶対）に変換。親の `transform` / `opacity` を焼き込む（§3.3 と同じ式）(3) 袋なら袋の `source.exclude` に id を追加 (4) 置き先が段で重なるなら段を生やす（§2-2）
- 出した部品は 1 個のアイテム = 1 個のグループと同等（再度まとめられる）

### 3.2 まとめる（group）

- 入力: 同じ場所（同じ段の上どうし / 同じグループの中どうし）にある複数アイテム。混ざっていたら先に出す（lint / UI が拒む）
- 変換: 変形を持たない `source.kind: "group"` の親で包む。親の `at` = 最小 `at`、`duration` = 最大 `at+duration` − 最小 `at`。子の `at` は親相対に書き換え。**座標・時間・見え方は不変**（変換前後で描画計画が一致することがテスト）
- **離れた段のものをまとめたとき**: 新しいグループは**いちばん手前のメンバーがいた段**に置き、他のメンバーはそこまで上がる（メンバー同士の前後は保つ）。間に挟まっていた別の帯（時間が重なるもの）は上がったメンバーの奥に回る = 見え方が変わる。**やるが「○○ の前後が変わりました」を通知し、⌘Z で戻せる**（通知の実装は UI 契約）
- 入れ子可（グループの中にグループ）。「出した部品 A + 残りの袋」を同時に選んでまとめれば、グループの中にグループになる

### 3.3 ばらす（ungroup）

- 入力: グループ 1 個
- 変換: 親の `at` / `transform` / `opacity` を各子へ**焼き込み**、子を親の場所（段 or 上位グループ）へ出す。焼き込みの式: `at' = parent.at + child.at`、`transform' = compose(parent.transform, child.transform)`（x / y は親の scale・rotate を適用してから加算、scale は乗算、rotate は加算）、`opacity' = parent.opacity × child.opacity`。親の `keyframes` / `motion` / `animator` は**焼き込めない**（lint error にして拒む。先に「キーフレームに展開」してから）
- 出た子は各自の段へ（§2-2 により段が生える）。袋グループは**ばらせない**（袋の中の並びは袋が正。写しの子を全部出したいときは 1 個ずつ出す）

### 3.4 切り出し（§1.6）/ テロップに変換（§1.5）

- どちらも一方通行。元ファイルは不変・来歴（`derivedFrom` / `from`）を残す

## 4. 描画 — クローンマスク

- **部品アイテム 1 つにつき断片全体を 1 回マウント**し、当該 `part` 以外の名札付き要素を `visibility: hidden` にする（`display: none` ではない — レイアウトと CSS の継承を壊さない）。各マウントが自分の時計（アイテム相対時間）・変形・z を持つ
- 袋グループの写しの子（触っていない部品）は、時間・位置が袋と揃っている限り**1 マウントにまとめる**（エンジン側の最適化。データは不変）。`exclude` の部品は `visibility: hidden`
- `source.style` は部品ルート要素の inline style として適用、`source.text` は部品ルートの textContent を差し替える（子要素を持つ部品に `text` を指定したら lint warning・描画は最初のテキストノードだけ差し替え）
- 部品内の CSS / GSAP アニメ（L3）は部品アイテムの時計で seek する（既存の HTML seek 規約のまま）
- **プレビュー / osr / gpu の 3 出口で同じ規則**（`contract-2026-08-02-preview-parity.md`）。「見えるもの = 出力されるもの」
- コスト: 分離した部品の数だけマウントが増える（典型 2〜5 個・現行の overlays 数と同程度）
- 名札の走査は描画側（overlay-runtime / frame-engine の HTML 層）が行う。**edit.json の読み込み層は HTML を読まない**

## 5. 保存形式と読み書き規約

### 5.1 正規直列化（canonical serializer）— edit-store が所有

人間が JSON を触らないので「手書きの整形を保つテキスト手術」は不要になる。**edit-store が唯一の直列化器**を持ち、保存のたびに次の形へ正規化する。edit.json / captions.json / motion/*.json すべて同じ規則。

- **1 レコード 1 行**: アイテム・字幕行・キーフレームは 1 行。配列とオブジェクトの**外枠だけ縦**に開く
- グループ（子を持つアイテム）は「自分のフィールドを 1 行 + `"items": [` + 子を 1 行ずつ（インデント +2）+ `]}`」。**レコード = アイテム自身のフィールド**。各行は `"id"` で始まる
- inline の `keyframes`（≤ 8 点）はアイテムの行に含める。それ以上は袋（姉妹契約 §2-3）に出すので行は長くならない
- キー順（固定）: `id, name, at, duration, hidden, locked, transform, opacity, blend, crop, perspective, motion, animator, keyframes, source, items`。`source` 内は `kind` 先頭・残りは宣言順。トップレベルは `version, output, sources, audio, tracks, …`（未知キーは末尾に保持 — tolerant reader）
- インデント 2 スペース・行内区切りは `, ` と `: `・Unicode は escape しない・末尾改行 1 つ・数値は JS 既定表記

```jsonc
{
  "version": 2,
  "output": { "width": 1920, "height": 1080, "fps": 30 },
  "sources": [
    { "id": "main", "path": "assets/talk.mp4" }
  ],
  "tracks": [
    { "id": "v1", "lane": "visual", "items": [
      { "id": "c1", "at": 0, "duration": 195, "source": { "kind": "media", "src": "main", "in": 12, "out": 18.5 } },
      { "id": "c2", "at": 195, "duration": 210, "source": { "kind": "media", "src": "main", "in": 40, "out": 47 } }
    ] },
    { "id": "v2", "lane": "visual", "items": [
      { "id": "s01", "name": "オープニング", "at": 0, "duration": 120, "source": { "kind": "html", "path": "overlays/s01.html", "exclude": ["C"] }, "items": [
        { "id": "s01.B", "at": 6, "duration": 114, "transform": { "y": -40 }, "source": { "kind": "html", "path": "overlays/s01.html", "part": "B" } }
      ] }
    ] },
    { "id": "v3", "lane": "visual", "items": [
      { "id": "s01.C", "at": 30, "duration": 60, "keyframes": { "path": "motion/s01.json", "count": 14 }, "source": { "kind": "html", "path": "overlays/s01.html", "part": "C" } }
    ] },
    { "id": "v4", "lane": "visual", "items": [
      { "id": "captions", "name": "字幕", "at": 0, "duration": 405, "source": { "kind": "captions", "path": "captions.json", "exclude": [] }, "items": [] }
    ] }
  ]
}
```

- 保存 = **lint ゲート（write-gate）通過時のみ**実ファイルへ（既存）。edit.json・captions.json・motion/*.json は 1 回の保存でまとめて原子的に書く（captions.json で既に同方式）
- 1 レコード 1 行化は**書式の変更だけ**（意味不変）。既存プロジェクトは次の保存で正規形になる（差分が大きく出るのは 1 回だけ）

#### 5.1 追記（2026-08-30・実装タスク A2 の逸脱報告を受けて）

- 例に無いトップレベル（`audio` / `captions` / `thumbnail` 等）の直列化規則: **値のどれかが空でない配列であるオブジェクトは外枠を縦に開き、中身へ同じ規則を再帰適用する。そうでないオブジェクトは 1 行**。
  `output` は 1 行のまま（例どおり）。決定論・冪等はテストで固定する
- 「触ったファイル」= 正規直列化後のバイトが元ファイルと異なるファイル。正規形のプロジェクトを無編集で `save()` すると何も書かない（lint も走らない）。非正規形は無編集でも正規形に書き換わる（「次の保存で正規形になる」の実装）
- 空の段の削除（§2-3）により後続トラックの `orderIndex` は詰まる。これは正規化の帰結で、ffmpeg コマンド列が一致すれば「意味不変」

### 5.2 AI の読み方（スキル規約 — SKILL.md へ反映する）

1. **edit.json / captions.json / motion/*.json を全文 Read しない**。`grep -n '"id": "<id>"'` → 該当行だけ Read → Edit。木の構造を見たいときは `grep -n '"kind": "group"\|"items": \['` のように外枠だけ読む
2. 書き込みは (a) edit-store のスクリプト API（§6）経由、または (b) 該当行の直接 Edit + 保存時 lint（write-gate 相当を CLI で通す）。**どちらでも lint ゲートは必ず通る**
3. 一括操作（「1:00 以降の字幕を 0.5 秒ずらす」等）は**AI がスクリプトを書く**（§6 の API を import）。前もって一括コマンドを用意しない
4. 動きを書くときは L0 プリセット / L2 アニメーターを既定にする（数個の値で済む）。L1 の手打ちキーフレームは主に人間がフォーカスモードで作る
5. **観察・手術のための CLI コマンド（`akari edit tree` / `move` / `group` …）は作らない**（オーナー裁定 2026-08-30。ファイルが API）

## 6. edit-store のスクリプト API（実装タスク A2 の仕様）

`@akari-video/edit-store`（現行 8,044 行・テキスト手術 + lint ゲート）を **AI のスクリプトが import する公開 API** に作り直す。

```ts
import { openProject } from '@akari-video/edit-store';
const p = await openProject('/path/to/project');
p.edit.tracks;                          // 型付き（スキーマから生成した TS 型）
p.captions.rows;                        // captions.json
const m = await p.motion('s01');        // motion/s01.json（無ければ空の袋）
// 直す（普通のオブジェクト操作。id で引く。index 指定は廃止）
const item = p.edit.find('s01.B');
item.at += 15;
for (const row of p.captions.rows) if (row.start >= 60) { row.start += 0.5; row.end += 0.5; }
// 木の操作（不変条件つき: 段が生える・焼き込み）
p.edit.detach('s01.C', { track: 'above' });
p.edit.group(['s01', 's01.C'], { name: 'フック' });
p.edit.ungroup('g-hook');
await p.save();                         // 正規直列化 → lint ゲート → 原子的書き込み（3 ファイルまとめて）
```

- 入口は `openProject(dir)` の 1 つ。`save()` が §5.1 の正規直列化・§2 の正規化（空の段の削除・番号詰め）・lint ゲートを担う
- **id 指定に統一**（v2 は全アイテムに id）。cut / layer の index 指定は廃止
- README（`packages/edit-store/README.md`）+ スクリプト例 2 本（`examples/shift-captions-after.mjs` = 1:00 以降の字幕を 0.5 秒ずらす / `examples/speed-up-group.mjs` = グループの子の尺を半分に）。SKILL.md はこれを参照する
- shell / preview-server も同じ API に乗り換える（テキスト手術は段階的に退役。退役完了までは両方が同じ正規形を出す）

## 7. lint（保存時ゲートに足す不変条件）

| check | severity | 条件 |
|---|---|---|
| `v2.id-unique` | error | 木全体で id 一意（既存を再帰に拡張）|
| `v2.child-in-parent` | error | 子の `[at, at+duration)` が親の `[0, duration)` に収まる |
| `v2.track-no-overlap` | error | 同一段の items が時間で重ならない（既存 → 明文化）|
| `v2.group-bake-blocked` | error | `keyframes` / `motion` / `animator` を持つグループを ungroup しようとした（edit-store の操作時）|
| `v2.part-ref` | warning | `source.part` / `source.exclude` の id が袋に存在するか（**文字列レベル**: HTML は `data-akari-part="…"` の grep、captions は行 id）|
| `v2.captions-content-deprecated` | warning | 旧形 `tracks[].content` を使っている |
| `v2.caption-overlap` | warning | 分離した字幕行と袋の写しが同時刻に重なる |
| `v2.keyframes-ref` | error | `keyframes: { path, count }` の袋が無い / `count` が実数と違う |
| `v2.empty-track` | info | 空の段（保存時に自動削除される旨）|

## 8. 版管理・移行

- **`version: 2` 据え置き**。§1 の追加は全部任意フィールド（版管理契約 原則 1）。既存の v2 プロジェクトは 1 ビットも変わらず読める（実装タスクの受け入れ条件）
- deprecated: `tracks[].content`（§1.5）。`akari migrate` が袋グループ形へ正規化する（意味不変・描画計画一致がテスト）
- 1 レコード 1 行化は書式のみ。migrate は不要（次の保存で正規形）
- v0 / v1 は本契約の対象外（既存の migrate で v2 に上げてから）

## 9. 実装段取り（タスク列・依存）

| # | タスク | 内容 | 依存 |
|---|---|---|---|
| A1 | `v2-object-tree-schema` | スキーマ追加（§1）・読み込み層の再帰（親相対 → 絶対）・lint（§7）・fixtures。**HTML は読まない・描画は触らない** | 本契約 |
| A2 | `edit-store-script-api` | §6 の API・正規直列化（§5.1）・段の正規化（§2）・木の操作 3 つ（§3）・README + 例 | A1 |
| A3 | `object-tree-render` | クローンマスク（§4）を 3 出口（preview / osr / gpu）に・名札の走査・`style` / `text` | A1 |
| A4 | `object-tree-write-and-migrate` | shell / preview-server / スキルの書き込みを A2 の API へ・`content` → 袋グループの migrate・1 レコード 1 行での保存 | A2, A3 |
| D | タイムライン木行 | 折りたたみ / D&D 再親化 / ⌘G ⌘⇧G / 段の自動生成・消滅（UI 契約） | A2 |
| F | 字幕 = 袋グループ（UI） | 専用段の廃止・畳んだ帯の刻み表示・行を出す / テロップに変換 | D, A3 |
| H | フォーカスモード | 姉妹契約 §7 | D + 姉妹契約 |
| I | SKILL.md 読み方規約 | §5.2 を edit-plan / address-review / analyze-project へ | A2 |

- 各段で**既存プロジェクト（fieldtest の v2 実案件）の描画計画・出力バイトが等価**であることを回帰で担保する（08-18 の 5 段と同じ物差し）

## 10. 非スコープ / 後回し

- タイムラインの帯の canvas 化（D の後に描画側の性能を測ってから別票。オーナー裁定 2026-08-30）
- 3D（glTF ノード名）/ Lottie（レイヤー名）/ 音を袋グループに入れること（語彙予約のみ）
- 観察・手術の CLI コマンド（作らない。§5.2-5）
- 種類ごとに違うグループ（sequence / scene 等）— 「段」と「グループ」の 2 つだけ
- 文字ごとのキーフレーム（姉妹契約 §8）
