# frame-engine boot evidence

## 症状

frame-engine バンドルの読み込みログが出ても `data-frame-engine-ready` と
`window.akari.frameEngineClock` が publish されず、エラー UI も出ないままプレビューが真っ黒になる。
engine 有効時は旧経路の媒体を `frameEngineMediaIdle` にするため、bootstrap が止まると旧経路にも
`#preview-video` の `src` が入らず、シークしても何も描画されない。

## 真因

回帰コミット `49c9bb9c`（2026-08-31 00:50:24 +0900、refs #31 #34）が
`frameEngineBootstrapScript()` のテンプレートリテラル内へ TypeScript の型述語
`.filter((value): value is number => ...)` を入れた。テンプレートの中身は tsc の構文検査対象外なので
ビルドは通る一方、webview へ注入された JavaScript は parse できなかった。

BEFORE の停止点は webview ホストの `webview/main.js:563` にある `document.write()` で、
`SyntaxError: Failed to execute 'write' on 'Document': missing ) after argument list` が発生した。
例外はプレビュー文書ではなく外側のホストページに出るため、プレビュー内 console にも既存エラー UI にも
届かない。末尾の frame-engine `<script>` の手前で書き込みが止まり、bootstrap は 1 行も実行されず、
`data-frame-engine-active` と `frameEngineClock` の双方が publish されなかった。

## 修正

- 型述語を素の JavaScript `.filter(value => ...)` へ戻した。
- `src/browser/` を TypeScript AST で走査し、名前が `Script` で終わる生成関数の全テンプレートを cooked text
  へ復元して `vm.Script` で構文検査する回帰テストを追加した。`${...}` は `0` に置換し、検査対象 4 件以上も
  必須にしている。
- engine bundle より前へ独立 watchdog を置いた。boot が ready にならなければ原因、診断 JSON、
  fallback ボタンを表示し、「旧経路で開き直す」で widget 単位に frame-engine を opt-out して再構築する。
- `error` イベントを主因、`unhandledrejection` を補足として分離した。Theia / Chromium 由来の無関係な
  Promise 拒否が、本物の bootstrap 構文エラーより優先されない。

## 実測環境

- 環境 A: 本 worktree のビルド + tier 2 Electron 39.8.7。stock `libffmpeg` は 2,160,944 B で
  `H264 Decoder` を 1 件含む。
- 環境 B: main-ops のビルド済み shell（frontend bundle のタイムスタンプ 2026-08-22 01:27）+
  main-ops の Electron。main-ops 側は読み取り専用、`--user-data-dir` は隔離した一時ディレクトリ。
- fixture: 1920×1080 / 30 fps / 8 s / H.264 `avc1.640028`。2 s ごとに
  `#DC2828` → `#28B450` → `#2850DC` → `#E6C828`、全画面 HTML オーバーレイは
  `#0080ff`・0.5–5.0 s、字幕 1 本は 1.5–3.5 s。

## 起動行列（実 Electron + CDP）

| # | 環境 | コード | `AKARI_FRAME_ENGINE` | active | ready | clock | 2.0 s | 6.5 s | 判定 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | A | BEFORE `ec30f386` | 既定（ON） | `null` | 要素なし | `undefined` | stage 全 7 点 `rgb(0,0,0)` | `rgb(0,0,0)` | 無言死・真っ黒 |
| 2 | A | BEFORE | `0` | `null` | — | `undefined` | overlay `rgb(55,126,247)` | `rgb(232,202,77)` | 正常（旧経路） |
| 3 | A | AFTER | 既定（ON） | `"true"` | `"true"` | `object` | overlay `rgb(55,126,247)` | engine canvas `rgb(230,196,74)` | 正常 |
| 4 | A | AFTER | `0` | `null` | — | `undefined` | `rgb(55,126,247)` | `rgb(232,202,77)` | 正常。#3 と 2.0 s は 6 点バイト一致 |
| 5 | A | AFTER | ON・ready timeout 1 ms | — | `"false"` | `undefined` | — | — | fail-loud カードが 12 ms で出現 |
| 6 | A | AFTER の成果物へ構文エラーを再注入 | ON | — | 要素なし | `undefined` | — | — | 14,927 ms でカード、3 s 後に旧経路へ復帰 |
| 7 | B | main-ops build | ON | `#preview-stage` 自体なし | — | `undefined` | — | — | frame-engine 未搭載 |
| 8 | B | main-ops build | `0` | 同上 | — | `undefined` | — | — | ON と HTML 長 1,292,644 B で完全一致 |

#6 では `window.AkariFrameEngine` も publish されず、カードの原因文字列は実際の
`missing ) after argument list` の SyntaxError を指した。fallback ボタン押下後は 3 s で
`#preview-video` に `src` が入り、`data-frame-engine-active` が消えた。

