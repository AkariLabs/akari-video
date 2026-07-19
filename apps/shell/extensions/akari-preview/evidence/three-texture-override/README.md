# evidence — 3D テクスチャ + スクリーン差し替え（materialOverrides）

検証環境: macOS (arm64) / パッケージ版アプリ（electron-builder --dir 出力・473MB）へ生 CDP 接続 /
export は render-cut CLI（puppeteer-core 経路・Chrome 150 + SwiftShader）。
検証プロジェクトは空白 + 日本語入りパスの一時ディレクトリに自作フィクスチャで構築
（公開資産 `assets/3d/smartphone-mockup/model.glb` は読み取りコピーのみ・無改変）。
差し替え画像は自作のスクショ風 PNG 1080x2340（TOP/BOTTOM/L/R 文字 + 四隅色マーカー
橙TL・シアンTR・緑BL・黄BR + 中央ピンク AKARI ヒーロー）。

## ファイル一覧

| ファイル | 内容 |
|---|---|
| `preview-canvas-override-t1.0.png` | preview（パッケージ版）3D canvas 画素の直接取得。ScreenMaterial 差し替え済み。TOP 上・BOTTOM 下・L 左・R 右・四隅マーカー正位置 = 上下左右・非ミラー・色とも正 |
| `preview-window-override-t1.0.png` | 同・実 UI 全景（ツリー → source.mp4 を選択 + Enter で開いた preview タブ・再生バー 0:01/0:03） |
| `preview-canvas-embedded-only-t1.0.png` | materialOverrides 無し。glb 埋め込みテクスチャ（placeholder 画面 + 本体）が CSP 下で表示される実証 |
| `preview-canvas-unknown-material-t1.0.png` | 存在しないマテリアル名指定時: 画面は placeholder のまま（差し替え不発）・モデル表示は継続 = 警告 + 劣化許容 |
| `preview-window-anim-t1.8.png` | CSS transform アニメ（translateX + rotate 8deg）併用。差し替え画面が本体に完全追従 |
| `preview-window-multi-t1.0.png` | スマホ（差し替え済み）+ 立方体の 2 overlay 同時表示 |
| `preview-window-non3d-t1.0.png` | 非退行: HTML テロップ + captions.json 字幕の preview 表示（3D 無し） |
| `export-frame-override-t1.0.png` | render-cut 書き出しフレーム t=1.0。スマホ画面に差し替え画像が正しい向き・色で焼き込み |
| `export-frame-embedded-only-t1.0.png` | オーバーライド無し書き出し。埋め込み placeholder が data URI シートで表示 |
| `export-frame-anim-t0.4.png` / `export-frame-anim-t2.0.png` | アニメ併用書き出し 2 時刻。差し替え画面が transform に追従して前進 |
| `export-frame-non3d-t1.0.png` | 非退行: テロップ + 字幕焼き込み（新旧実装で全画素一致） |
| `export-frame-cube-t1.0.png` | 非退行: テクスチャ無し立方体 + Spin clip（新旧実装で全画素一致） |

## 実測値サマリ

- **CSP 実証（契約の最優先実証事項）**:
  - ユーザー画像（TextureLoader = `<img>` 経路）: `img-src <stream origin> blob: data:` の追記で通る
    （Image 直接ロード実測 ok・1080x2340 取得）
  - **glb 埋め込みテクスチャは `img-src` では通らない**: three r185 の GLTFLoader は埋め込み
    テクスチャを ImageBitmapLoader = `fetch(blob object URL)` で読むため **`connect-src` に
    `blob:` が必要**。無い状態では `fetch(blob:)` が Failed to fetch でブロックされ、
    GLTFLoader の graceful degradation により**テクスチャだけが静かに欠落**
    （emissiveMap 不在 → materialOverrides の UV channel 継承も不発 → TEXCOORD_0 アトラスで
    回転表示になる劣化を実測）。→ 最小追記: `connect-src <stream origin> blob:`（外部 origin 追加なし）
  - 追記後の CSP 実測値: `default-src 'none'; media-src <origin>; connect-src <origin> blob:; img-src <origin> blob: data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'`
  - 追記後 renderer.info.memory.textures が 2 → 4（埋め込み 2 枚 + 差し替え分がロードされた実測）
- **UV / フリップ / 色**（スマホモックアップ実測）: `ScreenMaterial` は emissiveTexture
  texCoord=1（TEXCOORD_1 = 全面 0..1）。TEXCOORD_0 はアトラス部分領域（u 0.12–0.94 / v 0.68–0.99）。
  差し替えテクスチャは既存 emissiveMap の channel/wrapS/wrapT を継承（flipY=false・SRGBColorSpace）。
  preview canvas 画素実測: 橙TL(460,70)・シアンTR(678,70) 同列、緑BL(460.5,569.5)・黄BR(678.5,569.5)
  同列、ピンク hero 中央(568,215) = 上下左右・ミラー無し・色相正
- **決定性**: 同一入力 2 回書き出し → デコード全フレーム rgb24 sha256 一致 + **ファイルバイトも一致**
- **WYSIWYG**（preview 3D canvas を 1280x720 へ拡大し、不透過画素マスク内で export フレームと比較。
  t=0.6/1.0/2.0 の 3 時刻）: raw MAD 0.856% / DC シフト (0.14, 1.0, 0.9) / DC 除去後残差 0.743% =
  **±1% 基準内**。差分性質はプレビュー縮小表示 → 1280 再拡大のリサンプル + h264 yuv420p 量子化
- **複数 3D tick 予算**: スマホ(2 calls/1668 tris) + 立方体(1 call/12 tris) の 2 overlay を
  120 回連続 render → **0.347ms/tick**（30fps 予算 33.3ms の約 1%）
- **非退行**: 非 3D（テロップ + captions）と立方体 3D の書き出しを旧実装（main HEAD）と
  新実装で実行 → **デコード全フレーム sha256 一致**（バイト同一原則維持）。
  render-cut シート生成の非 3D バイト同一はユニットテストでも固定
- **未知マテリアル名**: `console.warn "[akari-three] materialOverrides の対象が見つかりません: <名前>"`
  を実測捕捉。status は ready のままモデル表示継続（エラーにしない劣化許容）
- L0: build:ext / lint exit 0・node --check 3 ファイル OK・render-cut テスト 13/13 PASS・
  `npm run package` postpackage GREEN・**パッケージ 473MB ≤ 500MB**・asar 内 three-runtime.js が
  ソースとビット一致
