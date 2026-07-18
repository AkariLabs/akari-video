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
- `l1/`: 実装 Wave（16b-2）の L1 証跡（下記）

---

# Wave 16b-2 実装検証（追補 1 裁定後・puppeteer-core 正式経路）

司令塔裁定により 3D あり書き出しは puppeteer-core 経路へ一本化して実装した後の L0/L1 実測記録。
検証フィクスチャ: 回転アニメ付き自作立方体 glb（1,972 bytes・clip 名 `Spin`・Y 軸 4 秒 1 回転・依存ゼロ生成）+
testsrc2 実 ffmpeg 動画（8s・sine 音声）+ HTML テロップ + captions.json 併存の edit.json、
**空白 + 日本語入りパス**のプロジェクトで実施。3D overlay は start 0 / duration 2.5、canvas は CSS で
ステージ座標 (800,100) 360×360 に固定。

## L0

- `node --check` 4 ファイル OK / パッケージテスト **13/13 PASS**（実 Chrome 150）
- 非 3D シートは旧実装とバイト同一（sha256 `1e26ad90…` 一致を新旧実装の直接比較で実測）
- リポ `build:ext` exit 0 / `lint` exit 0（main 側 checkout から node_modules を rsync・symlink 保証後）
- WebGL 地雷の実証: Chrome 150 headless は従来引数（`--disable-gpu` のみ）で WebGL コンテキスト生成に
  失敗する。`--enable-unsafe-swiftshader` 追加で SwiftShader 描画が成立（スモークテストで
  同時刻ハッシュ完全一致・異時刻ハッシュ相違も同時に実測）

## L1（実 CLI・全 PASS）

1. **3D 焼き込み**: verify PASS・HF は「3D overlay requires the puppeteer-core path」で reject →
   puppeteer-core adopted。3D 区間内フレームに立方体実在（橙 18,258〜28,441 px、`l1/export-cube-caption-t0.7.png`）。
   区間外はベースライン（3D だけ除いた同一プロジェクト・同経路）との全画素 MAD 0.12〜0.23% = コーデックノイズ水準で立方体なし
2. **時刻正確性**: t=0.5/1.2/2.4 で橙 px 数・centroid・領域ハッシュが全て相違（pose 前進）
3. **決定性**: 同一入力 2 回書き出し → 6 時刻の対応フレームが**全画素 sha256 一致**
4. **WYSIWYG**: パッケージ版アプリ（asar 内 three-runtime / three-bundle / overlay-runtime が
   ソースと**ビット一致**を確認）へ生 CDP 接続し、同一プロジェクトを実 UI で開いて同時刻スクショ比較。
   立方体 centroid ずれ **0.07〜0.26%**（±1% 基準内）・bbox ±1px・diff ヒートマップにゴースト縁なし。
   cube マスク画素差 raw 3.4% の内訳は一様な DC 色シフト（両時刻で同値 (-7,+4,+14)、動画背景の平坦部では
   12.3% とさらに大きい = スクショ側の色変換パイプライン由来の測定系アーティファクト）で、
   **DC 除去後の構造残差 0.55%/1.09% = アンチエイリアス/リサンプル程度・構造差なし**
   （preview は 0.89 倍表示 → 1280 へ再拡大の往復を測定経路に含む。`l1/wysiwyg-*.png` / `l1/wysiwyg-diff-*.png`）
5. **eager load**: フレーム 0（t=0.000）から立方体 28,441 px（`l1/eager-frame-0.png`）。空 canvas なし
6. **非退行**: 3D なし edit.json は HF が第 1 候補として実行される順序を維持（旧コードと同一挙動）。
   旧実装（HEAD）と新実装の書き出しを 6 時刻で比較し**全画素一致**。テロップ + 字幕焼き込み無変化
   （`l1/export-telop-caption-t3.6.png`）。なお本環境では HF の webm 出力が vp9/yuv420p（alpha なし）のため
   旧コード時点から probeHasAlpha で reject → puppeteer フォールバックとなる（既知の
   webm/png-sequence 契約不一致の実害。旧コードで同一再現を実測済み・本タスク境界外）
7. **透過**: 3D canvas 領域の非立方体部（四隅 40×40）がベースラインと MAD ≤1.03% で一致 =
   動画が正しく透けている。中間 overlay.mov の alpha は probeHasAlpha ゲートで担保
8. **経路選択**: 3D なしベースラインは HF 試行 → (既存 alpha 事象で) puppeteer。3D ありは HF スキップが
   provenance に記録される（render.json attempts 実測）
