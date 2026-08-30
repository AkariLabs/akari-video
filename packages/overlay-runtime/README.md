# @akari-video/overlay-runtime

シェル非依存のオーバーレイ DOM ランタイム。`edit.json` の `overlays[]` を
`#overlay-stage` 配下の DOM にマウントし（`overlay-runtime.js`）、宣言型の
Three.js + glTF シーンを決定的な時刻で描画し（`three-runtime.js`）、
選択・ドラッグ移動・拡縮・テキスト編集を行い（`interaction.js`）、ズーム時の
全体像インジケータを提供する（`minimap.js`）。

**出自**: legacy `akari-video-tauri/ui/` から選別インポート（Wave I-3、
2026-07-15）。当初の JS 3 本（`overlay-runtime.js` / `interaction.js` / `minimap.js`）は
機能的に無改変で移送。詳しい挙動仕様は `docs/notes-2026-07-14-viewer-ui-round.md`
（編集移送済みの設計ノート）を参照。

## このパッケージが担うもの / 担わないもの

| 担う | 担わない |
|---|---|
| `#overlay-stage` 配下のオーバーレイ DOM の mount/tick/unmount | アプリシェルの DOM 骨格（上部バー・字幕リストパネル・トランスポート・スプリッタ等） |
| オーバーレイの選択・ドラッグ移動・拡縮ハンドル・ダブルクリックテキスト編集 | edit.json の実ファイル I/O（`overlay_write` の実装） |
| ズーム中の全体フレーム + 現在視野ミニマップ（`#minimap`） | 動画プレーンの再生/シーク、書き出しパイプライン |
| `video-fx.js` による動画面の画素 FX（LUT / chroma。外部時刻駆動） | 動画プレーン自身の再生・音声・クロック |

`video-fx.js` は `<video>` / `<img>` 1 面ごとに宣言がある場合だけ WebGL canvas を重ねる。
宣言が無い場合は canvas・WebGL context・rAF 負荷を一切作らない。ホストはメディア要素を再生の
正として保ち、タイムライン更新時に `rail.render(t)` を呼ぶ。WebGL 初期化・LUT 解決・画像読込が
失敗した rail は canvas を畳んで元のメディア表示へ戻るため、再生と音声を止めない。

ホストシェル（新モノレポの `apps/shell/` 等）は、本パッケージが期待する DOM id と
`window.akari.*` インターフェースを用意した上で、必要なスクリプトを読み込む。

## 使い方（ホスト側の最小手順）

1. 以下の DOM を用意する（id は固定。`test-harness/index.html` が最小例）:
   - `#overlay-stage`: オーバーレイが注入される舞台。`output.width × output.height`
     の論理サイズを `transform: scale()` でプレビュー実寸へ貼り付ける
     （`transform-origin: 0 0`）
   - `#overlay-stage` の親要素（transform を持たない祖先。選択枠・スナップガイドの
     appendChild 先 = `interaction.js` の `listenerRoot`）
   - `#minimap` / `#minimap-frame` / `#minimap-viewport`: ズーム中のみ表示する
     ミニマップ（`minimap.js` が `hidden` 属性を出し入れする）
2. `window.akari.state` / `window.akari.engine.overlayWrite` / `window.akari.stageScale`
   を実装で満たす（下記「ホストアダプタ契約」参照）
3. 3D overlay を扱うホストは `<script>` で `src/vendor/three-bundle.js` →
   `src/three-runtime.js` → `src/overlay-runtime.js` の順に読み込む。続いて
   `src/interaction.js` → `src/minimap.js`
   の順に読み込む（`interaction.js` は読み込み時点で `#overlay-stage` の
   `document.getElementById` を行うため、DOM がすでに存在している必要がある）。
   **`texts[]`（3D テキスト）を扱うホストは `src/vendor/three-bundle.js` の直後・
   `src/three-runtime.js` より前**に `src/vendor/vendor-3d-text-bundle.js` を追加で
   読み込む（troika は vendored three を alias 解決するため、three-bundle.js が
   `window.AkariThree.THREE` を作った後でないと壊れる。export 側
   `packages/render-cut/src/rasterize.mjs` はシートに `texts[]` 宣言があるときだけ
   自動でこの順に埋め込む — 同じ順序をホストの `<script>` タグでも守ること）
