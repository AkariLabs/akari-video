# Inspector refresh L1

このスクリプトは、**明示的に実行すると隔離した Electron を起動する**実機検証用です。
実機測定の成否と実測値は、実行後の `results.json` を参照してください。
`inspector-section-collapse/scripts/` の CDP 接続・実クリック・スクリーンショット・終了処理を流用しています。

## 実行前

- Node.js（グローバル `WebSocket` / `fetch` が使える版）。既存のL1と同様、Playwright追加インストールは不要。
- 対象 `apps/shell` の依存と **Electron 実体、フロントエンドを含むビルド**が必要。
  `build:ext` だけではアプリのバンドルが更新されません。ビルド・起動環境の準備はラッパー側で行います。
- `ffmpeg` と `libx264` が必要。`FFMPEG` 環境変数、対象ツリーの
  `packages/media-bin/vendor/<platform>-<arch>/ffmpeg`、PATHの `ffmpeg` の順で探します。
- CDPポートが使用中なら失敗します。既存のアプリへ接続したり、そのPIDを停止したりしません。

リポジトリのルートから実行する例:

```sh
# AFTER: このスクリプトが置かれたworktreeのapps/shellを使う
AKARI_CDP_TIMEOUT_MS=180000 node apps/shell/extensions/akari-annotations/evidence/inspector-refresh/scripts/l1-inspector-refresh.mjs --port=9456 --label=after

# BEFORE: 別ツリーにあるビルド済みアプリを使う
AKARI_CDP_TIMEOUT_MS=180000 node apps/shell/extensions/akari-annotations/evidence/inspector-refresh/scripts/l1-inspector-refresh.mjs --port=9456 --label=before --shell=/absolute/path/to/before/apps/shell

# 出力先も指定する場合（before/afterは順番に実行する）
AKARI_CDP_TIMEOUT_MS=180000 node apps/shell/extensions/akari-annotations/evidence/inspector-refresh/scripts/l1-inspector-refresh.mjs --port=9457 --label=after --out=/absolute/path/to/evidence/after
```

| 引数 | 既定値 | 意味 |
| --- | --- | --- |
| `--port=` | `9456` | 起動するElectronのCDPポート |
| `--shell=` | スクリプト所在worktreeの `apps/shell` | 絶対パス必須。Electronもこのディレクトリの `node_modules/electron/path.txt` と `dist/` から解決 |
| `--label=` | `after` | `before` または `after` |
| `--out=` | `evidence/inspector-refresh/<label>` | 既定値はスクリプト所在worktree基準。明示した相対パスは実行時cwd基準 |

起動・Theia読込とffmpegはそれぞれ最大10分、通常のUI待機はCDPタイムアウトの2倍（最低180秒）です。
高負荷環境では実行例どおり `AKARI_CDP_TIMEOUT_MS=180000` を指定します（UI待機は360秒）。
接続のclose/errorでは未完了要求を即座に解放します。CDP要求・接続・HTTP探索のタイムアウトは流用ライブラリの `AKARI_CDP_TIMEOUT_MS`（既定10000ms）で変更できます。

## 隔離とfixture

`os.tmpdir()` 配下に `mkdtemp('inspector-refresh-l1-')` 相当で1ディレクトリを作ります。
その直下へ `akari-home`（`AKARI_HOME`）、`theia-config`（`THEIA_CONFIG_DIR`）、
`user-data`（Electronの `--user-data-dir`）、`project` を配置します。
対象 `--shell` のリポジトリにある `templates/project-default` をコピーし、
ffmpegで別々に3秒・30fpsのMP4を2本生成します。生成・API課金操作は実行しません。

`edit.json` はversion 2で、映像トラックに `clip-a` / `clip-b` を配置します。
`at` / `duration` / `keyframes[].t` はフレーム、`source.in` / `source.out` は秒です。
`clip-a` の `transform.x` は `t = 0, 30, 60, 90` に4点、`clip-b` はKFなし。
書式の根拠は次の既存実装・テストです。

- `packages/edit-store/src/edit-v2.ts` の `KeyframeV2`
- `packages/edit-store/test/tree-ops.test.mjs` の `setKeyframe` / `moveKeyframe`
- `test/timeline-keyframe-rows.test.mjs`

空の字幕と、比較画面用の時刻付き注釈1件もfixtureに書きます。
本番プロジェクトや設定には触れません。通常終了・例外・SIGINT/SIGTERM時は、
**自分がspawnしたElectronのChildProcess/PIDだけ**へSIGTERM、必要ならSIGKILLを送り、停止後に隔離ディレクトリを削除します。
PIDが停止しない場合は削除せず失敗として記録します。プロセス名検索やプロセスグループkillは使いません。

## 操作と観測点

1. **テーマ**: TheiaのDIから `ThemeService` を取得し、登録テーマの `type` が
   `dark` / `light` のものを選んで `setCurrentTheme(id, true)` を呼びます。
   これは通常の `workbench.colorTheme` 設定経路で、保存先も隔離設定です。
   CSS変数やクラスの直接上書きでテーマを偽装しません。
2. **選択と画面**: `timeline:cut:0` をCDP `Input.dispatchMouseEvent` で実クリックします。
   `akari.inspector.open` / `akari.review.open` で双方を表示し、インスペクター単体と画面全体を保存します。
   同時表示できる配置なら比較スクリーンショットを1枚、同じ右パネルのタブなら注釈の単体・全体を別に保存します。
   ファイル名には `dark` / `light` が入ります。
   レンダラーのviewportはpage接続の `Emulation.setDeviceMetricsOverride` で1440×1000に固定します。
   pageターゲットでは使えない `Browser.getWindowForTarget` / `Browser.setWindowBounds` は呼びません。
