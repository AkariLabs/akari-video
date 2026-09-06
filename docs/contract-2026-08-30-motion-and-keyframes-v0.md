---
lifecycle: accepted
created: 2026-08-30
updated: 2026-08-30
---

# 動きとキーフレーム契約 v0 — 4 段階（プリセット / キーフレーム / アニメーター / コード）と `motion/` 袋

- 日付: 2026-08-30
- 状態: **v0（オーナー裁定済み 2026-08-29〜30・実装未）**。実装タスクで判明した齟齬は追記で解消する
- 前提:
  - `contract-2026-08-30-edit-json-v2-object-tree-v0.md`（木・袋・部品。本契約はそのアイテムに「動き」を足す）
  - `contract-2026-07-22-render-basics.md` §4-4 / `packages/schemas/edit.schema.json` の `layerKeyframe` / `keyframeV2`（既存のキーフレーム意味論）
  - `contract-2026-08-09-transform-keyframes-v0.md`（v0 の意味論。本日**復元**。本契約 §2 が後継）
  - `contract-2026-07-25-project-structure-v0.md`（`motion/` を本日追記）
- スコープ: edit.json v2 アイテムの動きの置き場と形式（L0〜L3）、`motion/<group-id>.json` 袋、L2 アニメーターのデータ模型、「キーフレームに展開」、タイムライン / インスペクター表示の**規則**（UI の実装は別契約）
- 設計の正本（非公開）: 内部リポ `akari-video-internal` の判断メモ「オブジェクトツリー / タイムライン / インスペクター設計ラウンド（2026-08-29）」§6.9〜6.15。
  Theatre.js / Lottie / Diffusion Studio / HyperFrames Studio は**設計参照のみ・コード移植なし**（Theatre.js studio は AGPL-3.0）

## 0. 位置づけ — 動きは 4 段階に分かれ、粒度は名札の粒度

| 段階 | 何か | どこに書く | タイムライン表示 | 誰が使う |
|---|---|---|---|---|
| **L0 プリセット** | 入り / 抜き / ループ + ツマミ | アイテムの `motion`（native）/ HTML 部品は `vars`（knobs・既存）| 帯の両端に小さな入り / 抜きの印。ダイヤは出さない | 9 割の案件・AI の既定 |
| **L1 キーフレーム** | プロパティの時間変化（位置 / 拡縮 / 回転 / 不透明度 / クロップ / パース）| アイテムの `keyframes`（inline ≤ 8 点）or `motion/<group-id>.json` 袋 | 畳んだ帯の下辺にダイヤ → 展開でプロパティ行 | AE 的に作り込む人（フォーカスモード）|
| **L2 アニメーター** | 文字 / 単語 / 行 / 文節ごとのずらし（範囲セレクタ + 量）| アイテムの `animator[]`（パラメータ数個）+ offset のキーフレームは袋 | offset のダイヤだけ（数個）。文字ごとの行は出ない | テロップ・字幕の演出 |
| **L3 コード** | 断片内の CSS / GSAP アニメ | HTML の中（逃げ道）| 帯だけ（中は不透明）| AI / 上級者 |

- **粒度 = 名札の粒度**。部品の中の一部だけ別に動かしたいなら、名札を細かく付けて（文節を部品にして）出す → L1 が効く。エディタ側に第 3 の粒度は作らない
- **文字ごとのキーフレームはデータとして持たない**（100 文字 × 5 プロパティ × 3 点 = 1,500 個 / 文字を直すと全部ずれる / AI が扱えない）。文字単位の動きは L2 で表す

## 1. L0 プリセット `motion`

```jsonc
{ "id": "h-title", "at": 0, "duration": 90, "source": { "kind": "telop", "preset": "ref3_title", "params": { "text": "…" } },
  "motion": { "in": { "preset": "slide-up", "duration": 12, "ease": "out-cubic", "amount": 40 },
              "out": { "preset": "fade", "duration": 8 },
              "loop": { "preset": "float", "period": 90, "amount": 6 } } }
```

