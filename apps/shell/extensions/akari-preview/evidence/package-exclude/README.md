# package-exclude 検証証跡（パッケージから evidence を除外）

electron-builder の `build.files` に `!**/evidence/**` を追加し、各拡張の検証証跡
（255 ファイル・約 64MB）を配布パッケージ（app.asar）から除外した際の実測記録。
検証スクリプト（verify-asar-contents.mjs）には「asar 内 evidence 0 件」チェックを追加した
（500MB 上限は据え置き・緩和なし）。

## L0 実測値（mac-arm64 / electron-builder --dir）

- `npm run package` + postpackage: GREEN（拡張 8 種 / skills / schemas / templates 同梱確認込み）
- アプリサイズ実測: **409MB ≤ 500MB**（除外前は 505MB で配布ゲート FAIL）
- `asar list` 独立実測: 総エントリ 11,824 / `/evidence/` に一致するエントリ **0 件**
- 拡張 8 種すべて `/node_modules/akari-*/` として同梱維持（各 6〜23 ファイル）
- `/lib/{skills,schemas,templates}/` 79 エントリ同梱維持
- ソース中に `evidence` ディレクトリへの runtime 参照が無いことを grep で確認
  （ヒットはコメント 3 箇所のみ・実行時参照ゼロ）
- 本ディレクトリ（新規 evidence）を置いた状態で再パッケージし、除外パターンに
  乗ること（asar 内 evidence 0 件のまま）を再実測

## L1 パッケージ版スモーク（生 CDP・除外がランタイム無影響であることの確認）

パッケージ版アプリを CDP ポート付きで起動し、一時ディレクトリ上の検証プロジェクト
（テンプレート由来の `.akari/` + testsrc2 6 秒 1280x720 動画 + 自作極小 cube.glb 1,488 bytes +
3D overlay fragment）を開いて実測:

| ファイル | 内容 |
|---|---|
| `01-packaged-app-preview-playing.png` | パッケージ版起動 → プロジェクトオープン → プレビュー再生中（t≈4.9s・カラーバー動画 + 赤立方体 3D overlay 同時表示） |
| `02-packaged-preview-video-3d-cube.png` | ツリーから source.mp4 をダブルクリックで開いた直後（t=0）。動画 + 3D 立方体表示 |

- webview 内実測: `video.readyState = 4`（HAVE_ENOUGH_DATA）・videoSize 1280x720・
  3D canvas 408x230 実寸あり・`data-akari-3d-fallback` 非表示（= glb ロード完了）
- 立方体はライト宣言（ambient + directional）込みの宣言型 3D overlay。CDN 参照なし

## 検証手順上の既知事項（本タスクの変更とは無関係・記録のみ）

初回オープン同意ゲート導入後は、`.akari/` を持たないワークスペースを自動起動で開くと
同意通知（`messages.info`）の応答待ちが `onStart` 内で await され、シェル未アタッチのため
通知が描画されず起動が完了しない。自動検証では検証プロジェクトに `.akari/`（テンプレート由来）を
含めてプロジェクト判定を通すこと。
