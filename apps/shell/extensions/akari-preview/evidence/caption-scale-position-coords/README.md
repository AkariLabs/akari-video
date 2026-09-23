# 字幕の大きさ・回転を変えたあとに動かすと位置が飛ぶ — 実機 L1 の証跡

タスク: `task/2026-09-23-caption-scale-position-coords`（r0 + 差し戻し r1）。

実機: 専用の CDP ポート 9479・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`（名前に `caption-scale-position-coords` を含む）。
出力 1280×720、ウィンドウ 1440×900・倍率 1、左右のパネルを畳んだプレビュー上のフレーム幅 732.44 表示px（1 表示px ≒ 1.75 出力px）。
「px」はすべてプレビュー上の表示 px（webview の CSS px）。操作は CDP の実マウス（`Input.dispatchMouseEvent`）。
「再読込」は Electron を一時ディレクトリで起動し直すこと（captions.json をディスクから読み直す。ウィンドウの再読み込みは高負荷の機械で webview に入力が届かなくなったため使わない）。

## ファイル

| ファイル | 内容 |
|---|---|
| `scripts/gen-fixture.mjs` | fixture（4 秒刻みに 15 本。(a) c-0001・(b) c-0002・(c) c-0003、(d) c-0004〜c-0011・c-0101、比較用 c-0012〜c-0014）。映像は ffmpeg |
| `scripts/l1.mjs` | L1 本体（`before` = 記録のみ / `after` = 受け入れ条件の判定つき） |
| `scripts/export-frame.mjs` | 最後の captions.json から 7 本を 1 秒ずつ並べて render-cut で書き出し、白い文字の塗りの外接矩形をプレビューの最後の再読込後の矩形と比べる。`--engine=osr` で OSR 経路に固定（r1 で追加） |
| `scripts/multiselect-gen-fixture.mjs` / `scripts/multiselect-l1.mjs` | (d) 複数選択の移動（r1 で追加）。akari-annotations/evidence/caption-multiselect-move の fixture と L1 の写し（一時ディレクトリ名・ポート 9479・結果ファイル名・BEFORE の参照先だけ変更） |
| `scripts/cdp-lib.mjs` / `scripts/l1-lib.mjs` | 既存の L1 証跡（caption-drag-and-icon-tools）の写し |
| `results-before.json` / `results-after.json` | 実測値 |
| `results-multiselect-after.json` | 複数選択の移動の実測値（BEFORE は caption-multiselect-move の `results-before.json`） |
| `export-before.json` / `export-after.json` / `export-after-osr.json` | 書き出しフレームの実測値（GPU 経路 / OSR 経路） |
| `before-*.png` / `after-*.png` | プレビューの枠の切り出し（07 は書き出しフレーム、`-osr` は OSR 経路、`multiselect` は複数選択） |

`results-before.json` は「位置 x を持つ字幕のつまみ」の節を足す前の版の `l1.mjs` で取った（基点ビルドは作り直していない）。

## L1 の流れ

初期描画を全 15 本記録 → (a) 角のつまみで 1.5 倍・(b) 0.7 倍・(c) 回転つまみで 15°（Shift で 15° 刻み）→ 再読込 →
3 回繰り返し（(a)〜(d) の 11 本を本体ドラッグ +20px（c-0010 だけ +6px = 中央吸着）→ 離す → 再読込）→
（AFTER のみ）位置 x を持つ字幕のつまみ → +20px → 再読込 → (d) 全字幕モード（⌥ドラッグ +20px）→ 再読込 → 全 15 本の最終位置。

回転つまみ（文字の上 34px）はミニパネルの道具（`.akari-caption-select-tools`）に隠れて押せないことがある（BEFORE で実測）。
つまみを押す間だけ注入 CSS で道具を見えなくしている（位置の計算には関与しない）。

## BEFORE（変更前のビルド = 基点 `c5e5fc5a`）

| ケース | つまみで文字の中心 | 本体ドラッグ 1〜3 回目: 離した瞬間 → 再読込後の中心の差 |
|---|---|---|
| (a) 1.5 倍 | 0px（x の無い字幕は箱 = 中央 92% 幅） | **−168.46 / −168.46 / −168.44px**（縦 +8.59px）。累積して 3 回目で保存 x = −0.2472（画面の左の外） |
| (b) 0.7 倍 | 0px | **+101.05 / +101.07 / +101.07px**（縦 −5.15px） |
| (c) 回転 15° | 0px | **+7.06 / +7.03 / +7.03px**（縦 +1.19px） |
| (d) 1 行・複数行（3 行）・subtitle-news 相当・アンカー mc・tc・置いた文字（tc）・画面の外（x −0.2）・中央吸着 +6px・全字幕モード | — | いずれも **±0.04px 以内**（飛ばない） |

- 飛ぶ量は見立てどおり: x を持つ字幕の箱 = `left:x`・幅 92%（673.84px）、拡縮の基準点 = 箱の中心 → `(1−s)·0.46·W`（s=1.5 で −168.45、s=0.7 で +101.07）。縦は保存 y が見た目の矩形の下端 → `h(s−1)/2`
- **「大きさを変えていないのに左へ飛ぶ」は拡縮・回転の無い字幕では再現しなかった**（上の (d) の 9 条件。複数選択の移動は caption-multiselect-move の BEFORE を参照）
- 書き出し（GPU 経路）: 等倍・x ありは一致（中心の差 cx −0.0002 / cy 0.002）。**拡縮・回転のある字幕はプレビューと別の場所**（x の無い回転 15° で cx −0.066 / cy +0.117、1.5 倍の字幕は書き出しのフレームに 1 画素も出ない）。
  `generateResolvedCaptionOverlays` / `generateCaptionOverlays` が scale / rotate を overlay の transform（出力フレーム全面の sprite root・中心基準）に渡しているため

## AFTER（r1 の最終ビルド）

| 受け入れ条件 | 実測 | 判定 |
|---|---|---|
| つまみで文字の中心が動かない（x なし） | (a) 1.5 倍・(b) 0.7 倍・(c) 回転 15°: 押したまま・離して再描画後とも **0 / 0px** | PASS |
| つまみで文字の中心が動かない（x あり） | c-0004 1.5 倍・c-0012 `{bc, x 0.25}` 回転 15°・c-0013 `{bc, x 0.2, scale 1.5}` → 2 倍: **0 / 0px** | PASS |
| (a)(b)(c) を 3 回: 離した瞬間と再読込後の中心の差 ±1px・累積なし | (a) −0.03 / 0 / −0.01px、(b) −0.04 / 0 / 0px、(c) −0.03 / 0 / 0px（縦 ≤0.03px） | PASS |
| (d) 等倍の字幕の本体ドラッグ 3 回（r0 の回帰） | 1 行・複数行・subtitle-news 相当・mc・tc・置いた文字・画面の外・中央吸着: 3 回とも **≤0.04px**（縦 ≤0.02px）。毎回保存されている | PASS |
| (d) 全字幕モード（⌥ドラッグ +20px → 再読込） | 移動 +20px、再読込後の差 **−0.02 / 0px** | PASS |
| (d) 複数選択の移動（`multiselect-l1.mjs`） | S1 Cmd クリック 3 本（置いた文字）: +39.99 / +40.01 / +40.01px・書き込み 1 回、角のつまみで 3 本とも 1.235 倍。S2 範囲選択 3 本: 3 本とも +40 / +7.6px（95% 線への吸着）・書き込み 1 回。**起動し直した後の差: S1（拡縮後）・S2 の 6 本とも 0 / 0px**。S0（1 本）・S3（台本 Cmd+A）・S4（全字幕モード）も PASS | PASS |
| x ありのつまみ → +20px → 再読込 | c-0004・c-0012・c-0013: ≤0.03px | PASS |
| 書き出しでプレビューと同じ位置（中心の差 ±0.005 フレーム比） | 下の表。GPU・OSR とも cx ≤0.0012、cy ≤0.0042 | PASS |
| x の無い字幕・x あり等倍の字幕の見た目が不変（±0.5px） | 初期描画 14 本（c-0013 以外）で BEFORE と **0.00px**（中心・左端・幅） | PASS |
| 既存の scale 付き字幕の見た目の変化 | c-0013 `{bc, x 0.2, y 0.8, scale 1.5}`: 文字の中心が **+98.80px 右**（左端 −21.97 → 76.83px）。箱が文字の幅になり、拡大の基準点が文字の中心へ移ったため（意図した変化） | 変化の例 |

複数選択の undo（S1 / S2 の「undo 1 回で 3 本とも戻る」）は caption-multiselect-move の AFTER と同じく不合格のまま（プレビュー発の字幕の書き込みに undo の経路が無い。本票の範囲外）。

### 書き出し（プレビューの最後の再読込後の矩形との比較・フレーム比）

| 字幕 | text_style | GPU cx / cy | OSR cx / cy |
|---|---|---|---|
| c-0001 | 1.5 倍（3 回動かした後） | −0.0006 / +0.0028 | −0.0006 / +0.0028 |
| c-0002 | 0.7 倍 | +0.0010 / +0.0013 | +0.0002 / +0.0013 |
| c-0003 | 回転 15°（画面の下端で切れる） | −0.0002 / — | +0.0002 / — |
| c-0012 | x あり・回転 15°（画面の中ほど） | +0.0011 / +0.0008 | +0.0011 / +0.0008 |
| c-0013 | x あり・2 倍 | −0.0003 / +0.0042 | −0.0003 / +0.0042 |
| c-0014 | x なし・回転 15°（下端で切れる） | +0.0008 / — | +0.0012 / — |
| c-0004 | x あり・1.5 倍 | −0.0010 / +0.0028 | −0.0002 / +0.0028 |

- 大きさも一致: 書き出しの塗りの幅 = プレビューの行の箱の幅 − 行の左右の余白（0.42em × 倍率）。等倍の BEFORE（c-0004）で左右 ±0.014、1.5 倍で ±0.020、0.7 倍で ±0.011〜0.013 と倍率に比例する
- 回転は書き出しのフレームでも 15° 傾いて出る（`after-07-export-c-0012.png`）

### r1 で直したもの

1. **等倍の字幕の本体ドラッグが保存されない（r0 の回帰）**: 保存の純関数 `captionPositionFromVisualRect` は `toString()` で webview へ注入されるが、r0 の等倍分岐が外の関数を呼んでいたため、
   本番の webpack（minify）後に名前が変わって webview で例外 → `caption position write rejected; reverting` で戻っていた。等倍分岐の計算を関数の中へ移し、
   注入する関数を空のスコープ・esbuild / terser の minify 後に評価して元の関数と同じ結果になることを単体テストで確かめる
2. **書き出しの基準点**: 字幕の overlay の transform を恒等にし、scale / rotate を `--caption-scale` / `--caption-rotate` として plate に渡す（プレビューと同じ規則）
3. **書き出しで拡縮・回転が消える（2 の途中で発見）**: 書き出しの旧経路の plate は `animation: akari-caption-fade … both` の keyframes（`transform: translateY(…)`）に plate の `transform` を上書きされていた。
   plate の拡縮・回転を CSS の個別プロパティ `rotate` / `scale` で掛ける形にして、フェード・`text_style.animation` と衝突しないようにした（プレビューの CSS 複製も同じ形）

## 再現手順

```sh
node scripts/gen-fixture.mjs            # 既定の出力先は OS の一時ディレクトリ
node scripts/l1.mjs before|after        # 変更前 / 変更後のビルドで（高負荷時は AKARI_CDP_TIMEOUT_MS=60000）
node scripts/export-frame.mjs before|after [--engine=osr]
node scripts/multiselect-gen-fixture.mjs
node scripts/multiselect-l1.mjs after
```