4. `src/interaction.css` と `src/minimap.css` を `<link>` する
5. edit.json ロード後、`window.akari.runtime.mount(summary)` を呼ぶ
   （`summary` = `EditSummary`。下記参照）。以降はタイムライン更新のたびに
   `window.akari.runtime.tick(t, playing)` を呼ぶ

## ホストアダプタ契約（新シェル実装者向け — 本パッケージへの入力）

本パッケージの各スクリプトは `window.akari` 名前空間の以下のプロパティを
**ホストが用意済みである前提**で読む（`window.akari.runtime` /
`window.akari.interaction` / `window.akari.minimap` は本パッケージ自身が
公開する側 — 下の「このパッケージが公開するもの」参照）。

### `window.akari.state`

| プロパティ | 型 | 用途 | 参照元 |
|---|---|---|---|
| `state.editPath` | `string \| null` | 永続化の宛先。`null` の間は書き込みを試みずエラーにする（`interaction.js` `enqueueWrite`） | `interaction.js` |
| `state.summary.output.width` / `.height` | `number` | ドラッグのセーフマージンスナップ計算の基準（既定 1280×720 にフォールバック） | `interaction.js` `outputSize()` |

`state.summary` そのもの（`overlays[]` 含む）は `overlay-runtime.js` の
`mount(summary)` へ**引数として直接渡す**運用（`window.akari.state.summary` を
自動で読みには行かない）。呼び出し側の一貫性のため、`state.summary` と
`mount()` に渡す `summary` は同じオブジェクトにしておくことを推奨する。

### `window.akari.engine`

| メソッド | シグネチャ | 用途 |
|---|---|---|
| `engine.overlayWrite` | `(editPath: string, overlayId: string, patch: OverlayPatch) => Promise<unknown>` | ドラッグ確定・拡縮確定・テキスト編集確定のたびに呼ばれる read-modify-write。`OverlayPatch` は `{ transform?: {x,y,scale,rotate}, html?: string }`。実装は edit.json（および `html` 指定時はオーバーレイ HTML ファイル）への書き戻し |

呼び出しは `interaction.js` 内部で直列化される（`writeTail` チェーン）ため、
ホスト側は呼び出し順を気にせず 1 リクエストずつ処理してよい。失敗しても
後続の操作を妨げない（`catch` して継続）。

### `window.akari.stageScale`

| シグネチャ | 用途 |
|---|---|
| `() => number` | `#overlay-stage` の論理サイズ→実表示 px の倍率。ドラッグ量のフォールバック換算・拡縮の除算基準・ミニマップの `zoom` フォールバックに使う。有限の正数を返さない場合は `1` として扱われる（呼び出し側で防御済み） |

ズーム操作・全画面トグル・スプリッタ操作のたびに `#overlay-stage` の実表示矩形が
変わる想定のため、ホストはこの関数が常に**その時点の最新倍率**を返すようにする
（キャッシュ古い値を返さない）。

### `EditSummary`（`mount()` の引数、参考: legacy 契約 `contract-2026-07-13-m1-m4.md` §M2）

```jsonc
{
  "output": { "width": 1280, "height": 720, "fps": 30 },
  "overlays": [
    {
      "id": "cap-a",
      "html": "<div ...>...</div>",   // 断片の内容そのもの（fetch はしない）
      "start": 1.0,                    // タイムライン秒
      "duration": 4.0,
      "transform": { "x": 0, "y": 0, "scale": 1, "rotate": 0 },
      "vars": { "--color": "#ffffff" }
    }
  ]
}
```

## このパッケージが公開するもの

- `window.AkariThree` — pinned Three.js core と `GLTFLoader` / `RoomEnvironment`
- `window.akari.threeRuntime.render(container, localSeconds)` / `.dispose(container)` /
  `.inspect(container)`（`src/three-runtime.js`）。独自 rAF や wall-clock は持たない
