# GPU カラオケ塗りの実機比較

`karaoke.fill` の `char` / `word` / `smooth` と `start_index`・`done_color` を組み合わせた字幕 6 本を比較した証跡。試験映像は 1280×720・30 fps、字幕は各 3 秒。`render-cut --engine auto` は **gpu** を採用し、launcher tier 2・RTX 5060 で書き出した。`GPU export is ineligible` の警告は出ていない。同じ試験を `--engine osr` でも書き出し、字幕区間の全 **540 フレーム**を比較した。

GPU 出力には色のタグがないため、双方を **BT.709（tv）** として復号した。既存の GPU⇔OSR 一致テストに合わせ、塗りの重心差を ±0.002、矩形差を ±0.007（いずれもフレーム比）、塗り面積比を 0.9〜1.1 または面積差を文字画素の 0.5% 以下として判定した。画素の平均絶対差は 0〜255 の尺度。

## 修正後の結果

| 字幕 | 指定 | 許容内 | 平均絶対差の最大 | 塗り重心差の最大 | 塗り幅差の最大 | 塗り面積比 |
|---|---|---:|---:|---:|---:|---:|
| c-0001 | char + done_color | 90/90 | 0.169 | 0.0013 | 0.0008 | 1.003〜1.058 |
| c-0002 | word + start_index 2 | 89/90 | 0.178 | 0.0016 | 0.0008 | 0.84〜1.004 |
| c-0003 | smooth + done_color + start_index 1 | 89/90 | 0.176 | 0.0019 | 0.0071 | 0.938〜1.068 |
| c-0004 | fill なし + start_index 4 | 78/90 | 0.187 | 0.0167 | 0.057 | 0.749〜1.016 |
| c-0005 | smooth + done_color（お手本と同じ指定） | 89/90 | 0.188 | 0.0018 | 0.0024 | 0.899〜1.048 |
| c-0006 | char + start_index 5 + done_color | 88/90 | 0.177 | 0.0011 | 0.0039 | 0.848〜1.009 |

全体では **523/540 フレーム**が許容内。フレームごとの値は [fill-fixture-summary.json](fill-fixture-summary.json)、各字幕の見比べ画像は [sheets/](sheets/) にある。

許容外の内訳は次のとおり。

1. 字幕の出だしのフェード（字幕内 1〜3 フレーム目）で、塗り済み文字の画素数に差が出る。これは既存のフェードの不透明度差で、GPU/OSR のインク比 **0.91 / 1.013 / 0.97** は修正前の基点でも同じ。
2. c-0004 の語の途中は、`fill` を指定しない従来の線形の色変化による差。[legacy-baseline-summary.json](legacy-baseline-summary.json) は `fill` / `start_index` を外した同じ試験を origin/main `dd88554e9` のコードで書き出した基点で、全字幕の同じ区間（語の途中）が許容外だった。
3. c-0003 の 40 フレーム目は塗り幅差 **0.0071**（許容 0.007 の境）。c-0005 の 12 フレーム目は塗り面積比 **0.899**（塗り始めの小さな面積）。

## 境目の時刻と見た目

1 µs の時刻許容を入れる前の [fill-fixture-summary-before-r2.json](fill-fixture-summary-before-r2.json) では、c-0002 の **33・63** フレーム目、c-0006 の **51・57** フレーム目で、語・文字の切替が GPU だけ 1 フレーム遅れていた。修正後は境目ちょうどのフレームも一致する。

`smooth` には文字の縁だけ既知の画素差がある。OSR は素の色の文字の上に `::after` の塗り色の文字を重ねるため、塗り済み部分の縁に素の色がわずかに残る（二重描画）。GPU は塗り色の 1 枚で描く。目視では同一で、[sheets/](sheets/) と [demo-frame945-osr-gpu.png](demo-frame945-osr-gpu.png) で確認できる。

初回ガイドのお手本 c-0020（`smooth` + `#FB923C`）も、この修正の gpu-export で `--engine auto` → **gpu** 採用、tier 2・RTX 5060、警告なし・PASS・**40 秒**。字幕の帯（フレーム **918〜978**）では、塗り色の画素数比 GPU/OSR が **0.984〜1.022**、塗りの右端の差はフレーム比で **≤ 0.0078**。比較した OSR は前段（修正前）の書き出しで、数値は [demo-karaoke.json](demo-karaoke.json) にある。

## 再現と環境

[scripts/fixture.mjs](scripts/fixture.mjs) が試験プロジェクトを作り、[scripts/render.sh](scripts/render.sh) が隔離して書き出し、[scripts/compare.mjs](scripts/compare.mjs) が全フレームを比較する。比較時は **`MATRIX709=1`** を設定する。`render.sh` はこの worktree のパスを参照し、`AKARI_HOME`・HOME・TMP を `C:\t\gkf` 配下に隔離する。

```bash
node scripts/fixture.mjs /c/t/gkf/fixture
bash scripts/render.sh /c/t/gkf/fixture/project auto /c/t/gkf/auto.log
bash scripts/render.sh /c/t/gkf/fixture/project osr /c/t/gkf/osr.log
MATRIX709=1 node scripts/compare.mjs /c/t/gkf/fixture/project/exports/out-osr.mp4 /c/t/gkf/fixture/project/exports/out-auto.mp4 /c/t/gkf/comparison.json --sheet-dir=/c/t/gkf/sheets
```

この機械では worktree の `electron.exe` が Intel UHD に載り、ハードウェア H.264 が使えない。実測時は HKCU を書かずに `ELECTRON_OVERRIDE_DIST_PATH` で同版 **39.8.7** の RTX 割り当て済み dist を借り、`render-cut` に `--gpu-preference off` を渡した。
