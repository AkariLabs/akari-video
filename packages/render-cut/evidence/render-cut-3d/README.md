# render-cut 3D 焼き込み（Wave 16b）— HyperFrames `__akariSeek` 実挙動の実証記録

タスク契約の最優先実証事項「HyperFrames が `window.__akariSeek` フックを実際に
フレームごとに呼ぶか」を、ソース精読 + 実 CLI レンダーの両方で実証した記録。
**結論: 呼ばない。** 契約の指示に従い 3D 実装は行わず BLOCKED（設計前提の再裁定待ち）。

## 環境

| 項目 | 値 |
|---|---|
| hyperframes | 0.7.61（package-local install） |
| puppeteer-core | 25.2.1 |
| Node | v26.3.0 |
| Chrome | 150.0.7871.125（headlessShell, swiftshader） |
| ffmpeg | 8.1.1 |
| platform | darwin arm64 |

依存インストールの注意: monorepo workspace のため素の `npm install` は root へ hoist され
root `package-lock.json` を書き換える。`packages/render-cut` 内で
`npm install --workspaces=false` を使うと package-local `node_modules` に入り、
`render-cut.mjs` の capabilities 検査（PACKAGE_ROOT/node_modules 参照）と整合する。

## 方法

`renderOverlaySheet()` が生成する合成シートと同型のミニマルシート（`#stage` に
`data-composition-id` / `data-duration` / `data-fps` / `data-no-timeline`、子に
`.akari-overlay-container.scene.clip` + `data-start="0.2"` / `data-duration="0.5"` +
CSS アニメーション付き赤箱 60×60）へ計測プローブ（console 転送）を仕込み、
`hyperframes render . --composition sheet.html --format webm --fps 10 --workers 1
--no-browser-gpu --no-best-effort` を実行して観測した。

- probe-a: 現行シートと同じく `__akariSeek` のみ定義 + `window.__hf.seek` 出現後に chain-wrap して呼び出しを記録
- probe-b: probe-a に加えてページ側が先回りで `window.__hf = { duration, seek }` を定義

## 実測結果

### 1. HyperFrames は `__akariSeek` を呼ばない（probe-a）

- `__akariSeek called t=0` の記録は**シート自身の `__akariReady` 初期化による 1 回のみ**。フレーム駆動では 0 回
- 毎フレームの駆動は `window.__hf.seek(t)`: `t=0, 0.1, 0.2, …, 0.9`（10fps × 1s = 10 フレーム、フレーム時刻に量子化）が全フレームで記録された
- ソース根拠（hyperframes dist/cli.js）:
  - `pollHfReady`: `!!(window.__hf && typeof window.__hf.seek === "function" && window.__hf.duration > 0)` を待ち、タイムアウト時のエラー文言は「Page must expose window.__hf = { duration, seek }」
  - `prepareFrameForCapture`: 毎フレーム `page.evaluate((t) => { if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t); … }, quantizedTime)`
  - パッケージ全体 grep で `akariSeek` の出現 0 件

### 2. ページ事前定義の `__hf` は注入ランタイムに上書きされる（probe-b）

ページ script（注入ランタイムより先に実行）で `window.__hf = { duration: 1, seek }` を
定義しても、フレーム駆動でページ定義 seek は**一度も呼ばれなかった**（PAGE ログ 0 件）。
注入ランタイム（`</body>` 直前に `<script src="/runtime.js">` として挿入）が自前の
driver で `seek` を置き換える。**naive な事前定義はフック手段として不成立。**

### 3. 注入後の chain-wrap は全フレームで生存する（probe-a）

ランタイムが `__hf.seek` を設置した**後**に seek を wrap（元実装を呼びつつ記録）した
ところ、全 10 フレームで wrap が呼ばれた。**「ランタイム設置後に chain する」方式は
フックとして成立**（ただし poll による wrap はキャプチャ開始との理論上のレース窓が
あるため、実装時は `__hf` オブジェクトへの set-trap 等で決定的に chain すべき）。

### 4. HF ランタイムは clip 可視性と WAAPI を自前駆動する（出力フレーム実測）

probe-a の出力 webm をフレーム抽出し赤箱ピクセルを実測:

| フレーム | 時刻 | 赤箱 px 数 | centroid-x |
|---|---|---|---|
| f-01 | 0.0s | 0 | - |
| f-03 | 0.2s | 3600 | 69.5 |
| f-05 | 0.4s | 3600 | 109.5 |
| f-07 | 0.6s | 3600 | 149.5 |
| f-08 | 0.7s | 0 | - |
| f-10 | 0.9s | 0 | - |

- 可視区間 [0.2, 0.7) のみ描画 = `data-start`/`data-duration` の clip スケジューリングを**ランタイムが自前で解釈**（`__akariSeek` 不要で 2D overlay が動く現行動作の説明になる）
- centroid-x が 69.5 → 109.5 → 149.5（translateX = 200×t + 基準 29.5）と**グローバル時刻**で線形前進 = WAAPI もランタイムが自前駆動
- **副次発見（既存差分・本タスク境界外・報告のみ）**: HF 経路の WAAPI 駆動は
  グローバル時刻 `t` を使う。一方 puppeteer-core フォールバックの `__akariSeek` は
  クリップローカル時刻（`seconds - start`）を使う。`start > 0` の overlay に CSS/WAAPI
  アニメーションがあると、第 1 候補経路とフォールバック経路で見え方が乖離する
  （例: t=0.4s・start=0.2s のとき HF は currentTime=400ms、puppeteer は 200ms）

### 5. eager load 待ち合わせに関するソース所見

- HyperFrames は `window.__akariReady` を**待たない**（自前の media/fonts readiness のみ）
- `prepareFrameForCapture` は `seek` の戻り値（Promise）を **await しない**ため、
  「seek を async にして load を待たせる」方式は不成立
- キャプチャ開始をブロックできるのは `pollHfReady`（`__hf.seek` 存在 + `duration > 0`）
  のみ。glb の eager load 完了まで `window.__hf` を隠す（window レベルの
  defineProperty get-trap 等）方式が候補（未検証）

## ファイル

- `probe-a-sheet.html` / `probe-b-sheet.html`: 実証に使ったシート（自己完結・パス参照なし）
- `probe-a-log.txt` / `probe-b-log.txt`: 実行ログ抜粋（パスはサニタイズ済み）