- `in` / `out` / `loop` の 3 席。`preset`（文字列 id）+ `duration`（整数フレーム。`loop` は `period`）+ 任意 `ease`（§2.2 の語彙）+ 任意 `amount`（プリセットごとの単位。px / % / deg）
- 初期語彙（`in` / `out`）: `fade` `slide-up` `slide-down` `slide-left` `slide-right` `scale` `wipe`。`loop`: `pulse` `float` `spin`。未知の id は lint warning（描画は無視）。語彙の追加は本契約への追記で行う
- `in` と `out` の合計が `duration` を超えたら lint error
- HTML 部品の L0 は既存どおり `vars`（CSS 変数 `--anim-duration / stagger / distance / easing / delay`）。`motion` は native アイテム（telop / media / caption / group）用
- グループの `motion` は子全体にかかる（グループ = 小さなコンポジション）

- **実装状態（2026-09-06）**: frame-engine の layer / cut 評価で `motion` を描画する。シェルプレビュー / gpu / osr の 3 出口で同じ評価を使う
- `amount` の既定値は次表。`scale` / `pulse` は倍率に対する差分（0.2 = 20%）、`spin` は回転方向（±1）

| プリセット | `amount` の既定値 |
|---|---|
| `slide-up` / `slide-down` / `slide-left` / `slide-right` | 40 px |
| `scale` | 0.2 |
| `pulse` | 0.05 |
| `float` | 6 px |
| `spin` | 1（回転方向）|

- 合成は **keyframes の結果（未指定なら静的値）に motion を合成する 1 段**。`in` / `out` / `loop` の `dx` / `dy` / `rotate` は加算、`scale` と `opacity` は乗算、`reveal`（wipe）は交差
- `wipe` は crop 窓の中の表示率 `reveal` で表し、隠れた部分は完全透過。閉じた端点でも crop の幅・高さは `Number.EPSILON` 以上を保ち、opacity 0 で完全透過にする
- `duration` / `period` が 0 以下・非有限、または未知 preset の席は描画で無視する。未知 preset は席ごとに lint warning `motion.unknown-preset`（path は `.motion.in` / `.motion.out` / `.motion.loop`）

## 2. L1 キーフレーム — `keyframes` の一般化

### 2.1 形（1 つだけ: 点形）

既存 `keyframeV2`（点ごとに任意プロパティ・`t` はアイテム相対の整数フレーム）を**唯一の形**として保ち、次を足す:

```jsonc
"keyframes": [
  { "t": 0,  "transform": { "x": -200 }, "opacity": 0 },
  { "t": 12, "transform": { "x": 0 },    "opacity": 1, "easing": "out-cubic" },
  { "t": 78, "transform": { "x": 0 } },
  { "t": 90, "transform": { "x": 200 },  "opacity": 0, "easing": { "transform": "in-cubic", "opacity": "linear" } }
]
```

- (a) **`opacity`** をキーフレーム可能プロパティに足す（既存: `transform` / `crop` / `perspective`）
- (b) **`easing` の語彙を拡張**: `linear` / `ease-in-out`（既存）に加え、プリセット名（`in-quad` `out-quad` `in-out-quad` `in-cubic` `out-cubic` `in-out-cubic` `in-quart` `out-quart` `in-out-quart` `in-expo` `out-expo` `in-out-expo` `in-back` `out-back` `in-out-back` `out-bounce` `out-elastic`）/ `cubic-bezier(x1,y1,x2,y2)` / `hold`（その点まで前の値を保持して瞬時に切り替え）。**区間ごと**（その点へ入る区間）。先頭点の easing は無視
- (c) `easing` は文字列（その点の全プロパティ）**または** `{ "<prop>": "<easing>" }`（プロパティごと）。プロパティ行（§7）の区間 easing はこれで表す
- 補間・hold・静的値へのフォールバックは v0 の意味論のまま（復元契約 §1）。`minItems: 2`・`t` 昇順・重複禁止も既存のまま
- アニメーターのセレクタを動かす点は `"animator": { "<animator-id>": { "offset": 0.4 } }` を持てる（§4.3）

