# 画面 FX 小語彙 v0 契約（noise / particles / vignette / flare / color-overlay）

- 日付: 2026-08-05
- 状態: **draft**（実装と並走で approved 化）。本書は技術仕様のみ
- 前提: `contract-2026-07-22-render-basics.md`（`output.look` LUT・`cuts[].transition_out` 等の
  実装契約・検証の流儀の前例）、`contract-2026-07-17-data-contract-versioning.md`（三原則）
- 大原則: **done = 出力ファイルに現れる**。全項目、実レンダリング出力の機械検証を受け入れ条件
  とする（仕様先行・バックエンドの silent drop を許さない）

## 0. スコープ宣言

本契約は**新規に実装した画面 FX 小語彙 5 個だけ**を対象とする。旧実装（参照実装リポ）にある
FX 479 個の移植は行わない。479 個の移植は別途中止裁定が下っており、本契約はその裁定の再訪
ではない — 需要（演出レシピが単体で成立する 4 種: ノイズ・粒子・ビネット・フレア）から見て
必要な最小語彙だけを新規に書き起こしたものである。

## 1. スコープ（presets/fx/ 参照表 + 5 id）

`presets/fx/`（`presets/luts/` と同じ参照表方式: `index.jsonl`）に 5 id を収める。LUT と違い
実体ファイル（`.cube` 相当）は持たず、`id` は `packages/render-cut/src/fx.mjs` の
`FX_BUILDERS` ディスパッチ表と 1:1 対応する（実装はコードそのもの）。

| id | 機能 | 実装経路 | ツマミ |
|---|---|---|---|
| `noise` | 映像ノイズ・劣化感 | ffmpeg `noise` フィルタ直結（`all_flags=u+t` で時間変化するノイズ） | `intensity` |
| `particles` | 漂う粒子・ちり | procedural（黒キャンバス上に `geq` で複数の輝点を手続き描画し `screen` 合成） | `intensity` |
| `vignette` | 周辺減光 | ffmpeg `vignette` フィルタ（`white` 指定時は `negate,vignette,negate` の反転トリック） | `intensity` / `params.color`（`black`\|`white`、既定 `black`） |
| `flare` | 光のフレア・強調 | procedural（`particles` と同じ経路。輝点 1 個・大径・低速周回） | `intensity` |
| `color-overlay` | 画面全体への色被せ（フェード赤・カラーマット黒相当を 1 id でカバー） | ffmpeg `color=` ソース + `blend` | `intensity` / `params.color`（必須） |

## 2. edit.json 拡張（追記のみ）

```
cuts[].fx: [{ id, intensity?, params? }]
```

- `id`: 上表 5 値の enum（`packages/schemas/edit.schema.json` `$defs/cutFx`）
- `intensity`: `number` `[0, 1]`。省略時 1（フル効果）。**0 は全 id 共通で恒等**
  （FX 無し出力と画素等価。builder の実装に関わらず render 側が一律に no-op 化する）
- `params.color`: `vignette` は `"black"` / `"white"`（既定 `black`）。`color-overlay` は
  ffmpeg の color 表記（`"red"` / `"#ff0000"` / `"0xff0000"` 等）で **必須**
  （色指定なしに意味を持たないため）。`noise` / `particles` / `flare` は `params` を使わない
- 配列は**複数重ね掛け可・配列順 = 適用順**（`cuts[].transform` 等と同じ「cuts 単位の追加宣言」
  という語彙上の扱い）
- 既存フィールドの意味変更はしていない。`cuts[].fx` 省略時は今日と完全に同じ出力
  （非回帰: `fx` を持つカットが 1 つも無い場合、フィルタグラフの文字列は変更前と byte-for-byte
  一致する）

## 3. 実装

- `packages/render-cut/src/fx.mjs`: 5 id のフィルタグラフビルダーと `appendCutFxChain`
  （複数 fx の重ね掛けを配列順に連結し、`intensity<=0` を一律 `null`（恒等）にする共通処理）
- `packages/render-cut/src/plan.mjs`: `cuts[].transform` と同じ「cut 単位の追加処理」として
  3 つのカット結合経路（`buildCutCommand` / `buildMultiSourceCutCommand` /
  `buildGapAwareCutCommand`）すべてに配線。`fx` を持つカットが 1 つでもあれば、その配列
  全体が per-cut フル WxH フレーム経路（`transform` と同じ扱い）に載る
- 決定論: `noise` の `all_seed` と `particles` / `flare` の輝点の動きは、カット位置・
  fx スタック段・fx id から導いた固定ハッシュ/式のみで決まる。`Math.random` /
  `Date.now` はレンダ経路のどこにも使わない

## 4. 検証（受け入れ条件）

- L0: 既存 + 新規テストが緑（`node --test packages/render-cut/test/*.test.mjs`）・
  `presets/fx/index.jsonl` が自己記述（id・kind・name・description・when_to_use・tags・
  params・ai_usage・source を全エントリが持つ）かつ `fx.mjs` の `FX_IDS` /
  `edit.schema.json` の `$defs/cutFx.properties.id.enum` と id 集合が完全一致・
  `node --check` 全対象ファイル緑
- L1: フィクスチャ動画の実レンダで FX ごとの特徴を実測（`packages/render-cut/test/cut-fx.test.mjs`）
  - 全 id 共通: `intensity=0` で FX 無し出力と画素等価 / 同一 `edit.json` の 2 回レンダが
    画素等価（決定論）
  - `noise`: FX 有無の同一フレーム画素差分 > 0 かつフレーム間分散が増加
  - `vignette`: 四隅の輝度の中心比が、黒指定（既定）で低下・白指定で上昇
  - `color-overlay`: フレーム平均色の指定色までの距離が intensity に対して単調減少
  - `particles` / `flare`: FX 有無の画素差分 > 0 かつ時間方向に変化がある（静止画でない）
  - LUT との併用 1 ケース（白黒 LUT + noise）が render-cut CLI の実パイプラインを通して
    破綻しない

## 5. 除外・既知の残作業

- `packages/edit-lint`（`packages/schemas/bin/validate-edit.mjs` とは別の、公開リポ内の
  もう一つの edit.json 静的検証ツール）には本契約時点で `cuts[].fx` 専用の意味検証を追加して
  いない。`additionalProperties` を拒否しない既存の緩さにより非破壊ではあるが、`transform` /
  `transition_out` と同水準の検証（未知キー拒否・id enum 検証等）は未整備
- `presets/INDEX.md`（親リポジトリの棚卸し索引）に `presets/fx/` へのリンクを追加していない
- FX 479 個の移植は本契約の対象外のまま（§0 参照）
