# L1 証跡 — 全画面 canvas のオーバーレイの内容枠と当たり判定

再現手順（リポジトリ直下から）:

```sh
cd apps/shell && npm run build          # lib/ が無いときだけ
cd - && node dev-fixtures/overlay-content-box-canvas-hit/run-l1.mjs --label after
```

ドライバは一時ディレクトリに隔離プロジェクト（`assets/base.mp4` を ffmpeg で生成 + 断片 2 本 +
3D 文字用フォント）を組み、`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` をすべて一時
ディレクトリに向けて本物の Electron シェルを起動する。終了時に Electron を kill し一時
ディレクトリを消す。BEFORE は `packages/overlay-runtime/src/{interaction,three-runtime}.js` を
基点 `3f74b798`（v0.1.60）へ戻して同じドライバを走らせたもの。

## 測定値（`l1-before.json` / `l1-after.json`）

| 断片 | 版 | 選択枠 / コンテナ | 内容クリック | 透明部クリック |
|---|---|---|---|---|
| canvas-center（全画面 canvas に中央だけ 3D 文字） | before | 1.000 × 1.000 | オーバーレイ選択 | **オーバーレイのまま（下の素材を奪う）** |
| canvas-center | after | **0.559 × 0.189** | オーバーレイ選択 | **カット選択（下の素材が選べる）** |
| telop-center（`inset:0` 中央寄せ div のテロップ） | before | 1.000 × 1.000 | オーバーレイ選択 | カット選択 |
| telop-center | after | **0.300 × 0.113** | オーバーレイ選択 | カット選択 |

before の verdict = FAIL、after の verdict = PASS。3D は両版とも `threeRuntime.inspect().status === 'ready'`
（= 描画自体は before から動いており、変わったのは枠と当たり判定だけ）。

## PNG

- `before-canvas-center-content-click.png` — 選択枠が画面全体（報告どおりの症状）
- `after-canvas-center-content-click.png` — 選択枠が 3D 文字に縮む
- `after-canvas-center-transparent-click.png` — 透明部クリックで下のカットの選択枠（青）が出る
- `before-telop-center-content-click.png` / `after-telop-center-content-click.png` — テロップ側の同じ対比
- `before-telop-center-transparent-click.png` / `after-telop-center-transparent-click.png` — 透明部は両版ともカット選択（テロップは「枠だけ」の症状）
