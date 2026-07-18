# three-fallback-fix 検証証跡（Wave 16a — 3D fallback「読み込み中」残存バグの根治）

パッケージ版（electron-builder --dir / mac-arm64）へ生 CDP で接続し、実 UI 操作
（素材レール → ツリー展開 → 動画ダブルクリック）で検証した。実測の生記録は
`run-log.json`（ASSERT_PASS/FAIL）を正とする。最終走行は **28/28 PASS**。

## 修正内容（対象: overlay-runtime の three-runtime `setFallback()`）

`hidden` 属性のみの非表示は UA スタイル `[hidden]{display:none}` 頼みのため、
fragment 側 CSS が fallback に `display`（flex/grid 等）を宣言すると author CSS が UA に勝ち、
load 完了後も fallback が残る。修正は非表示時
`style.setProperty('display','none','important')` / 表示時 `style.removeProperty('display')`
のインラインスタイル保証（`hidden` 属性の設定は温存）。

## 検証フィクスチャ（検証用一時ワークスペース・リポ外・検証後削除）

- バグを再現する**装飾付き fallback** を宣言した 3D overlay fragment 3 種:
  - `spin3d`: `display:flex` + 4px 破線 border + 半透明背景（正常 glb、t∈[2,8)）
  - `broken3d`: `display:grid` + 4px 実線 border + 半透明背景（**内容が不正な glb**、t∈[12,18)）
  - `missing3d`: `display:block` + 3px 破線 border + 半透明背景（**存在しないパスの glb**、t∈[12,18)）
- HTML overlay（`cta`、t∈[0,20)）+ captions.json（前半/後半 2 エントリ）同居の両立フィクスチャ
- 検証素材 `cube.glb`（1,952 bytes）は手書き生成の極小 glTF（立方体 + `Spin` クリップ =
  Y 軸回転 0→360°/4 秒 LINEAR。依存ゼロ生成スクリプト・外部ライセンス依存なし）
- 動画は ffmpeg testsrc2 生成（1280x720/30fps/20 秒）

## L1 実測（run-log.json より）

1. **(a) load 完了で消える**: t=3 で `status: ready` になった時点で
   `getComputedStyle(fallback).display === "none"`（インライン `display:none !important` を実測）+
   `hidden === true`。スクショ `01-loaded-no-fallback-t3.png` で立方体のみ・枠なしを目視確認
2. **(b) load 中は表示**: seek 直後の同期読みで `status: loading` かつ `display === "flex"`
   （author 宣言の display で表示。再入サイクルでも同一観測）
3. **(c) error では表示される**:
   - 内容不正 glb → `status: error` + `display === "grid"`（author 宣言）+ `hidden === false`
   - 存在しないパス → 初期化失敗経路でも fallback `display === "block"` で表示
   - スクショ `02-broken-glb-fallback-visible-t13.png`（赤枠・黄枠とも表示）
4. **(d) 可視区間外→dispose→再入（2 サイクル実測）**: t=10 で `status: disposed` +
   fallback は author display (`flex`) に復帰（インライン除去を実測）→ 再入 t=3 で
   `loading`/`flex`（再表示）→ `ready`/`none`（再消滅）。両サイクとも全 PASS。
   スクショ `03-after-reentry-cycles-t3.png`
5. **非退行**:
   - 3D 描画: canvas 206x177 に非透明ピクセル 6,722・renderer.info triangles 12 / calls 1・pixelRatio 1
   - 決定的同期（同一時刻 = 同一描画）: 全ピクセル FNV ハッシュで local 1.0s `6f20e200` ≠ 3.5s `36d2d478`、
     local 1.0s 再描画で `6f20e200` を**完全再現**。再入後インスタンスでも同様（`2b978fa0` を再現）
   - HTML overlay 可視 + 実寸あり / captions 前半・後半とも表示

## 対照実験（修正前実装のパッケージ版・同一フィクスチャ。control-run-log.json）

- **バグ再現**: load 完了（`status: ready`）後も `hidden === true` のまま
  `getComputedStyle(fallback).display === "flex"` で fallback が残存。
  スクショ `04-prefix-control-fallback-stays-t3.png`（立方体の上にオレンジ枠が残る = オーナー報告事象）
- **非退行の厳密照合**: 修正版の描画ハッシュ（`6f20e200` / `36d2d478` / `75f151f8` / `2b978fa0`・
  opaque 数含む）は修正前実装と**全てビット一致** = 本修正が 3D 描画・時刻同期へ与えた影響ゼロを実証

## 補足（既知事項・本修正と無関係）

- dispose→再生成をまたぐと、同一 local 時刻でも初回インスタンスと再生成インスタンスの
  描画ハッシュが異なる（`6f20e200` vs `2b978fa0`、canvas 同寸）。**修正前実装でもビット一致で
  再現する既存事象**（control-run-log.json）で、各インスタンス内の決定性（同一時刻 = 同一描画）は
  両者とも成立する。エクスポート側 3D 対応（未実装・予約済み）の設計時に確認が必要