- `window.akari.runtime.mount(summary)` / `.tick(t, playing)` / `.unmount()` /
  `.version`（`src/overlay-runtime.js`）。`.version` は本パッケージ
  `package.json` の `version` と同期させた文字列（例 `"0.2.0"`）。`<script>` で
  直接読み込むホストは npm 解決を経ないため、機能検出（例: 多層テキスト断片の
  `data-mirror` 同期に対応しているか）に `window.akari.runtime.version` を使う
- `window.akari.interaction.selftest()` — 合成 PointerEvent で
  「選択 → 60px ドラッグ → overlayWrite」+「拡縮ハンドル → overlayWrite」を実行し
  `{ ok, detail }` を返す自己診断（`src/interaction.js`。リスナー自体は読み込み時に
  自動登録され、`selftest` 以外は公開 API を持たない）
- `window.akari.minimap.update()` / `.state()`（`src/minimap.js`）
- `window.akari.viewportUnits.rewriteCssText(css)` / `.applyAll(root)` /
  `.stageVariables(output)` / `.applyStageVariables(stageEl, output)`（`src/viewport-units.js`）。
  断片 CSS の `vw` / `vh` 系単位をステージ（出力サイズ）基準で解決させる書き換え（下記）

### ライブプレビュー向け 3D premount

`three-runtime.js` は、3D オーバーレイを可視化前にロードして一度描画するための
`configurePremount(policy)` / `prepare(container, options)` /
`premountTick(entries, timelineSeconds)` / `premountState()` を公開する。低レベル API の既定は
**無効**で、ライブプレビューのホストが `configurePremount()` を呼んだときだけ有効になる。
既定値は `leadSeconds: 2.0`、`maxInstances: 4`。書き出し側は有効化しないため、従来の
ロード・描画・破棄経路と生成画素を保つ。

本パッケージの DOM ランタイムは factory としても利用できる。

```js
const runtime = window.akari.createOverlayRuntime({
  premount: { leadSeconds: 2, maxInstances: 4 },
});
runtime.configure({ premount: { leadSeconds: 1.5, maxInstances: 3 } });
runtime.configure({ premount: false }); // 無効化
```

`createOverlayRuntime()` の `premount` 未指定時は auto で、`#overlay-stage` があるライブホストだけ
既定値を有効化する。preview-server の Web UI は `app.js` 内に別実装の runtime を持つため、
`three-runtime.js` がその `tick()` を自動装飾する。装飾は runtime に `tick` があり、文字列の
`version` と `__akariPremountDriven` がなく、かつ `#overlay-stage` が存在するときだけ一度行う。

保持距離は `max(start - t, t - (start + duration), 0)`、すなわち可視窓までの前後対称距離で
求める。距離が `leadSeconds` 以下なら事前マウントし、`leadSeconds × 2` 以上離れた instance は
破棄する。`maxInstances` を超えた場合は可視中のものを除き、距離が最も遠い instance から
破棄する。これにより短い非表示や近距離のシークでは同じ instance を再利用する。

### 多層テキスト断片のミラー同期（`data-mirror="text"`、v0.2.0〜）

縁取り・影・裏打ち等で同一テキストを複数層重ねる断片（`skills/overlay-authoring/telop.md`
「多層テキスト断片と data-mirror 規約」）の編集同期を `interaction.js` が担う。断片側の
規約（複製層に `data-mirror="text"` を付ける等）はスキル文書が正本、本パッケージ側の
実装点は次の 3 つ:

- `mount()` が `[data-mirror="text"]` 層へ `aria-hidden="true"` を一括付与する
- ダブルクリック編集の対象探索（`textElementAt`）は `data-mirror="text"` を持つ層を
  候補から除外する（結果として断片内に残る唯一の直接テキスト層 = fill 層だけが編集対象になる）
- 編集層の `input` / `compositionend`、および保存確定時（`commitEdit` の安全網）に、
  同一 stack（既定は編集層の親要素配下）の全 `[data-mirror="text"]` 層へ textContent を
  コピーしてから `overlayWrite` へ渡す

旧バージョン（`data-mirror` 未知）でも断片は全層に同一テキストを焼いて出荷される前提の
ため初期表示は正しいが、ライブ編集の層間同期は v0.2.0 以降でのみ効く。

### ビューポート単位のステージ基準化（`vw` / `vh` 系、2026-08-31〜）