### 2.2 inline か袋か

```jsonc
"keyframes": { "path": "motion/g-hook.json", "count": 14 }
```

- **点が 8 個以下なら inline 可、9 個以上は袋**（`motion/<group-id>.json`・§3）。振り分けは edit-store が保存時に行う（書き手は配列で渡してよい）。しきい値は正規直列化の規則の一部（1 レコード 1 行を保つため）
- 参照形は `path`（プロジェクト相対）+ `count`（袋の中のその item の点数。lint が突き合わせる）。読み込み層は参照を解決して inline と同じ配列を消費者へ渡す（消費者は形を区別しない）
- `<group-id>` = そのアイテムが属する**最も近いグループ**の id（段直下のアイテムは自分の id）。フォーカスモードの単位 = 袋の単位

media item（cuts）での適用先 = frame-engine base 経路（2026-09-01・issue #39）: edit-store が cut へ投影した `crop` /
`keyframes[]`（`transform` / `crop` / `opacity`）を GPU / OSR 書き出しが layer-style の幾何で評価する。`perspective` は未適用で warning。

## 3. `motion/<group-id>.json` 袋

```jsonc
{
  "version": 0,
  "group": "g-hook",
  "items": {
    "h-title": [
      { "t": 0, "transform": { "x": -200 }, "opacity": 0 },
      { "t": 12, "transform": { "x": 0 }, "opacity": 1, "easing": "out-cubic" }
    ],
    "h-logo": [
      { "t": 0, "transform": { "scale": 0.8 } },
      { "t": 18, "transform": { "scale": 1 }, "easing": "out-back" }
    ]
  }
}
```

- 1 ファイル = 1 グループ（子アイテムの分をまとめて持つ）。`items` のキー = アイテム id・値 = §2.1 の点形配列（**edit.json の inline と同じ形**）
- 直列化: 1 キーフレーム 1 行（姉妹契約 §5.1）。`t` 昇順
- `motion/` は**プロジェクト直下の正本ディレクトリ**（再生成不可。`.akari/cache/` ではない）。`contract-2026-07-25-project-structure-v0.md` §8（本日追記）
- 保存・undo は edit-store が edit.json と同じトランザクションで扱う（captions.json と同方式）。edit.json 側の `count` は保存時に edit-store が更新する
- グループを ungroup / 削除したら袋は孤児になる → lint warning `motion.orphan`（自動削除はしない）

## 4. L2 アニメーター `animator[]`

### 4.1 データ模型（範囲セレクタ + 量）

```jsonc
"animator": [
  { "id": "a1", "basis": "chars", "shape": "ramp", "start": 0, "end": 0.25, "offset": -0.25,
    "amount": { "y": 24, "opacity": -1, "blur": 4 }, "ease": "out-cubic" }
]
```

| キー | 型 | 意味 |
|---|---|---|
| `id` | string | アニメーターの id（キーフレームから参照）|
| `basis` | `chars` / `words` / `lines` / `segments` | 範囲の単位（`segments` = 文節。既存のテロップ文節分割を使う）|
| `shape` | `ramp` / `triangle` / `round` / `smooth` / `square` / `ramp-down` | 範囲の中の影響度カーブ（0..1）|
| `start` / `end` | number 0..1 | 範囲（単位数に対する比）|
| `offset` | number | 範囲の平行移動（−1..1）。**動かすのはこれ**（§4.3）|
| `randomize` | `{ "seed": integer }` | 単位の順序をシャッフル。**固定シードを保存**（同じ入力で同じ絵）|
| `amount` | object | 影響度 1 のときの量: `x` `y` `scale` `rotate` `opacity`（加算・−1..1）`letterSpacing`（px）`blur`（px）|
| `ease` | easing | 影響度 0→1 の補間（§2.1-(b) の語彙）|

