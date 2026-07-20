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
   `document.getElementById` を行うため、DOM がすでに存在している必要がある）
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
- `window.akari.runtime.mount(summary)` / `.tick(t, playing)` / `.unmount()`
  （`src/overlay-runtime.js`）
- `window.akari.interaction.selftest()` — 合成 PointerEvent で
  「選択 → 60px ドラッグ → overlayWrite」+「拡縮ハンドル → overlayWrite」を実行し
  `{ ok, detail }` を返す自己診断（`src/interaction.js`。リスナー自体は読み込み時に
  自動登録され、`selftest` 以外は公開 API を持たない）
- `window.akari.minimap.update()` / `.state()`（`src/minimap.js`）

## ディレクトリ

```
src/
  vendor/three-bundle.js  Three.js core + GLTFLoader + RoomEnvironment の単一 IIFE
  vendor/three-LICENSE.txt  Three.js の MIT License
  three-runtime.js     宣言型 3D scene の load / setTime / render / dispose
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