断片の CSS に書いた `vw` / `vh` / `vmin` / `vmax`（`dvw` 等の接頭辞付き・`vi` / `vb` も）は
ブラウザ仕様どおり**ウィンドウの viewport** を基準に解決される。書き出し
（`packages/render-cut/src/rasterize.mjs`）は出力サイズちょうどの viewport でシートを描くので
正しいが、プレビューは `#overlay-stage` を出力 px の論理サイズで作り `transform: scale()` で
ペインへ収めるため、ステージの px 寸法とウィンドウ幅が一致せず `vw` の意味が書き出しと
ずれていた（書き出しが正しく、プレビューが嘘をつく。2026-08-31 実機報告）。

ランタイム側で完結させる（断片は書き換えない・`<script>` も要らない）:

| 契機 | 動作 |
|---|---|
| `mount()` 冒頭 | `#overlay-stage` に `--akari-vw` / `--akari-vh` / `--akari-vmin` / `--akari-vmax` を `summary.output` から定義（1280x720 → `12.8px` / `7.2px`） |
| 断片注入直後 | `<style>` と `style=""` の `<数値><単位>` を `calc(<数値> * var(--akari-vw, 1vw))` へ書き換える（冪等） |

書き換えないもの: `@media` / `@container` / `@supports` 等の at-rule プレリュード
（`var()` が使えず、書き換えると条件式ごと無効になる）、文字列リテラル、`url(...)`、
コメント。フォールバック `1vw` は `--akari-*` を定義しない別ホストで従来挙動へ退避するため
のもので、本番のプレビュー（shell / Web）では必ず定義される。shell は `viewport-units.js` を
`runtimeJavaScript`（`slot-params.js` + `overlay-runtime.js` の連結）へ同梱して注入する。

## ディレクトリ

```
src/
  vendor/three-bundle.js  Three.js core + GLTFLoader + RoomEnvironment の単一 IIFE
  vendor/three-LICENSE.txt  Three.js の MIT License
  vendor/vendor-3d-text-bundle.js  troika-three-text + opentype.js + matter-js + poly-decomp の単一 IIFE
  vendor/troika-three-text-LICENSE.txt  troika-three-text の MIT License
  vendor/opentype.js-LICENSE.txt        opentype.js の MIT License
  vendor/matter-js-LICENSE.txt          matter-js の MIT License
  vendor/poly-decomp-LICENSE.txt        poly-decomp の MIT License
  three-runtime.js     宣言型 3D scene の load / setTime / render / dispose
  viewport-units.js    断片 CSS の vw/vh 系単位をステージ（出力サイズ）基準へ書き換え
  overlay-runtime.js   DOM mount/tick と 3D 可視ライフサイクル
  interaction.js       legacy ui/interaction.js を無改変移送
  interaction.css       legacy ui/interaction.css を無改変移送
  minimap.js            legacy ui/minimap.js を無改変移送
  minimap.css           legacy ui/style.css 206〜234 行（#minimap ブロック）を抽出
docs/
  notes-2026-07-14-viewer-ui-round.md   挙動仕様書として編集移送（前書き付き）
test-harness/
  index.html    最小テストハーネス（#overlay-stage / #preview-pane / #minimap 系 DOM）
  stub-host.js  window.akari.state / engine.overlayWrite / stageScale のスタブ
  run-tests.js  mount / tick / interaction.selftest / minimap.update の動作確認
  smoke-3d-text.html   three@0.185.1 × troika-three-text 互換 smoke ページ
  fonts/ZenKakuGothicNew-Black.ttf, OFL.txt   smoke 専用フォント（Google Fonts 由来・OFL）
evidence/
  3d-vendor-bundle-smoke/   互換 smoke のスクリーンショット証跡
out/
  status.json   タスク完了ステータス（本パッケージの成果物ではなくタスク契約の出力）
```

## Three.js vendor の固定と再生成

`src/vendor/three-bundle.js` は npm package `three@0.185.1` の core と
`three/addons/loaders/GLTFLoader.js`、`three/addons/environments/RoomEnvironment.js` だけを
entry point にし、`esbuild@0.24.2` で
事前生成したブラウザ向け単一 IIFE である。実行時に npm、CDN、外部 origin を参照しない。
生成時の npm tarball integrity は次のとおり。