r1 の #5 では、健全な engine の初期化中に Chromium の PressureObserver が出した無関係な
`unhandledrejection` を「最初のエラー」として表示する欠陥も判明した。これは boot 主因ではないため、
更新後は `error` イベントだけを主因候補にし、Promise 拒否は他の原因判定へ落ちた場合の補足と
`data-frame-engine-boot-errors` の診断 JSON にのみ残す。

## deliverable 探針の実測（r2）

以下は本ディレクトリの `run-l1.sh` / `run-l1.mjs` 自体を実 Electron へ適用した結果である。

| ラベル | 環境変数 / options | timings ms（stage / ready / total） | 実測結果 |
|---|---|---|---|
| `engine-on` | 既定 | 4,120 / 11 / 15,296 | active=`"true"`、ready=`"true"`、clock=`object`、source=`base / original / hardware-ok / avc1.640028`。overlay は全点 `rgb(55,126,247)`、`maxDelta=0`、`pass=true`、`maxAbsoluteDelta=55`。6.5 s は全計測点 `rgb(230,196,74)`、`maxAbsoluteDelta=34` |
| `engine-off` | `AKARI_FRAME_ENGINE=0` | 897 / `null` / 6,383 | active=`null`、clock=`undefined`。overlay は engine ON と同じ `rgb(55,126,247)`、`maxDelta=0`、`maxAbsoluteDelta=55`。6.5 s は `rgb(232,202,77)`、`maxAbsoluteDelta=37` で、engine ON との差は Δ=6 |
| `failloud-sw` | `AKARI_FRAME_ENGINE_READY_TIMEOUT_MS=1`、`AKARI_FRAME_ENGINE_FORCE_SW=1`、`{"failLoud":true}` | — | card 出現、poll 開始から 16 ms / stage 検出から 1,018 ms。スクリーンショット取得、fallback ボタンあり。主因は 1 ms timeout、PressureObserver の rejection は括弧内補足 |

## fail-loud 実測と運用注記

健全な環境で `AKARI_FRAME_ENGINE_READY_TIMEOUT_MS` を極端に小さくすると、カードは出るが engine が
ready になった時点で仕様どおり自動的に消えるため一過性になる。
`AKARI_FRAME_ENGINE_FORCE_SW=1` を併用すると boot が遅くなり、探針がカードを確実に捕捉できる。
r2 の `failloud-sw` はこの条件で、原因文字列は
`初期化が 1 ms 以内に完了しませんでした (data-frame-engine-ready=false)` を主因とし、無関係な
PressureObserver rejection は `未処理の Promise 拒否` の補足へ落ちた。

本物の boot 失敗として bootstrap の構文エラーを再注入した負のコントロールでは、既定 15,000 ms の
まま 14,927 ms でカードが出て消えず、原因文字列は
`最初のエラー: Uncaught SyntaxError: Failed to execute 'write' on 'Document': missing ) after argument list (…/webview/index.html?id=…:21)`
となった。「旧経路で開き直す」を押すと 3 s 後に `#preview-video` へ `src` が入り、
`data-frame-engine-active` が消えて旧経路へ戻った。

## ready 所要とタイムアウト根拠

環境 A の AFTER / engine ON / cold start では、webview 接続から `#preview-stage` 検出まで 428 ms、
stage 検出から `data-frame-engine-ready="true"` まで 693 ms だった。既定 15,000 ms は ready 実測の
約 21 倍であり、cold start の余裕を十分に持つ。負のコントロールではカードが 14,927 ms で出たため、
15,000 ms タイマーの精度も確認済みである。

## 画素判定

出力 CSS 色 `#0080ff` はスクリーンショットでは `rgb(55,126,247)` になる。表示プロファイル込みの値で、
issue #36 でも pasteboard `#2b2d30` が `rgb(44,45,48)` になった。したがって主判定は CSS 期待色との
絶対差ではなく、断片ルート 2 px 内側の 8 点と、同じ走査軸で 8 px 内側に置いた参照画素の RGB 差
`Δ ≤ 8` とする。CSS 期待値との差は `absoluteDelta` として参考記録に分離する。

6.5 s はオーバーレイが終了済みなので、stage の中心、四隅 8 px 内側、上下中央の計 7 点を測り、
engine canvas が動画を描いていることを確認する。環境 A / AFTER / engine ON の代表値は
`rgb(230,196,74)`、旧経路は `rgb(232,202,77)` だった。

## fixture の作り方

fixture の実体は収蔵しない。`<fixture>` に `sample.mp4`、`edit.json`、`captions.json`、
`overlays/fullscreen.html` を作る。

