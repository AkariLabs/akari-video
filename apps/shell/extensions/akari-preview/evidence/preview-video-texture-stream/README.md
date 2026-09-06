# preview-video-texture-stream 検証証跡（asset stream URL の拡張子保持）

Electron tier 2 の shell ライブプレビューへ CDP で接続し、動画テクスチャを使う phone と、
画像テクスチャを使う app-icon を BEFORE / AFTER で比較した。
**BEFORE は phone が error、AFTER は ready / videoTextures 1 となり、時刻による描画変化も確認できた。**

L1 の実測値は [results.json](./results.json) の `before` / `after` を正とする。
同ファイル（計測値・console・操作 log）と下記 PNG 4 点がラッパーによる実機走行の生記録。
両モードの `ok` は `true`（走行完了）で、BEFORE の phone の `error` は対照実験の期待結果である。
環境・ビルド履歴・L0・事前診断はラッパー提供の記録による。

## 環境・フィクスチャ

- macOS（Darwin 25.2.0 / arm64）、Electron **39.8.7**、CDP の product は両走行とも
  **Chrome/142.0.7444.265**。worktree の `node_modules/electron/dist` は tier 2、`path.txt` 敷設済み。
- 実施日: 2026-09-06 JST。`results.json` の開始時刻は BEFORE `2026-09-05T20:59:54.819Z`、
  AFTER `2026-09-05T21:34:26.092Z`（UTC）。
- 他レーンと同居し、走行中の load average は **80〜320**。
  CDP・行探索・起動オーバーレイ消失・フレーム探索は最大300秒、Theia 主ページと CDP protocol は600秒、
  overlay mount・3D status 確定は180秒、汎用 `waitFor` の既定は120秒に設定している。
- 毎回 `mkdtemp` で `akari l1 検証-XXXX/プレビュー 検証プロジェクト` を生成する。
  素材・編集データの書き込み先はスクラッチのみ。リポジトリへの出力は本ディレクトリの証跡のみで、
  オーナー案件への書き込みはない。
- `base.mp4` は ffmpeg の testsrc2 + sine から生成（1080×1920 / 30fps / 6秒、H.264 + AAC）。
  phone の `model.glb` / `screen.mp4`、app-icon の `model.glb` / `icon.png`、
  `panel-12.html` / `appicon-free.html` はオーナー案件 `2026-08-07-akari-reel` から読み取りコピーのみ。
  コピー元は `AKARI_OWNER_PROJECT` で指定可能。
- `edit.json` は version 2、1080×1920 / 30fps。base は0〜6秒、phone と app-icon は1〜5秒に配置。
- 起動フラグ: `--remote-debugging-port` / `--user-data-dir`（スクラッチ）/ `--no-sandbox` /
  `--disable-background-timer-throttling` / `--disable-backgrounding-occluded-windows` /
  `--disable-renderer-backgrounding`。

## 再現手順

[run-l1.mjs](./run-l1.mjs) を、対象ビルドを用意した後に **BEFORE → AFTER の2回に分けて**実行する。
`--mode` は計測結果の保存先を選ぶもので、ビルドを切り替える機能ではない。

1. BEFORE は分岐点 main **f15440dc** のビルドを用意する。実走行では `apps/shell/lib` の
   03:33 の Theia バンドルを使い、`apps/shell/lib/backend/main.js` の URL が
   `/asset/${i}`（拡張子なし）であることを確認してから実行した。
2. AFTER は本ブランチの `apps/shell` で `npm run build`
   （`build:ext` + `theia build --mode production`）が exit 0。
   同バンドルの URL が `/asset/${i}${n.extension}` であることを確認してから実行した。

各対象ビルドで、リポジトリルートから URL 形式を確認する例:

```sh
rg -o '/asset/\$\{[^}]+\}(\$\{[^}]+\})?' apps/shell/lib/backend/main.js
```

証跡ディレクトリで実行するコマンド（2行はそれぞれ対応するビルドで実行）:

```sh
node run-l1.mjs --mode before
node run-l1.mjs --mode after
```

- 各回は自分の Electron を起動・終了し、既定ではスクラッチを削除する。`--keep` で保持可能。
  CDP ポートの既定は BEFORE 9743 / AFTER 9744（`--port` で変更可能）。
- `results.json` は既存の別モードを保持してマージする。同じモードの再走行はそのキーを更新する。
- 計測場所は preview webview の `/webview/fake.html?id=akari-output-preview-...` フレーム。
  `[data-overlay-id]` コンテナを渡した `window.akari.threeRuntime.inspect(container)`、
  宣言内の実 URL、fallback 可視性、console を読む。
- t=2.0秒 / t=3.5秒にシークする。phone は1秒開始のため、canvas 計測のローカル時刻は1.0秒 / 2.5秒。
  `render()` 直後に `drawImage` で canvas を複製し、FNV-1a 32bit ハッシュと非透明画素数を取得する。

## L1 の地雷・開通経路

- **`.theia-preload` が画面全体を覆っている間は、実マウスのクリックが飲み込まれる。**
  ラッパーの事前診断では、素材パネルに行があっても `document.elementFromPoint(x, y)` が
  `DIV.theia-preload` を返した。`page.mouse.click` 後40秒待っても iframe は0個で、
  「出力プレビュー」タブも出なかった。`waitForInteractive` で
  `document.querySelector('.theia-preload') === null` を最大300秒待つ。
- 素材パネルの行は出力が増えると動く。事前診断では edit.json の y が **438 → 413** に変化した。
  クリック直前に矩形を取り直し、`elementFromPoint(x, y).closest('[data-akari-output-path="edit.json"]')`
  が対象行であることを確認する。
