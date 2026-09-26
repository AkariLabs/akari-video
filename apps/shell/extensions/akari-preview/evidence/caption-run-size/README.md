# 「選択文字を大きく」で字間が詰まる — 実機 L1 の証跡

タスク: `task/2026-09-26-caption-run-size`（契約: 字幕の文字範囲（run）の `scale` を上げたとき、字送り・行・枠も一緒に広がり、プレビューと書き出しで同じ見た目）。

実機: 専用の CDP ポート 9626・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`（名前に `caption-run-size` を含む）。
出力 1280×720。操作は CDP の実マウス・実キー（ダブルクリックで文字編集 → 範囲をなぞる → ミニツールバーの「選択文字を大きく」を押す → Escape で抜けて測る）。
px はプレビュー上の CSS px（映像の枠 = 出力の約 0.7125 倍）。BEFORE は変更前のビルド（基点のコード）、AFTER は最終ビルド。
書き出しは render-cut（`AKARI_EXPORT_ALLOW_DESKTOP=0` = worktree の Electron・`launcher_tier: 2` を `export-*.json` に記録）。BEFORE の書き出しは基点のコードを別ディレクトリへ展開して走らせた。

## ファイル

| ファイル | 内容 |
|---|---|
| `scripts/gen-fixture.mjs` | fixture（4 秒刻み 5 本）: (a) 話した言葉「今日はいい天気」/ (c) "Hello World" / (b) 置いた文字 `text_anchor: tc`・`position.y` のみ（折り返し幅なし・`wrap_width_pct: 30`）/ (d) 字幕全体 `text_style.scale: 1.5`（角のつまみの保存値）。映像は ffmpeg |
| `scripts/scenarios.mjs` | 字幕・時刻・なぞる範囲 |
| `scripts/l1.mjs` | L1 本体。「大きく」を累計 1・3・5 回押し、そのたびに各文字の矩形・隣との隙間・行 / プレート / 選択枠を測る。最後に選択を外して各字幕の中点を撮る |
| `scripts/export.mjs` / `scripts/compare.mjs` | 書き出し（GPU / OSR）→ 同じ時刻のフレーム → プレビューと並べて文字の画素の外接矩形を比べる |
| `scripts/cdp-lib.mjs` / `l1-lib.mjs` / `view-lib.mjs` | caption-runs-edit-ui の L1 の小道具の写し（`/json/list` の待ち時間だけ 30 秒へ延長） |
| `results-{before,after}.json` | プレビューの実測（`chars[].box` = 見えている矩形・`run.layoutWidth` = 変形前のレイアウト幅・`gapFromPrev` = 隣との隙間） |
| `export-{before,after}-{gpu,osr}.json` / `compare-{before,after}.json` | 書き出しの記録と比較 |
| `{before,after}-<key>-x<N>.png` | 「大きく」N 回後の出力プレビュー（選択中） |
| `{before,after}-compare-<key>.png` | 上から プレビュー / GPU / OSR（字幕の帯を切り出し） |

## BEFORE — 原因（実測）

run の `scale` は `applyCaptionRunsToHtml`（edit-store。プレビュー・render-cut・GPU / OSR の 3 経路が共有）が
`display:inline-block; … transform: translateY(…) rotate(…) scale(s)` で描いていた。
`transform` は描画だけを拡大し、レイアウト上の字送りは等倍のまま（span の `offsetWidth` は 1.5 倍でも 38 = 1em）。

| (a)「いい」 | 「い」の見えている幅 | 隣との隙間（は↔い / い↔い / い↔天） | 行・選択枠の幅 |
|---|---|---|---|
| 等倍 | 27.07 | 0 / 0 / 0 | 212.26 |
| 1 回（1.1） | 29.78 | −1.35 / −2.71 / −1.36 | 212.26 |
| 3 回（1.3） | 35.20 | −4.06 / −8.12 / −4.06 | 212.26 |
| 5 回（1.5） | 40.61 | −6.77 / −13.54 / −6.77 | 212.26 |

- (c) "llo" も同じ（1.5 倍で e↔l −2.14・l↔l −4.27・l↔o −6.36・o↔空白 −4.23）
- (b) 置いた文字: 折り返し幅なしのプレートは出力の 92%（839.04）に張り付き、折り返し幅 30% も幅・高さとも不変（1.5 倍で 273.6×42.77 のまま・隙間 −6.77 / −13.53）
- (d) 字幕全体の 1.5 倍は隙間 0（詰まらない。対象外）
- 書き出しも同じ詰まり方（`before-compare-a.png`）。折り返し幅 30% の置いた文字は、プレビューが左寄せ・書き出しが中央で横 0.31 ずれていた（run と無関係の既存の差）

## AFTER — 受け入れ条件の実測（最終ビルド・全 5 字幕を実 UI で操作・押し直し 0 回）

| 字幕 | 1 / 3 / 5 回の run の font-size | 隣との最小の隙間 | 行・選択枠の幅 × 高さ |
|---|---|---|---|
| (a) 話した言葉 | 41.8 / 49.4 / 57px | 0 | 212.26×42.77 → 217.68×42.77 → 228.51×44.91 → 239.33×49.9 |
| (c) "Hello World" | 41.8 / 49.4 / 57px | −0.01（等倍と同じ端数） | 178.59 → 182 → 188.8 → 195.6（高さは (a) と同じ） |
| (b) 置いた文字・折り返し幅なし | 41.8 / 49.4 / 57px | 0 | プレートが 839.04（92%）→ 217.68 → 228.51 → 239.33 と文字に合わせて伸びる・選択枠も同じ |
| (b) 置いた文字・折り返し幅 30% | 41.8 / 49.4 / 57px | 0 | 幅 273.6 のまま（折り返し幅）・高さ 42.77 → 44.91 → 49.9 |
| (d) 字幕全体 1.5 倍 | —（run なし） | 0 | 318.39×64.16（BEFORE と同じ） |

- 大きくした文字の見えている幅 = 等倍 × 倍率（29.79 / 35.20 / 40.61）で、字送りも同じだけ広がる（隣と重ならない）
- 再び文字編集に入っても行が折り返さない（(c) の 2 回目以降の編集で確認）

### プレビュー ⇄ 書き出し（全 run 1.5 倍の状態・`compare-after.json`・フレーム比）

| 字幕 | GPU 横 / 縦 / 幅の差 | OSR 横 / 縦 / 幅の差 |
|---|---|---|
| (a) | 0.0016 / 0.0104 / 0.0016 | 同じ |
| (c) | 0.0016 / 0.0104 / 0.0016 | 同じ |
| (b) 折り返し幅なし | 0.0016 / 0.0035 / 0.0016 | 同じ |
| (b) 折り返し幅 30% | 0.0016 / 0.0035 / 0.0016（BEFORE 横 0.3094） | 同じ |
| (d) run なし（基準） | 0.0016 / 0.0104 / 0.0031 | 同じ |

横・幅の差 0.0016 = 2px、縦の差は run の無い (d) と同じ値（プレビューの撮影の切り出しの差）。

## 再現手順

```sh
node scripts/gen-fixture.mjs                 # 既定の出力先は OS の一時ディレクトリ
node scripts/l1.mjs before|after             # 高負荷時は AKARI_CDP_TIMEOUT_MS=90000。ONLY=a,c RESULTS_TAG=-x で一部だけ
node scripts/export.mjs before|after --engine=gpu|osr
node scripts/compare.mjs before|after
```

BEFORE の (b) は高負荷で 3・5 回目の書き込み待ちが間に合わなかったため、同じビルドの 1 回前の走行で取れた (b2) の 1・3・5 回を `results-before.json` の `supplement` に併記した。
BEFORE の書き出し比較は l1 の最終状態（(a)(c) 1.5 倍・(b) 1.2 倍）、AFTER は l1 の最終状態（全 run 1.5 倍）で、書き出しに使った captions.json と runs が一致することを確認した（`FRAMES_FROM=<captions.json>` を渡すと操作をせず撮影だけ行える）。