```sh
mkdir -p <fixture>/overlays
ffmpeg \
  -f lavfi -i 'color=c=#DC2828:s=1920x1080:r=30:d=2' \
  -f lavfi -i 'color=c=#28B450:s=1920x1080:r=30:d=2' \
  -f lavfi -i 'color=c=#2850DC:s=1920x1080:r=30:d=2' \
  -f lavfi -i 'color=c=#E6C828:s=1920x1080:r=30:d=2' \
  -filter_complex '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0,format=yuv420p[v]' \
  -map '[v]' -c:v libx264 -profile:v high -level:v 4.0 -movflags +faststart \
  <fixture>/sample.mp4
```

`edit.json` は v0 の 8 s cut と 0.5–5.0 s の overlay を宣言する。

```json
{
  "version": 0,
  "output": { "width": 1920, "height": 1080, "fps": 30 },
  "source": { "path": "sample.mp4", "proxy": null },
  "cuts": [{ "in": 0, "out": 8 }],
  "overlays": [{
    "id": "fullscreen",
    "html": "overlays/fullscreen.html",
    "start": 0.5,
    "duration": 4.5,
    "transform": { "x": 0, "y": 0, "scale": 1, "rotate": 0 },
    "vars": {}
  }]
}
```

overlay 断片は自身が 1920×1080 を塗るルートにする。

```html
<div style="width:1920px;height:1080px;background:#0080ff"></div>
```

`captions.json` には 1.5–3.5 s の cue を 1 本置く。

```json
{
  "captions": [{
    "id": "c-0001", "start": 1.5, "end": 3.5, "text": "frame engine boot probe",
    "speaker": null, "sourceRef": null, "edited": false
  }]
}
```

## 再実行手順

`run-l1.sh` はリポジトリ、fixture、出力先を必須環境変数で受ける。CDP port は省略時 9645、
Electron と shell は省略時に `<repo>` 配下を使う。

```sh
AKARI_REPO=<repo> \
AKARI_FIXTURE=<fixture> \
AKARI_OUT=<out> \
AKARI_CDP_PORT=9645 \
AKARI_FRAME_ENGINE=1 \
<repo>/apps/shell/extensions/akari-preview/evidence/frame-engine-boot/scripts/run-l1.sh \
  engine-on '{"seekTime":2,"canvasProbeTime":6.5}'
```

engine OFF は `AKARI_FRAME_ENGINE=0`、短縮タイムアウトは
`AKARI_FRAME_ENGINE_READY_TIMEOUT_MS=1` を渡す。fail-loud と fallback の自動往復は options の
`failLoud` を有効にする。

```sh
AKARI_REPO=<repo> \
AKARI_FIXTURE=<fixture> \
AKARI_OUT=<out> \
AKARI_FRAME_ENGINE=1 \
AKARI_FRAME_ENGINE_READY_TIMEOUT_MS=1 \
<repo>/apps/shell/extensions/akari-preview/evidence/frame-engine-boot/scripts/run-l1.sh \
  fail-loud '{"failLoud":true}'
```

別のビルド済み shell / Electron を読む場合は、次の 2 変数で差し替える。対象は読み取り専用で、
探針の workspace と user data は一時ディレクトリに分離される。

```sh
AKARI_ELECTRON=<electron-executable> \
AKARI_SHELL=<built-shell> \
AKARI_REPO=<repo> \
AKARI_FIXTURE=<fixture> \
AKARI_OUT=<out> \
<repo>/apps/shell/extensions/akari-preview/evidence/frame-engine-boot/scripts/run-l1.sh main-ops
```

JSON options では `overlayExpectedRgb`（既定 `[0,128,255]`）、`canvasProbeTime`（既定 6.5）、
`canvasExpectedRgb`（既定 `[230,200,40]`）も上書きできる。出力は
`<out>/<label>-measure.json`、`<out>/<label>-window.png`、`<out>/<label>-canvas-window.png`、
`<out>/<label>-electron.log`。fail-loud 時は `<out>/<label>-fail-loud-window.png` も加わる。
証跡 JSON 内の絶対パスは、書き出し前に `<repo>` / `<workspace>` / `<out>` / `<home>` / `<path>` へ伏せる。

## 環境上の注意

- `theia build` は `node_modules/electron/dist` の stock `libffmpeg` を 1,203,568 B の
  非プロプライエタリ版へ差し替える。H.264 fixture を表示する実測では、build のたびに H.264 decoder を
  含む stock 2,160,944 B 版へ戻してから Electron を起動する。
- macOS の `/tmp` は `/private/tmp` への symlink である。Theia は workspace を実体パスへ正規化するため、
  probe 側の `editUri` だけ symlink パスのままだと「ワークスペース外」判定になる。
  `run-l1.sh` は `mktemp` 後に `pwd -P` で workspace と user data の実体パスを確定する。