3. **幅**: `ApplicationShell.resize(width, 'right')` を呼び、
   `rightPanelHandler.state.pendingUpdate` と描画2フレームを待ちます。
   `getPanelSize()`・dock幅・インスペクター実幅も記録し、要求値との誤差は2px以内を確認します。
   要素のstyle.widthだけを変える操作はしません。下段タイムラインの高さも同じAPIで440pxにします。
4. **全タブ**: 両テーマ × 240/300/360/420pxで、アプリが有効にしている全タブを実クリックし、
   セクション・detailsを実クリックで展開します。disabledタブは一覧と理由を記録し、無理に有効化しません。
   ルートと、縦横いずれかのcomputed overflowが `auto` / `scroll` / `overlay` の全スクロール要素を測定します。
   非表示要素も数値を記録しますが幅assertは表示中のものに適用します。
   `overflow: hidden/clip` の省略ラベルなどはスクロールUIではないため別の `clipped` 配列へ記録します。
   **ルートはhidden指定でも必ずassert対象**です。
   各KF列を縦にスクロールして表示し、横scrollLeftを0に戻してから4ボタンのrectを測り、
   KF列とルートの両方に収まることを確認します（rectの境界許容差0.5px）。
5. **reveal**: AFTERは `inspector-kf-more:transform-x` を実クリックし、
   `inspector-kf-jump:transform-x` のenabledを観測して実クリックします。
   BEFOREでは同じjump属性を持つ直接ボタンを使います。`clip-b` ではjumpがdisabledであることを記録します。
   タイムラインの `[data-akari-keyframe-property-row="clip-a:transform.x"]` が表示領域にあり、
   `akari-timeline-keyframe-property-selected` が付き、
   `selectionModel.keyframeSelection` が対応するitem/property/timesを指し、
   `focusScope.rootId` が `clip-a` であることを観測します。
   `handleKeyframeControl('reveal')` / `scrollTimelineKeyframeRowIntoView()` と
   `test/inspector-kf-jump.test.mjs` が根拠です。検証スクリプトからreveal handlerを直接呼びません。
6. **打点と前後移動**: クリップを実クリックで選択した後、再生ヘッドのハンドルをCDPの実ポインタ操作で1.5秒へドラッグします。
   ルーラークリックによる選択解除・再選択は避け、既存 `onPlayheadHandlePointerDown` の操作で選択を保ちます。
   `akari.timeline.playhead` が目標時刻で安定したことを確認してから打点を始めます。
   `inspector-kf-seat:transform-x` を2回実クリックし、保存された `edit.json` を毎回読み直して
   点数の `N → N+1 → N` と該当フレームの追加・除去を確認します。
   前後移動は既存 `aria-label="前のキーフレームへ"` / `"次のキーフレームへ"` を使用し、
   `akari.timeline.playhead` コマンドから出力秒を読み、保存済み点のフレーム÷30と照合します。
   時刻が変わっただけでは次へ進まず、保存結果・選択モデルの更新と描画完了を待ちます。
   次のクリックが非同期で移動した別ボタンへ当たらないようにし、実際のpointerdown/click対象も記録・検証します。
   再生ヘッド・選択モデルへの直接代入はしません。

Theiaサービスの取得だけは手本と同様に `window.theia.container._bindingDictionary` を参照します。
識別はサービスの既存メソッドで行い、タイムラインの状態とDOMは読み取りだけに使います。
展開用の一時的な `data-inspector-l1-expand` 属性以外、検証都合でUIやスタイルを書き換えません。

## 結果

- `<out>/results.json`: 引数、fixture、テーマ、全幅・全タブの測定値、ボタンrect、操作結果、判定、cleanup。
- `<out>/*.png`: テーマごとの単体・全体・比較画面、メニュー、reveal後のタイムライン。
- AFTER: 不合格を記録しながら他ケースも測定し、最後に不合格があれば `status: fail`・非ゼロ終了・`failure.png`。
- BEFORE: 新しい見出し帯・メニュー・幅対策などの不一致で測定を打ち切らず、
  `checks[].passed` と `enforced: false` を残して `status: observed` で終了します。これはPASS宣言ではありません。
- 起動不能など共通の準備失敗はBEFOREでも非ゼロ終了です。CDP接続前の起動失敗では実スクリーンショットは撮れないため、
  `failureScreenshotError` に理由を記録します。画像を捏造して補いません。

匿名化対象ルートのcanonical pathは実行ごとにキャッシュし、文字列ごとのファイルシステム照会は行いません。
JSONの文字列は保存前に再帰処理し、選択ツリー・スクリプト所在ツリーを `<WORKTREE>`、
ホームを `<HOME>`、一時ディレクトリを `<TMP>` に置換します。カスタム出力先も論理的なevidenceパスへ置換し、
`options.out` は結果ファイルからの相対表記 `.` にします。ログ全文ファイルは出力せず、失敗時のみ末尾を匿名化してJSONに含めます。
PNGは実画面のままです（外観検証用なので画像中の文字は加工しません）。

再実行時は既存の `results.json` と同名PNGを上書きします。比較に残す出力先は `--out` で分けてください。

構文確認だけを行う場合（Electron・ffmpegは起動しません）:

```sh
node --check apps/shell/extensions/akari-annotations/evidence/inspector-refresh/scripts/l1-inspector-refresh.mjs
node --check apps/shell/extensions/akari-annotations/evidence/inspector-refresh/scripts/cdp-lib.mjs
```
