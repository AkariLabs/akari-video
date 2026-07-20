# three-look-parity 検証証跡

3D ルック整備（環境ライティング IBL + トーンマッピング）の L0/L1 実測記録。
検証はパッケージ版アプリ（`electron-builder --dir` 出力）+ 生 CDP、export は `render-cut` CLI
（HyperFrames 経路）を用いた。比較対象の 3 モデル（laptop-slim-aluminum /
phone-pro-titanium / smartphone-mockup）は、いずれも設計時レンダー（Blender 側の想定ルック）が
存在する検証プロジェクトを別途用意し、同一カメラアングル・同等ライティング構成で
before（IBL 導入前のコード）/ after（本タスクの実装）を両方レンダーして比較した。

## look-comparison/

- `<model>-before.png` / `<model>-after.png`: 3D canvas 単体（透過背景）を
  `canvas.toDataURL()` で直接キャプチャ（アプリウィンドウのスクリーンショットではなく
  GPU フレームバッファの直接読み出し）。before は `git stash` で IBL 実装前のコードへ
  一時的に戻し、`resources/scripts/copy-native-helpers.mjs`（overlay-runtime を
  `lib/` へ反映するスクリプト）を明示実行してから同一プロジェクトを開き直して撮影。
  同一カメラ・同一ライト宣言・同一モデルで、差分は IBL（環境マップ + ACES Filmic
  トーンマッピング）の有無のみ
- 目視結果: 3 モデルとも after で本体表面に環境の映り込みに由来する階調・ハイライトが
  乗り、before の完全フラットな単色塗り（金属が灰色平板化する不具合の再現）から
  明確に改善している。特に laptop / phone（procedural PBR・metalness 高）で差が顕著
- `phone-after-in-app-context.png`: パッケージ版アプリの実 UI 全体（素材ツリー + プレビュー
  タブ）内で 3D overlay が表示されている様子（実機で撮った証跡）
- `non-3d-overlay-and-caption-regression.png`: 非退行証跡（HTML overlay の title +
  captions.json の字幕が t=0.5 で同時に表示されている）

## wysiwyg/

- `<model>-export-frame-t<N>.png`: render-cut（HyperFrames 経路）で書き出した mp4 から
  同時刻のフレームを ffmpeg で抽出したもの
- `<model>-masked-diff.png`: preview canvas キャプチャを出力解像度へ拡大し、その alpha を
  マスクとして export フレームの同一領域だけを比較した ImageMagick `compare` 結果
  （赤 = 差分。背景の色帯テスト映像はマスク対象外）
- 実測 MAE（0–1 正規化・±1% 基準に対する実測値）: laptop 0.00316（0.316%）/
  phone 0.00182（0.182%）。差分の性質はプレビュー解像度 → 出力解像度の拡大時のリサンプル +
  H.264 量子化で、モデル位置・輪郭は完全一致（`masked-diff.png` にゴースト無し）

## environment-knob/

3d.md に文書化した `environment.{intensity,exposure}` knob が実際に効くことの実測。
既知の制限（下記）によりパッケージ版 preview では明示宣言が読み込めないため、
`render-cut` 経由の export で確認した（export は明示宣言も正しく解決する — 別経路のため
既知の制限の影響を受けない）。同一モデル・同一カメラ・同一ライトで `environment` の
`intensity`/`exposure` だけを変えた 2 バリアントを書き出し:

- `intensity-0.1-exposure-0.3.png`: 暗め設定
- `intensity-3.0-exposure-2.0.png`: 明るめ設定
- `diff.png`: 上記 2 枚の ImageMagick `compare`（MAE 0.113 = 11.3%・knob が明確に効いている）

## packaging-log.txt

L0（build:ext / lint / node --check / render-cut test 13件 / npm run package + postpackage /
409MB ≤ 500MB / asar 内容バイト一致）の実測ログ。

## l1-results.json / l1-run-log.json

パッケージ版アプリに対する生 CDP ドライバの実測結果（ルック比較の readiness・決定性
ハッシュ・materialOverrides・dispose サイクルのメモリ推移・HTML overlay/captions・
fallback・`interaction.selftest()`）。

## 決定性（本 README 外・report.md に実測値あり）

- preview: 同一時刻（t=11 の phone）を 2 回レンダー（別時刻へ退避 → 復帰）し、
  `canvas.toDataURL()` の SHA-256 が完全一致
- export: `render-cut` を同一プロジェクトに対し独立に 2 回実行し、出力 mp4 の SHA-256 が
  完全一致（バイト一致）

## 既知の制限（本タスクの境界外・修正なし・指摘のみ）

`data-akari-3d-scene` の `environment` キーは `packages/overlay-runtime/src/three-runtime.js`
側では許可済みだが、preview 側の別経路（拡張の src、本タスクの編集禁止範囲）に
同キーの許可一覧が独立して存在し、そちらが未対応のままだと `environment` を明示宣言した
オーバーレイの model パスが preview 側でだけ解決に失敗する（export は別経路のため無関係）。
`environment` を省略した場合は既定値（intensity 0.5 / exposure 1.0）で IBL が preview / export
とも常に有効なため、本タスクの受け入れ条件（3 モデルの金属質感改善）はこの制限の影響を
受けない。恒久対応は当該許可一覧へ `environment` を追加する 1 行の変更（該当ファイルは
編集禁止範囲のため本タスクでは未実施）。
