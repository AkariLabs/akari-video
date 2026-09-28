# #111 書き出しで窓の外の 3D を先に読み込まない — L1 証跡

- 基点: `49af07a62`（BEFORE）/ 本ブランチ（AFTER）
- 実測: Windows 11・tier 2 Electron 39.8.7。並走する他の作業と機械を共有していたため、時間は目安
- 数値の全体: `results.json`

## fixture（リポには入れない。再現手順）

- 1280x720・30fps・600 コマ（20 秒）
- 3D 断片 3 つ（`assets/scene3d/smartphone-mockup/model.glb`、`ScreenMaterial` に動画の `materialOverrides`）を
  0〜6 秒・7〜13 秒・14〜20 秒に置く
- 画面動画は ffmpeg の `testsrc2` / `testsrc` / `smptehdbars` から作った 360x640・10 秒の H.264

断片の例:

```html
<div style="position:absolute;inset:0"><canvas style="position:absolute;inset:0;width:100%;height:100%"></canvas><div data-akari-3d-fallback></div><script type="application/json" data-akari-3d-scene>{"model":"overlays/phone.glb","camera":{"position":[0,0,0.45],"lookAt":[0,0,0],"fov":40},"lights":[{"type":"ambient","color":"#ffffff","intensity":0.8}],"materialOverrides":{"ScreenMaterial":{"texture":"assets/screen-a.mp4"}}}</script></div>
```

## sheet-probe.mjs

OSR の書き出しシートだけを offscreen の Electron に載せ、全コマ `__akariSeek` する。
`HTMLMediaElement.prototype.currentTime` の setter を数えて、コマごとにシークした `<video>` の数を取る。

```sh
electron sheet-probe.mjs --wt <worktree> --project <fixture> --out <result.json>
```

## 結果（要約）

| | BEFORE | AFTER |
|---|---|---|
| `__akariReady` 時点で生きている 3D | 3（全部） | 1（t=0 の窓だけ） |
| 同時に生きている 3D の最大 | 3 | 2（窓の重なる 5〜6 秒・12〜13 秒） |
| 1 コマでシークした `<video>` の最大 / 平均 | 3 / 1.95 | 1 / 0.90 |
| シークの総数（600 コマ） | 1,167 | 537 |
| シートだけの全コマ所要 | 156〜205 秒 | 73〜82 秒 |
| 起動時の GPU プロセス / タブのメモリ | 1,924 / 463 MB | 715 / 196 MB |
| OSR 実書き出しのキャプチャループ（stamp 検証） | 235 秒（シーク中央値 314ms） | 137 秒（同 147ms） |
| OSR 実書き出しの出力 | — | BEFORE の正常な回と mp4 がバイト一致 |
| GPU 実書き出しの出力 | — | BEFORE と mp4 がバイト一致 |

既知の差: `AKARI_OSR_VERIFY=off` では AFTER が 600 コマ中 26〜28 コマで 1 コマ前のペイントを掴む（BEFORE は 0）。
既定の stamp 検証が 1 回ずつ再試行し、出力は変わらない。

## r1 差し戻し対応の再計測（`results.json` の `r1`）

r1 で、シークごとに ready を待つ対象を「区間の中（active）の 3D」だけに戻した（契約どおり）。区間の 2 秒手前で生成した 3D の
読み込みは裏で進み、そのコマのシークを止めない。上の表は r0（窓の近傍 = 2 秒手前から待つ実装）の計測で、以下は同じ手順で
fixture を作り直して BEFORE / AFTER を測り直した値。

| | BEFORE | AFTER（r1） |
|---|---|---|
| `__akariReady` 時点で生きている 3D | 3 | 1 |
| 同時に生きている 3D の最大 | 3 | 2 |
| 1 コマでシークした `<video>` の最大 / 平均 | 3 / 1.95 | 1〜2 / 0.90 |
| シークの総数（600 コマ） | 1,167 | 537〜539 |
| シートだけの全コマ所要（2 回） | 85.2 / 57.4 秒 | 35.7 / 33.4 秒 |
| 起動時の GPU プロセス / タブのメモリ | 1,902〜1,904 / 461〜462 MB | 732〜760 / 196 MB |
| OSR 実書き出しのキャプチャループ（stamp 検証） | 131 秒（シーク中央値 180ms） | 72 秒（同 97ms） |
| OSR の stamp 再試行 | 0 / 600 | 28 / 600 |
| `AKARI_OSR_VERIFY=off` の 1 コマ遅れペイント | 0 / 600 | 14 / 600 |
| GPU 実書き出し | 76.7 秒 | 81.2 秒（出力は BEFORE とバイト一致） |

- 先読み中の 3D の画面動画は、読み込みの途中（区間の 1.7 秒ほど手前）で DOM に入る。そのとき 1 回だけ 0 秒へシークされるので、
  シーク総数が 2 増える回があり、1 コマの最大が 2 になる回がある
- OSR の出力: この fixture では AFTER が BEFORE とバイト一致しない。600 コマ中 60 コマ（3D の無い 6〜7 秒・13〜14 秒）は一致、
  残りは最小 PSNR 55.03 dB（全コマ 45 dB 以上）。r0 のコミットでこの fixture を書き出すと r1 とバイト一致するので、差は r1 の
  待ち方の変更ではなく、窓式マウント（同時に生きている 3D が減る）から来ている。原因の特定は未了
- stamp 検証と `AKARI_OSR_VERIFY=off` の出力は、BEFORE 同士・AFTER 同士でそれぞれバイト一致した
