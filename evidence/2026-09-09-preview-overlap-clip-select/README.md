# preview-overlap-clip-select — L1 証跡（2026-09-09）

重なったクリップのうち **上のクリップ**を出力プレビューで選べる・選択枠が出る・ドラッグが
その item 自身に書かれることを、実 Electron シェルで観測した記録。

## 再現手順

```sh
cd apps/shell && npm run build          # build:ext + theia build
AKARI_L1_LABEL=after node evidence/2026-09-09-preview-overlap-clip-select/run-l1.mjs
```

`run-l1.mjs` は一時ディレクトリに隔離プロジェクト（`AKARI_HOME` も一時ディレクトリ）を作り、
ffmpeg で 640x360 / 30fps / 9 秒の素材を 1 本生成して **同じ動画を 3 トラックに重ねる**:

| トラック | item | 区間 | transform |
|---|---|---|---|
| V1 | `base-item` | 0–8s | 等倍・全画面（`cuts` に残る） |
| V2 | `mid-item` | 0–8s | scale 0.6（重なりで `layers` へ退避） |
| V3 | `top-item` | 4–8s | scale 0.35（重なりで `layers` へ退避） |

CDP の `Input.dispatchMouseEvent` で実マウスを出力プレビューへ落とし、選択枠 (`#layer-select-box` /
`#cut-select-box`)・タイムライン側の選択クラス・`edit.json` の transform を読む。
Electron は 1 本だけ起動し、終了時に PID 指名で kill してプロファイルパスで残存 0 件を確認する
（`leftoverProcesses`）。

`e_hide_metadata` / `c_hide_metadata` の段は、engine 経路の台帳 `<video>`（`preload='metadata'`）に
metadata が届いていない状態＝本件の根本原因を、台帳要素の `videoWidth` / `videoHeight` を 0 に
固定して決定論的に再現している（`src` は触らないので error → `display:none` の別経路には落ちない）。

## 結果（BEFORE = 基点 3f74b798 / AFTER = 本コミット）

| 段 | 観測 | BEFORE | AFTER |
|---|---|---|---|
| a | metadata あり・2 本重ね・中央クリック | `mid-item` 選択・枠 199.2x112.0 | 同じ（不変） |
| b | タイムラインで `mid-item` を選択 | 枠が出る | 同じ（不変） |
| d | metadata あり・3 本重ね・中央クリック | `top-item` 選択・枠 116.2x65.4 | 同じ（不変） |
| e | **metadata 無し**・2 本重ね・中央クリック | **下の cut が選ばれる**（`cut-select-box` / タイムライン `0`） | `mid-item` 選択・枠が出る |
| f | **metadata 無し**・3 本重ね・中央クリック | **下の cut が選ばれる** | `top-item` 選択・枠が出る |
| g | 重なりの無い左端（base だけ）をクリック | cut 選択 | 同じ（不変） |
| c | metadata 無しで選択して 100px 右へドラッグ | **`base-item.x` が 192.77 へ**（下のクリップに書かれる） | `mid-item.x` が 192.77 へ・`base-item` / `top-item` は 0 のまま |

100 画面 px = 192.77 出力 px（ステージ倍率 0.51875）。枠も `left` 102.4 → 202.4 と 100px 追従する。

`webviewExceptions` に残る `PressureObserver` の NotAllowedError は Chromium の権限ポリシー由来の
既存ノイズで、本件とは無関係（BEFORE / AFTER 双方に出る）。

## ファイル

- `run-l1.mjs` — L1 ハーネス（検証専用。製品コードではない）
- `before-observations.json` / `after-observations.json` — 生の観測値（作業機の絶対パスは置換済み）
- `before-*.png` / `after-*.png` — 各段の出力プレビュー（ステージ矩形のみ）