- `three@0.185.1`: `sha512-5aojFCXKwnjBRZvUnt3WFfEcvUJgkN5LlijRFN95hMy8WVkG4I0QNcJE+OuWvuJ0bOdStrbfXn0pkd6/QyiAlg==`
- `esbuild@0.24.2`: `sha512-+9egpBW8I3CD5XPe0n6BfT5fxLzxrlDzqydF3aviG+9ni1lDC/OvMHcxqEFV0+LANZG5R1bFMWfUrjVsdwxJvA==`
- `@esbuild/darwin-arm64@0.24.2`: `sha512-kj3AnYWc+CekmZnS5IPu9D+HWtUI49hbnyqk0FLEJDbzCIQt7hg7ucF1SQAilhtYpIujfaHr6O0UHlzzSPdOeA==`

entry file は次の内容に固定する。

```js
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

window.AkariThree = Object.freeze({ THREE, GLTFLoader, RoomEnvironment });
```

再生成コマンド（上記 entry を `akari-three-entry.js` とする空の一時ディレクトリで実行。
以下は生成に使った macOS arm64 の例）:

```sh
npm pack three@0.185.1 --ignore-scripts
npm pack esbuild@0.24.2 --ignore-scripts
npm pack @esbuild/darwin-arm64@0.24.2 --ignore-scripts
mkdir -p node_modules/three node_modules/esbuild node_modules/@esbuild/darwin-arm64
tar -xzf three-0.185.1.tgz -C node_modules/three --strip-components=1
tar -xzf esbuild-0.24.2.tgz -C node_modules/esbuild --strip-components=1
tar -xzf esbuild-darwin-arm64-0.24.2.tgz \
  -C node_modules/@esbuild/darwin-arm64 --strip-components=1
node node_modules/esbuild/bin/esbuild akari-three-entry.js \
  --bundle --format=iife --platform=browser --target=es2020 --minify \
  --legal-comments=inline --outfile=three-bundle.js
```

外部ネットワークを使う取得操作は上記 `npm pack` だけとし、tarball integrity を照合してから
展開する。生成後は本節に記録した bundle の byte 数と SHA-256 も照合する。

- `three-bundle.js`: `776523` bytes / SHA-256 `ab202898af18d5a4b5e74dc763911bbbe33a4dbf7ea8278828b11cc9404fcf9a`

Three.js は MIT License（Copyright © 2010-2026 three.js authors）。完全な許諾文は
`src/vendor/three-LICENSE.txt` に保持し、esbuild の `--legal-comments=inline` により
upstream の `@license` 表記も bundle 内に保持する。

## 3D テキスト vendor（troika-three-text / opentype.js / matter-js / poly-decomp）の固定と再生成

`src/vendor/vendor-3d-text-bundle.js` は `troika-three-text@0.52.4` / `opentype.js@1.3.4` /
`matter-js@0.20.0` / `poly-decomp@0.3.0`（いずれも MIT License）を、上記 Three.js vendor と
同じ「npm pack → integrity 照合 → esbuild IIFE 化」様式で固定した第 2 の単一 IIFE である。
実行時に npm、CDN、外部 origin を参照しない。`poly-decomp` は task 2026-08-12-3d-text-physics
（`physics.colliders[].type === "polygon"` の凹多角形対応）で追加した。理由は後述「poly-decomp
を追加した理由」節を参照。

### 単一 three インスタンス制約への対応

troika-three-text（および troika-three-utils）は `import ... from "three"` を持つため、素朴に
バンドルすると three-bundle.js とは別実体の Three.js が同梱され、`instanceof` が壊れる
（two-three 問題）。本バンドルは **既存 `three-bundle.js` を再生成せず、esbuild の `--alias` で
`"three"` の解決先をランタイム shim に差し替える「追加バンドル化」** で対応した:

- entry 側で `"three"` を解決するたびに `three-shim.js`（下記）へ alias する。shim は
  CommonJS 形式で `module.exports = window.AkariThree.THREE` を返すだけで、esbuild は
  named import（`import { Vector3 } from "three"` 等）をこの shim オブジェクトへの実行時
  プロパティアクセスへ変換する。**参照先は three-bundle.js が生成した同一オブジェクト**
  なので、troika 内部で作られる `Vector3` 等のクラスは three-runtime.js 側が使う
  `window.AkariThree.THREE.Vector3` と同一の関数実体になり、`instanceof` が成立する
  （smoke ページで実測済み、後述）
