# cut に分類された素材の crop / perspective / keyframes をプレビューへ運ぶ — L1 証跡

2026-08-21 の render-path unification 以降、`source.kind: 'media'` のアイテムは
**段（トラック）の位置に関係なく** crop / perspective / keyframes が書き出される
（`packages/render-cut/src/cut-transform.mjs`）。一方でシェルの cut summary は
それらを運んでいなかったため、同じアイテムが cuts に分類されると
**プレビューだけ無変形**になっていた。この証跡はその修正の実測記録である。

## 測り方（L1 = 実機 Electron + CDP）

1. `templates` ではなく最小プロジェクトを一時領域へ作る（`scripts/prepare-fixture.mjs`）。
   出力 640x360 / 30fps、素材は `ffmpeg -f lavfi -i testsrc2` で作った 6 秒の mp4。
2. 対象アイテムは 1 つ。crop `{0.25,0.15,0.5,0.6}` / perspective corners
   `[[0.08,0],[0.92,0],[0,1],[1,1]]` / transform keyframes（x -120→120・scale 0.6→1.2）。
3. **分類の作り分け**: アイテムを 1 本だけ置くと `cuts`、同じ `at`/`duration` の兄弟を
   1 つ足すと `computeOverlappingItemIds` が両方を掴んで `layers` になる
   （`packages/edit-store/src/internal-model.ts`）。兄弟は `transform.x` を大きくして
   キャンバス外へ出し、絵に寄与させない。**宣言はどちらも同一**。
4. Electron を `--remote-debugging-port` 付きで起動し、webview の実行コンテキストへ
   アタッチして 0.5 / 2.0 / 3.5 秒の実 DOM（inline style・computed style・dataset）を読む。
5. 書き出しは `render-cut` を実走させ、フレームを 1 枚ずつ raw で取り出して
   「黒でない中身」のバウンディングボックスを画素から測る。

## 実測結果

| 観測 | 結果 |
|---|---|
| 修正前・cuts 分類 | `640x360 / left 0 / top 0 / clip-path なし / transform なし`（**無変形**） |
| 修正後・cuts 分類 | t=2.0 で `576x324 / left 320 / top 180 / transform-origin 50% 45% / clip-path inset(15% 25% 25%) / matrix3d(...)` |
| 修正後・layers 分類（同一宣言） | 上と **文字列まで完全一致**（3 時点すべて。matrix3d・clip-path 含む） |
| keyframes の追従 | シークでも再生でも線形補間に一致（再生中 14 サンプルで scale/x の誤差 < 1e-3） |
| 書き出しとの一致 | 3 時点とも preview 実 DOM 由来の可視矩形と実レンダー画素の bbox が **1.5px 以内** |
| 中身の一致 | 実レンダーの可視矩形とソースの crop 領域の PSNR = 24.3 / 33.4 / 30.2 dB（対照: 10% ずらした crop では 4.8 dB） |
| perspective の書き出し側パラメータ | `computePerspectiveFfmpegCorners` の出力とフィルタ文字列が一致（共有関数を通っている） |
| 段替わりの非退行 | crop 付き cut の次に素の cut を置くと、素の側は `640x360 / clip-path なし / object-fit contain` へ戻る |
| transition 窓モデルの非退行 | `evidence/transition-first-class-l1/scripts/run-l1.sh` を同じビルドで再実行 → 5 種すべて PASS |

数値の実体は `measurements.json`、見た目の対比は `before-cut-classified.png` /
`after-cut-classified.png`（どちらも t=2.0）。

## 再実行

```sh
apps/shell/extensions/akari-preview/evidence/cut-visual-fields-preview/scripts/run-l1.sh <media.mp4>
```
