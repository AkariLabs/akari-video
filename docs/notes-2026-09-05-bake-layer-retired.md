# bake-layer / ATF テロップ描画の退役

更新日: 2026-09-05

## 1. 位置づけ

ATF（テロップテンプレート）をヘッドレスブラウザで焼く道具一式を出荷物から撤去した記録である。
既存の `edit.json` を読めなくする変更ではない。`kind:"telop"` は schema に残し、**すでに焼いた
`baked` を持つ項目はそのまま再生できる**。新規に ATF を焼く経路だけが無くなった。

退役の理由は 2 つある。

- ATF ランタイム（vendor 一式）と 36 種の `template.json` を維持する費用に対して、実際の制作は
  オーバーレイ HTML 側へ寄っていた。文字演出の正典は HTML 素材（Lab 配布）に一本化する
- 焼くために `puppeteer` をパッケージ版へ同梱していた。ブラウザバイナリの同梱は配布サイズ・
  `postinstall` の承認（`allowScripts` / CI の `approve-scripts`）・プラットフォーム検証の
  すべてに効いており、退役でこの 3 つが同時に消える

## 2. 消したもの

| 対象 | 内容 |
|---|---|
| `packages/bake-layer/` | 丸ごと（`vendor/telop/` の ATF ランタイム・codemod / port スクリプト・test 一式） |
| `packages/template-render/` | 丸ごと。`puppeteer-core` に依存していたが、呼び出し元は自パッケージの test だけで死蔵していた |
| `presets/telop/` | ATF `template.json` 36 種 + `index.jsonl` + `INDEX.md` |
| `apps/shell/package.json` | `build.extraResources` の `bake-layer` / `presets/telop`、`allowScripts` の `puppeteer@25.1.0` |
| `bundled-cli-npm-entries.mjs` | `BUNDLED_CLI_NPM_ENTRIES` から `puppeteer` / `esbuild`（残りは `@webav/mp4box.js` 1 本） |
| `.github/workflows/{release,windows-build}.yml` | `approve-scripts` から `puppeteer` |
| `akari-preview`（shell） | `rasterizeTelopPreview` の bake-layer spawn 本体・入口探索・`runProcess`・`nodeCliCommand` |
| `render-cut` | `BAKE_LAYER_ENTRY`・telop ラスタコマンド生成（`plan.commands.telops`）・`presets/telop/**/template.json` の入力列挙 |
| `akari-project` | 素材棚の `telop` 種別。**`textstyle` / `textanim` / `lut` の棚は不変** |
| `scripts/ci/run-unit-tests.mjs` | `pure` レーンから `template-render`、`media` レーンから `bake-layer` |

**残した機構**: `resources/cli-node-modules` への staging は撤去しない。`@webav/mp4box.js` が
`gpu-export` の実行時 import で要るため（v0.1.25 で同梱漏れ → パッケージ版の `--engine gpu` が
落ちた実績がある）。入口リストから `puppeteer` / `esbuild` を外しただけである。
`esbuild` も残す — apps/shell の Theia build・`bundle-frame-engine.mjs`・drift 検査・各パッケージの
build script が使うので、`allowScripts` と CI の `approve-scripts` は据え置く（build 時専用であり
CLI の実行時 import ではない、が線引き）。

## 3. `kind:"telop"` の扱い（後方互換）

`packages/schemas/edit.schema.json` の `itemSourceTelopV2` は**無変更**。`baked` の有無で分岐する。

| 層 | `baked` 無し（未焼成） | `baked` 有り |
|---|---|---|
| schema | 通る（構造は不変） | 通る |
| `edit-lint` | **error `telop.retired`** | 通る |
| `render-cut` | `--force` で lint を迂回されても `renderItemDeclaration` が明示 throw（`telop.retired: <id>: …`）。黙って空描画にしない | 従来どおり `kind:"baked"` レイヤーへ写る |
| プレビュー（shell） | 既存のプレースホルダ機構で退役カードを表示（`retiredTelop: true` / `data-akari-deferred-state="retired"`）。ラスタ要求は送らない | 従来どおり `.preview.webm` サイドカーで再生 |
| タイムライン / インスペクタ | 表示・選択できたまま（認識は未変更） | 同左 |

lint のメッセージは次のとおり。

```
テロップ（ATF）の描画は退役しました。HTML 素材版のテロップに差し替えてください（Lab で配布）。
すでに焼いた baked を持つ項目はそのまま再生できます。
```

RPC 境界 `rasterizeTelopPreview` は旧クライアント向けに残し、`telop.retired:` を throw する。
呼ばれても描画プロセスは起動しない。

## 4. 差し替え先（HTML 素材版）

ATF の 36 種に相当する文字演出は、**HTML 素材版として内部リポで整備し Lab 経路で配布する**。
本リポ（公開リポ）は参照配布のみで実体を持たない方針なので、`presets/telop/` のような
参照表は復活させない。素材のライセンスは取得した素材の `meta.json` で、レンダリングに使う
書体のライセンスは `catalog/font/<id>/meta.json` で別途確認する
（[skills/edit-plan/expression-selection.md](../skills/edit-plan/expression-selection.md)）。

## 5. 対象外

- **開発者ツールの `puppeteer-core`**: `packages/akari-tools`・analyze-footage / critique-cut の
  補助・`kaisetsu-short` 作例・overlay-runtime の test-harness は退役の対象外。これらは出荷物
  （extraResources / パッケージ版）ではなく開発者の手元で動く道具であり、ブラウザ同梱の
  問題が発生しない
- **bake レール自体**: `layers[]` へアルファ動画を重ねる合成経路と PinP（`kind:"video"`）は維持。
  退役したのは「ATF を焼いて `baked` を作る側」だけである
- **`textstyle` / `textanim` / `luts` / `word-book`**: `presets/` の他の参照表は不変

## 6. 歴史参照が残る箇所

エンコード構成の由来など、消えた実装を**歴史として**参照するコメントは残してある
（`packages/akari-tools/src/eye-bar/bar-asset.mjs` のアルファ ProRes 構成、
`apps/shell/resources/scripts/bundled-cli-npm-entries.mjs` の「外した入口とその理由」）。
判断の記録を消すための退役ではないため、生きた参照と歴史参照を混同しないよう
本ノートへのリンクを添えている。

`apps/shell/extensions/akari-annotations/evidence/` 配下の観測記録に残る `akari:presets/telop/…`
参照は**書き換えない**。evidence は不変の一次情報であり、当時そう観測されたという事実を保つ。
