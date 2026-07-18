# preview-3d 検証証跡（Wave 15 — 3D overlay プレビュー描画 + 決定的時刻同期）

パッケージ版（electron-builder --dir / mac-arm64 / Electron 39.8.7 / Chrome 142）へ生 CDP で接続し、
実 UI 操作（左レール → ツリー展開 → 動画ダブルクリック → 実マウス/実キーイベント）で検証した。
検証プロジェクトはオーナー実プロジェクトの複製（**空白 + 日本語入りパス** `検証 3d ワークスペース/test_1 検証コピー`）。
オリジナルへの書き込みなし。検証素材の `cube.glb`（2,272 bytes）は手書き生成の極小 glTF
（立方体 + `Spin` クリップ = Y 軸回転 0→360° / X 平行移動 -0.6→+0.6 の 4 秒 LINEAR。外部ライセンス依存なし）。
3D overlay は `start:2 / duration:6`、HTML overlay（subscribe-cta）と captions.json を同居させた両立フィクスチャ。

すべての実測値は `run-log.json`（ASSERT_PASS/FAIL の生記録）を正とする。最終走行は **20/20 PASS**。

## L0（パッケージ検証）

- rsync node_modules → prebuild symlink 8 拡張確認 → `build:ext` exit 0 → `lint` exit 0 →
  `npm run build` exit 0 → `npm run package` exit 0（postpackage の asar 検証 GREEN）
- アプリサイズ実測: **473MB ≤ 500MB**
- asar list 実測: 拡張全 8 種（akari-preview 79 エントリ）+ `lib/overlay-runtime/three-runtime.js` +
  `lib/overlay-runtime/vendor/three-bundle.js` + `vendor/three-LICENSE.txt` 同梱を確認
- vendored `three-bundle.js`（774,553 bytes、three r185 = three@0.185.1）: governance 4 パターン grep clean、
  CDN 参照ゼロ。npm キャッシュの tarball integrity が README 記載値
  `sha512-5aojFCXKwnjBRZvUnt3WFfEcvUJgkN5LlijRFN95hMy8WVkG4I0QNcJE+OuWvuJ0bOdStrbfXn0pkd6/QyiAlg==` と一致することを実測

## L1 アサーション（run-log.json より）

1. **静的描画**: t=3s で canvas 291x194 に非透明ピクセル **11,591 個**（`render()` 直後の drawImage 複製で実測）。
   `renderer.info`: calls 1 / triangles 12。`02-static-3s.png`
2. **決定的時刻同期**: 全ピクセル FNV ハッシュで実測。
   - runtime レベル: local 0.5s = `c8e36e03` 系 ≠ local 3.5s、同一時刻の再 render は**ハッシュ完全一致**
   - シーク往復: t=2.5s `c691fde4` ≠ t=5.5s `1b357d70`、t=2.5s へ戻すと **`c691fde4` を完全再現**。
     `03-anim-t2_5.png` / `04-anim-t5_5.png`
3. **dispose**: 可視区間外（t=10s）へのシークで `inspect().status === 'disposed'`（5 サイクル全て）。
   再入時の `renderer.info.memory` は **geometries [1,1,1,1,1] / textures [1,1,1,1,1] で増加なし**。`05-disposed-t10.png`
4. **pixel ratio**: `renderer.getPixelRatio() === 1` 固定（canvas 実寸 291x194 = CSS 寸 × 1）
5. **非退行**: HTML overlay（subscribe-cta）可視 + 実寸あり / captions 字幕「ということでね、…」表示 /
   `interaction.selftest()` **ok:true**（nw drift 0.00006px）/ スペースキーで再生⇄停止（実 CDP キーイベント。
   `08-after-space-toggle.png`）/ シークは全手順で実施
6. **interaction（3D overlay）**: canvas への実クリックで選択 + 選択枠表示（`06-3d-selected.png`）、
   実マウスドラッグ +80px（クライアント）で `--x` が **169.536**（= 80 ÷ stageScale 0.471875、期待値と 1e-13 一致）、
   edit.json へ transform 永続化を実測（`07-3d-dragged.png`）
7. **CSP / ネットワーク**: 全ターゲットの `Network.requestWillBeSent` を全走行分収集。
   http(s) リクエストの origin は **webview ホスティング（*.webview.localhost）とストリームサーバー（127.0.0.1）の
   2 種のみ**で、外部（非 loopback）リクエスト **0 件**。glb は `/asset/<id>` 経由で **14 リクエスト全て 200**
   （空白 + 日本語パスのプロジェクトで動作）

## 補足（既知事項）

- selftest を owner 断片 `subscribe-cta.html` に対して走らせると FAIL する（nw drift 40.9188px）。
  これは**本タスク以前からの断片起因の既存事象**: 当該断片がルート要素自身にも
  `translate(var(--x)) scale(var(--scale))`（origin: left bottom）を宣言しており、ランタイム所有の
  コンテナ transform と二重適用になるため。**3D 変更なしの main 側パッケージ版でもビット一致の
  drift 40.91891765732172px を再現**し、interaction.js の計算値自体は理論予測と完全一致（≦1e-13）で正しいことを
  計装実測で確認済み。整形断片（本 3D overlay）では drift 0.00006px で PASS。
- スクリーンショットの一部でウィンドウが 1600x1000 相当なのは CDP Emulation によるビューポート指定のため。