- 読み込み順は `three-bundle.js` → `vendor-3d-text-bundle.js` を厳守する（shim は
  読み込み時点で `window.AkariThree.THREE` が存在している前提）
- 出力側は「既存 `window.AkariThree` の freeze オブジェクトへの追加エクスポート」を
  entry 自身が担う（`window.AkariThree = Object.freeze({ ...window.AkariThree, TroikaText,
  opentype, Matter })`）。`three-bundle.js` は無改変のまま byte 数・SHA-256 とも既存節の
  記載値から変化しない。`poly-decomp` 自体は `window.AkariThree` へ再エクスポートしない
  （`Matter.Common.setDecomp(polyDecomp)` を entry 内で 1 回呼ぶだけの内部使用）
- 一体化案（three + troika 等を 1 本の entry に混ぜて再生成する）も検討したが、
  既存 `three-bundle.js` の照合値を変更すると本 README 外の参照箇所に影響し得るため見送った

### npm tarball integrity

- `troika-three-text@0.52.4`: `sha512-V50EwcYGruV5rUZ9F4aNsrytGdKcXKALjEtQXIOBfhVoZU9VAqZNIoGQ3TMiooVqFAbR1w15T+f+8gkzoFzawg==`
- `troika-three-utils@0.52.5`: `sha512-WsePbcX8RtfidRfsxK1eCZCjF81ZDzAKHH/evLs0hdV2wpoCb0vArGZHdzdOJrSS3k4zfdtbKDaBh8+phkrYnw==`
- `troika-worker-utils@0.52.0`: `sha512-W1CpvTHykaPH5brv5VHLfQo9D1OYuo0cSBEUQFFT/nBUzM8iD6Lq2/tgG/f1OelbAS1WtaTPQzE5uM49egnngw==`
- `webgl-sdf-generator@1.1.1`: `sha512-9Z0JcMTFxeE+b2x1LJTdnaT8rT8aEp7MVxkNwoycNmJWwPdzoXzMh0BjJSh/AEFP+KPYZUli814h8bJZFIZ2jA==`
- `bidi-js@1.0.3`: `sha512-RKshQI1R3YQ+n9YJz2QQ147P66ELpa1FQEg20Dk8oW9t2KgLbpDLLp9aGZ7y8WHSshDknG0bknqGw5/tyCs5tw==`
- `opentype.js@1.3.4`: `sha512-d2JE9RP/6uagpQAVtJoF0pJJA/fgai89Cc50Yp0EJHk+eLp6QQ7gBoblsnubRULNY132I0J1QKMJ+JTbMqz4sw==`
- `matter-js@0.20.0`: `sha512-iC9fYR7zVT3HppNnsFsp9XOoQdQN2tUyfaKg4CHLH8bN+j6GT4Gw7IH2rP0tflAebrHFw730RR3DkVSZRX8hwA==`
- `poly-decomp@0.3.0`: `sha512-hWeBxGzPYiybmI4548Fca7Up/0k1qS5+79cVHI9+H33dKya5YNb9hxl0ZnDaDgvrZSuYFBhkCK/HOnqN7gefkQ==`
  （tarball shasum `aa499289bbc1a4ca2213e966587fa5bffc1ca5f5`、28187 bytes、依存ゼロ）
- `esbuild@0.24.2` / `@esbuild/darwin-arm64@0.24.2`: 既存 Three.js vendor 節と同一（上記参照）

`troika-three-utils` / `troika-worker-utils` / `webgl-sdf-generator` / `bidi-js` は
`troika-three-text` の実行時依存（`peerDependencies` の `three` を除く）で、いずれも
troika-three-text 自身の `dependencies` に固定されているバージョンを取得した。
`opentype.js` / `matter-js` は自己完結（実行時依存なし）で、両者のバンドル済み dist
（`opentype.module.js` / `build/matter.js`）を entry point にした。

### entry file と shim

