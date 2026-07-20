# evidence — three-look-parity（3D ルック整備: IBL + トーンマッピング）

パッケージ版アプリ（electron-builder 出力・asar 内 three-runtime.js / three-bundle.js が
ソースとビット一致することを確認済み）を生 CDP で駆動して実測した検証証跡。
検証プロジェクトは隔離ワークスペース（ダークグレー背景動画 1280x720/30fps/5s +
3D オーバーレイ 4 + HTML テロップ 1 + captions.json。edit-lint PASS・warning 1 件のみ）。

比較の正解参照は各モデルの**設計時レンダー**（Blender プロシージャルスタジオリグによる
recipe プレビュー画像）。「同等アングル・同等ライティング風」で preview 実機レンダーと並置した。

## 証跡の由来（2 系統）

本ディレクトリには独立した 2 系統の検証証跡がある:

1. **本 README + 直下の画像** — タスクレーン（codex ラッパー）本体の実測。実装レーン自身による
   受け入れ条件の全実測（本 README に記載の数値はすべてこちら）
2. **`recovery-lane/`** — 実装コミット時に並走した headless 復旧レーンによる独立実測
   （レーン生存誤認により先行コミットされたもの。方法論が一部異なる:
   before 撮影を stash 戻しで実施・独自検証プロジェクト）。独立した第 2 の検証としてそのまま保存。
   ただし同 README の「render-cut（HyperFrames 経路）」という記述は誤り —
   3D overlay を含む export の実測経路は **hyperframes rejected → puppeteer-core adopted**
   （render.json provenance と render-cut テストの仕様どおり。本レーンの実測でも同じ）

## 画像一覧

| ファイル | 内容 |
|---|---|
| `compare-laptop.png` | 設計時レンダー vs preview 実機（アルミラップトップ、IBL 既定値） |
| `compare-phone.png` | 設計時レンダー vs preview 実機（チタンフォン、IBL 既定値） |
| `compare-smartphone.png` | 設計時レンダー vs preview 実機（スマホモックアップ + materialOverrides 画面差し替え） |
| `before-after.png` | 現行(main)/IBL 後の同条件対照 2x2（laptop / phone。before は main のパッケージ版 = 旧 runtime とビット一致を確認の上で撮影） |
| `envknob-export.png` | export（render-cut）での environment knob 実効対照（既定 vs `{intensity:1.6, exposure:1.3}`） |
| `wysiwyg-diff-laptop-x8.png` | WYSIWYG 差分の 8 倍増幅可視化（laptop・差分がエッジ帯に局在することの証跡） |
| `full-ui-preview-laptop.png` | 実 UI 全景（素材ツリー → source.mp4 を開いた preview タブに 3D 表示） |

## L0（静的・機械的）実測

- prebuild / build:ext / lint / `node --check`（three-runtime.js・overlay-runtime.js・three-bundle.js）すべて exit 0
- `npm run package` GREEN・**409MB ≤ 500MB**（postpackage ゲート PASS・拡張全数同梱）
- vendor バンドル増分: 774,553 → **776,523 bytes（+1,970 bytes / +0.25%）**。three@0.185.1 固定のまま
  RoomEnvironment を追加（バンドル内 THREE.REVISION=185・AkariThree exports に RoomEnvironment を実測確認）
- render-cut テスト **13/13 PASS**（非 3D シートのバイト同一テスト含む）
- asar 内 `three-runtime.js` / `three-bundle.js` がソースと **sha256 ビット一致**
- 決定性の静的確認: three-runtime.js に乱数・wall-clock 参照なし（grep 0 件）。
  RoomEnvironment/PMREM は createInstance 時に **1 回だけ生成**し、環境シーンと
  PMREMGenerator は生成直後に dispose、レンダーターゲットは instance dispose 時に解放

## L1-1 ルック比較（本タスクの肝）

- 3 モデルとも金属質感（映り込み・階調）が設計時レンダーと「別物に見えない」水準まで改善
  （並置画像で判定可能。完全一致は要求外）
- before/after の不透過画素平均輝度（同一宣言・同一カメラ）:
  - laptop: **25.9 → 77.1**（旧: 暗い灰色平板 / 新: アルミの階調と映り込み）
  - phone: **3.2 → 17.1**（旧: ほぼ黒い塊 / 新: チタンレールのハイライト + ガラスの映り込み）
  - smartphone: 159.3 → 155.5（画面 emissive 支配のため微差 — ボディ光沢の映り込みは目視で改善）