- 各単位 u の影響度 `w(u) = shape(pos(u), start + offset, end + offset)`、適用量 = `amount × ease(w)`。複数アニメーターは**加算**（`scale` は乗算・`opacity` は加算後 0..1 にクランプ）
- 対象は `telop` / `caption`（分離した行）/ `group` の中のテキスト系アイテム。HTML 部品は L3 か `vars`
- 既存モーション文法との対応: `--anim-stagger` ≈ `offset` をキーフレームで動かす / `--anim-distance` ≈ `amount.y` / `--anim-easing` ≈ `ease`。既存 CSS 変数はそのまま生きる（L0）。アニメーターは native アイテムの L2

### 4.2 合成

- 同じプロパティに複数のアニメーターが効くときは §4.1 の加算規則。アニメーターと L1 キーフレームは**独立に合成**（L1 = アイテム全体、L2 = 単位ごとのずれ）

### 4.3 offset のキーフレーム

- 「どの順で」は `offset` を時間で動かして表す。点は L1 と同じ配列（inline or 袋）に `"animator": { "a1": { "offset": -0.25 } }` … `{ "offset": 1 }` として打つ（典型 2 点）。**文字ごとの点は存在しない**

## 5. 「キーフレームに展開」（L0 / L2 → L1・一方通行）

- L0 プリセット・L2 アニメーターを、対応する L1 の点列に**焼き込む**操作。プリセットで 9 割済ませ、最後の 1 割だけ展開して手で直す
- 展開後は元の `motion` / `animator` を消す（二重管理しない）。逆変換は無い（⌘Z のみ）
- L2 の展開は**単位ごとの部品化**を伴う（名札を文字 / 文節に付けた部品アイテムを生やし、各部品に点列を持たせる）。件数が爆発するので、UI は確認を挟む（規則: 生成される点が 200 を超えるとき）

## 6. 復元 — `contract-2026-08-09-transform-keyframes-v0.md`

- 同名の契約は 10 箇所（`edit.schema.json` の `$comment` ×2 / `validate-edit.mjs` / render-cut ×3 / preview-server / akari-preview ×3）から参照されているが**実ファイルが存在しなかった**（どのブランチにも履歴が無い）
- 本日、`edit.schema.json` の `$comment`（`layerKeyframe` / `layerItem`）に残っていた意味論からファイルを**復元**した。内容は v0 の意味論だけ。**本契約 §2 が後継**で、復元ファイルは参照の穴を塞ぐためのもの

## 7. タイムライン / インスペクター表示の規則（UI の実装は別契約）

- L0: 帯の両端に小さな入り / 抜きの印（トランジション風）。ダイヤは出さない。ループは帯の中央に印
- L1: 畳んだ帯の**下辺にダイヤ**（プロパティ混在）。アイテムを展開すると**プロパティ行**（transform.x / y / scale / rotate / opacity / crop / perspective）に分かれ、行ごとにダイヤ。両端は白抜き・間は塗り
- 集約ダイヤ（親行）: 子の全部が同じ t に点を持てば**塗り**、一部なら**くり抜き**。ドラッグで下の点をまとめて動かす
- インスペクターの各プロパティ横にダイヤ（打つ / 消す / 前後へ）+ 区間 easing（プリセット + ベジェ曲線・ホバーで即プレビュー）
- **フォーカスモード** = 同じタイムライン領域の**スコープ切替**（ポップアップ・別ウィンドウにしない）。ダブルクリック = 「中に入る」で統一: グループ / 部品 → フォーカス（部分木 + プロパティ行・時間軸はその span に自動ズーム・プレビューはその範囲をループ）、動画クリップ → ソースビュー（= 現行のソーストリマー）。パンくず + Esc で 1 段戻る。左の素材パネルは変わらない
- L2: タイムラインには offset のダイヤだけ。インスペクターに「アニメーター」節（basis / shape / start / end / offset / randomize / amount）

## 8. 非スコープ

- 文字ごとのキーフレーム（§0）
- キーフレームごとにハンドルを分散保存する形式（うちは区間ごとの easing）
- 非決定的な Randomize（固定シード必須）
- 終端値の二重管理（終端値 = 次の点の値のみ）
- モーションパス・3D 回転・音量のキーフレーム（別契約）