`three-shim.js`（alias 先。`"three"` の named import をランタイムで
`window.AkariThree.THREE` のプロパティへ解決させる）:

```js
module.exports = window.AkariThree.THREE;
```

`vendor-3d-text-entry.js`（バンドル本体の entry。**2026-08-12 task 2026-08-12-3d-text-physics
で `poly-decomp` を追加**。理由は次節参照）:

```js
import { Text } from "troika-three-text";
import * as opentype from "opentype.js";
import Matter from "matter-js";
import polyDecomp from "poly-decomp";

Matter.Common.setDecomp(polyDecomp);

window.AkariThree = Object.freeze({
  ...window.AkariThree,
  TroikaText: Text,
  opentype,
  Matter,
});
```

### poly-decomp を追加した理由（`physics.colliders[].type === "polygon"` の凹多角形対応）

`matter-js` の `Bodies.fromVertices` は、凹多角形を渡しても `poly-decomp` が
`Matter.Common.setDecomp` で登録されていないと**エラーにせず警告 1 回だけで凸包へ自動
フォールバックする**（一次ソース: `liabru/matter-js` `src/factory/Bodies.js`）。人物シルエット
のような凹多角形 collider（腕と胴体の間の凹み）はこのフォールバックで凹みが埋まり、
「本来空間があるのに文字が跳ね返る」誤判定を起こす。`poly-decomp`（MIT・実行時依存なし）を
entry 側で `import` して `Matter.Common.setDecomp(polyDecomp)` を bundle 読み込み時に 1 回
呼ぶことで、以後 `Bodies.fromVertices` は凹多角形を正しく複数の凸パーツへ分解する
（`packages/render-cut/evidence/3d-text-physics/vendor-smoke.mjs` で実機の bundle
そのものに対して実測確認済み）。

### 再生成コマンド

空の一時ディレクトリで、`three-shim.js` と `vendor-3d-text-entry.js` を上記内容で置いた上で
実行する（macOS arm64 の例。esbuild 本体は既存 Three.js vendor 節と共用可）:

```sh
npm pack troika-three-text@0.52.4 troika-three-utils@0.52.5 troika-worker-utils@0.52.0 \
  webgl-sdf-generator@1.1.1 bidi-js@1.0.3 opentype.js@1.3.4 matter-js@0.20.0 \
  poly-decomp@0.3.0 --ignore-scripts
mkdir -p node_modules/troika-three-text node_modules/troika-three-utils \
  node_modules/troika-worker-utils node_modules/webgl-sdf-generator \
  node_modules/bidi-js node_modules/opentype.js node_modules/matter-js node_modules/poly-decomp
tar -xzf troika-three-text-0.52.4.tgz -C node_modules/troika-three-text --strip-components=1
tar -xzf troika-three-utils-0.52.5.tgz -C node_modules/troika-three-utils --strip-components=1
tar -xzf troika-worker-utils-0.52.0.tgz -C node_modules/troika-worker-utils --strip-components=1
tar -xzf webgl-sdf-generator-1.1.1.tgz -C node_modules/webgl-sdf-generator --strip-components=1
tar -xzf bidi-js-1.0.3.tgz -C node_modules/bidi-js --strip-components=1
tar -xzf opentype.js-1.3.4.tgz -C node_modules/opentype.js --strip-components=1
tar -xzf matter-js-0.20.0.tgz -C node_modules/matter-js --strip-components=1
tar -xzf poly-decomp-0.3.0.tgz -C node_modules/poly-decomp --strip-components=1
# esbuild / @esbuild/darwin-arm64 は既存 Three.js vendor 節の手順で展開済みの node_modules を再利用
node node_modules/esbuild/bin/esbuild vendor-3d-text-entry.js \
  --bundle --format=iife --platform=browser --target=es2020 --minify \
  --legal-comments=inline --alias:three=./three-shim.js --external:fs \
  --outfile=vendor-3d-text-bundle.js
```

`--external:fs` は `opentype.js` の Node.js 専用フォールバック（`toArrayBuffer()` の保存処理・
`loadFromFile()`）内にある `require("fs")` を dead code のまま残すためのフラグで、ブラウザ
実行時にこの分岐へは到達しない（未解決の `require` 呼び出しを bundle 時にエラーにしないための
措置。実害なし）。