- `#preview-stage` は外側の **`/webview/index.html` ではなく `/webview/fake.html`** に入る。
  `findPreviewFrame` は `/webview/` を優先し、URL の末尾で絞らず `#preview-stage` の存在で採用する。
  webview の `evaluate` は CSP 対策として文字列式で渡す。
- 実クリック後60秒以内に webview が現れなければ、座標を取り直して最大3回再試行する（初回込み4回）。
  それでも開かなければ `element.click()`、次に developer mode の Explorer 経路へ進む。
  歯車などの Explorer 操作も `waitForInteractive` を通す。
- 実走行の `log` では、BEFORE は **実マウス1回目**、AFTER は **実マウス4回目**で開通。
  両方とも `edit-json-opened.via = "assets-panel-real-mouse"`。
  `element.click()` / Explorer フォールバックは使われなかった。
- 初回の `theia-interactive-wait.waitedMs` は BEFORE **19383**、AFTER **33084**。
  AFTER の1〜3回目は各60秒の webview 出現待ちでタイムアウトした記録が残る。
- フレーム探索失敗時は、全フレームの URL / preview-stage / window.akari / readyState / body 長と、
  主ページの iframe の src / class / 幅高を例外と `results.json` の log に残す。

## L1 BEFORE 実測（results.json の before）

- phone（t=2.0秒）: **status `"error"` / videoTextures 0 / animationClips 0**、
  `materialOverrides: []`、`fallbackVisible: true`、`fallbackHiddenAttr: false`、canvas **300×150**。
- ScreenMaterial の実 URL は **拡張子なし**:
  `http://127.0.0.1:64618/asset/53eea746d6f79087d67d748e7f73185e06c553d24322c048894653ed3a3d5a0e`。
- model の実 URL:
  `http://127.0.0.1:64618/asset/4c5924a5d5f0ebc673d7e900196ebecb48576706f487039dd129b10e24dd7b0a`。
- preview の `threeConsoleLines` に
  **`[akari-three] 3D scene の読み込みに失敗しました Event` が1行**。
  `pageConsoleAkariThree` にも対応するエラーが1行ある。
- app-icon（icon.png）: **status `"ready"` / animationClips 1**、fallback 非表示、canvas 405×720。
  `IconFaceMaterial` は `applied: true / video: false`。画像テクスチャは BEFORE でも通る。
- phone の canvas ハッシュは t=2.0秒 / t=3.5秒とも **`8c1ab045`**、非透明画素数はともに **0**。
  `canvasHashesDiffer: false`。t=3.5秒でも phone は error / videoTextures 0。
- 舞台は両時刻とも `frameEngineActive: true`、`from: "frame-engine-canvas"`、canvas **1080×1920**。
  160×284 のサンプルで非黒画素 **45440 / 45440**。

## L1 AFTER 実測（results.json の after）

- phone（t=2.0秒）: **status `"ready"` / videoTextures 1 / animationClips 1**、
  `fallbackVisible: false`、`fallbackHiddenAttr: true`、canvas **405×720**。
- `materialOverrides` は
  `{name: "ScreenMaterial", applied: true, resolvedFrom: "literal", brightness: 1, emissiveIntensity: 1, video: true}`。
- ScreenMaterial の実 URL は **.mp4 付き**:
  `http://127.0.0.1:49507/asset/f8fccc767d5584b5b893ce033f099d3f265e5e3f689bae32a4c956035f262ca2.mp4`。
- model の実 URL:
  `http://127.0.0.1:49507/asset/2f4dee07f2d9f50cce4c7198429ac7e552db6fd0a9a2651daadb1db7a51457ca.glb`。
- **3D 読み込み失敗行は0件**。`threeConsoleLines` / `pageConsoleAkariThree` はともに空。
- app-icon は **status `"ready"` / animationClips 1 / fallback 非表示**を維持（画像テクスチャの非退行）。
  texture URL は
  `http://127.0.0.1:49507/asset/fd74774f02710ea2a31e2337e9a6ffec860aa8a52ad0af9eedf3638e145a228a.png`。
- phone の canvas ハッシュは t=2.0秒 **`a00ea46b`（非透明35095画素）** と
  t=3.5秒 **`735defbb`（非透明35296画素）**で異なり、`canvasHashesDiffer: true`。
  VideoTexture を含む3D描画が時刻で変化している。t=3.5秒でも **ready / videoTextures 1**。
- 舞台は両時刻とも frame-engine-canvas 1080×1920、160×284 のサンプルで非黒画素 **45440 / 45440**。
  base.mp4 の描画は非退行。`#preview-video` 自体は readyState 0 / videoWidth 0 であり、
  この走行の舞台描画の確認元は有効な frame-engine canvas である。

## スクリーンショット（生記録）

- [before-phone-error.png](./before-phone-error.png): BEFORE・t=2.0秒・fallback 可視。
- [after-phone-ready.png](./after-phone-ready.png): AFTER・t=2.0秒。
- [after-phone-canvas-2x.png](./after-phone-canvas-2x.png): AFTER・t=2.0秒の3D canvas を2倍拡大した複製。
- [after-t3.5.png](./after-t3.5.png): AFTER・t=3.5秒。

## L0（参考・ラッパー提供の実行記録）

- `apps/shell` で `npm run build:ext` exit 0 / `npm run lint` exit 0。
- `apps/shell/extensions/akari-preview` で `node --test test/*.test.mjs`:
  **tests 638 / pass 637 / fail 0 / cancelled 1**。
  cancelled は `preview-captions.test.mjs` の10k RPC レースの180秒タイムアウト。
  ラッパーは load average 200超の同居負荷が原因で、本票の変更とは無関係と報告している。
- 新規 `test/asset-stream-url.test.mjs` は **14 / 14 PASS**。