- renderer.info.memory.textures: before 1 → after 2（PMREM 環境テクスチャの存在を実測）

## L1-2 決定性

- preview: 同一時刻 2 回レンダーの**全ピクセル SHA-256 一致**(3 モデルとも。IBL 導入後も決定的)
- export: render-cut CLI 同一入力 2 回 → **mp4 ファイル sha256 一致**(d6887d11…) +
  **デコード全フレーム rgb24 sha256 一致**(53c16413…)。出力 1280x720/30fps/150 frames

## L1-3 既存非退行

- materialOverrides: ScreenMaterial 差し替え画像が preview / export 両方で正表示（compare-smartphone.png）
- fallback: ready で消灯（hidden=true）・dispose で復帰・再マウントで再消灯を実測
- dispose サイクル: 区間外 tick で dispose（status disposed）→ 再入場で ready 復帰。
  memory (13 geometries / 2 textures) が往復で不変 = リーク無し
- **再マウント描画の同一性**: dispose 後に canvas 属性サイズが残った状態からの再生成でも
  フレッシュ時と**全ピクセルハッシュ一致**（旧実装に存在した camera.aspect 陳腐化バグの修正を実証。
  修正前は再マウント後 aspect=1 のまま横に歪む — 本タスクの検証で発見し rendererSize で同期するよう修正）
- interaction.selftest(): **ok=true**（合成ドラッグ 57.92px = 期待値一致・拡縮 1.5446 = 期待値一致・
  overlayWrite 実書き込みが edit.json に反映されることも確認）
- HTML テロップ + captions: t=4.5 で preview 表示（data-akari-active 付与・caption plate 文言表示）、
  export フレームにも両方焼き込み

## L1-4 WYSIWYG（preview×export 同時刻比較・不透過マスク内 MAD）

| モデル | raw MAD | 判定 |
|---|---|---|
| phone (t=1.5) | **0.406%** | ±1% 内 |
| smartphone (t=2.8) | **0.575%** | ±1% 内 |
| laptop (t=0.5) | 1.336%（canvas 1280x720 等倍撮影） | 超過 — 内訳を実測し原因特定（下記） |

laptop 超過分の内訳実測:

- **面部（エッジ帯除外）: MAD 0.862% = ±1% 内**。金属の質感・階調は preview / export で一致
- 超過は **1px エッジ帯**（キーキャップ約 80 個の格子 + ベゼル輪郭）に完全局在
  （`wysiwyg-diff-laptop-x8.png`）。原因は preview（GPU）と export（SwiftShader ソフトウェア GL）の
  AA サブピクセル位相差 + h264 量子化
- h264 量子化の全画面一様シフトは**背景（3D 非描画領域）単体でも DC (-2,-1,0)/255** を実測 —
  3D ランタイム起因ではない測定系の下駄
- 参考: 先行 WYSIWYG 実測（テクスチャ差し替えタスク）の対象だった smartphone は本実測でも
  raw 0.575% と基準内。laptop はキーキャップ格子という高周波形状を持つ初の WYSIWYG 対象で、
  超過はレンダラ間 AA 差の測定系要因（質感 parity は面部実測で担保）

## environment knob

- runtime 実効の実測（laptop・宣言 `environment.intensity` 掃引）: 0.1 → 輝度 39.4 / 0.5 → 77.1 / 1.0 → 107.2
- **export E2E**: 宣言 `{intensity:1.6, exposure:1.3}` の overlay が同一モデル既定値比で
  平均輝度 **16.84 → 57.87**（envknob-export.png）— render-cut は宣言キーを透過し knob が焼き込みに実効
- 既定値は実測に基づき **intensity 0.5 / exposure 1.0**（未指定でも金属が良く見える値。
  RoomEnvironment は白い部屋の手続き環境のため 1.0 では明色金属が白飛びする — 実測掃引で確認）
- **既知の統合ギャップ（本タスク境界外・followup 要）**: preview ホスト拡張の宣言 allowlist
  （THREE_SCENE_KEYS）に `environment` が未追加のため、preview では environment キーを宣言した
  fragment が弾かれ fallback 表示になる（export は正常）。allowlist への 1 語追加で解消する。
  既定値（宣言なし）はこのゲートに掛からず preview / export 両方で同一に効く