外部ネットワークを使う取得操作は上記 `npm pack` だけとし、tarball integrity を照合してから
展開する。生成後は本節に記録した bundle の byte 数と SHA-256 も照合する。

- `vendor-3d-text-bundle.js`（poly-decomp 追加後）: `386171` bytes / SHA-256
  `b7631ef33797aa1e77c3b939d5a2e2122b8db9517e40ec60fb26ec110f0129b8`
  （追加前: `381019` bytes / `75498089f1aaa6d9c3ecdb74c63fd416cf4cc8fefe1c3ecccbeffffd7bfa19fc`）

troika-three-text / opentype.js / matter-js / poly-decomp はいずれも MIT License。
完全な許諾文はそれぞれ
`src/vendor/troika-three-text-LICENSE.txt` / `src/vendor/opentype.js-LICENSE.txt` /
`src/vendor/matter-js-LICENSE.txt` / `src/vendor/poly-decomp-LICENSE.txt` に保持する
（推移的依存の bidi-js 等は troika-three-text 本体のライセンス表記に準ずる MIT で、esbuild の
`--legal-comments=inline` により該当する `@license` コメントがあれば bundle 内に保持される）。

### 互換 smoke（three@0.185.1 × troika-three-text@0.52.4）

`test-harness/smoke-3d-text.html`（+ `test-harness/fonts/ZenKakuGothicNew-Black.ttf`,
Google Fonts 由来・OFL、同ディレクトリに `OFL.txt` 同梱）は `three-bundle.js` →
`vendor-3d-text-bundle.js` の順で読み込み、日本語文字列を `TroikaText`（`Text`）で
SDF 描画して `sync()` 完走とレンダリング結果を実測するページである。開き方:

```sh
cd packages/overlay-runtime
python3 -m http.server 8947
# → http://127.0.0.1:8947/test-harness/smoke-3d-text.html を開く
```

`document.body.dataset.smokeStatus` が `"synced"` になれば `sync()` 完走。ページ左上の
ステータス行に `sameThreeInstance=true`（`text.position instanceof THREE.Vector3` の実測）
も表示する。証跡: `evidence/3d-vendor-bundle-smoke/troika-three185-japanese-sdf.png`
（日本語グリフが SDF 描画されているスクリーンショット、キャンバス内の非背景色ピクセル比率
約 2.9% で実測確認済み）。

## テストハーネス

`test-harness/index.html` をブラウザで開くと、`stub-host.js` が
`window.akari.state` / `engine.overlayWrite`（**スタブ実装** — console.log するのみで
実ファイルには書き込まない）/ `stageScale`（常に `1` を返す固定スタブ）を用意した上で、
`run-tests.js` が mount → tick（2 区間）→ `interaction.selftest()`（実際の合成ドラッグ・
拡縮ドラッグ）→ `minimap.update()`/`state()` を順に実行し、結果をページ下部のログ欄と
コンソールへ出力する（`document.body.dataset.testStatus` に `"pass"`/`"fail"` を立てる）。

npm グローバルインストール禁止の制約内で完結するよう、ビルドステップは無し
（プレーンスクリプト + 静的 HTML のみ）。

## 既知の仕様差分（legacy 設計ノートとの整合について）

- `interaction.js` のドラッグ選択/拡縮クランプは **0.2〜4.0 倍**
  （`docs/notes-2026-07-14-viewer-ui-round.md` §3 の設計ノートに一致）。
  当時の実装依頼テキストには 0.2〜5.0 という記載もあったが、実装は設計ノートを
  SSOT として 4.0 を採用している（コード内コメントに明記済み。§3 前書き参照）
- `src/minimap.css` の抽出行範囲は、タスク契約記載の「206〜231 行」ではなく
  実際には **206〜234 行**（`#minimap-viewport` ブロックの完全な終端まで）。
  231 行で区切ると `#minimap-viewport` 規則の宣言途中で切れ、閉じ括弧を欠く
  不正な CSS になるため、意図（「minimap 用ブロックを抽出」）に沿って実際の
  ブロック終端まで抽出した。詳細は `out/status.json` 隣接の `report.md` を参照
