# 字幕の文字範囲（runs）— 実機 L1 の証跡

タスク: `task/2026-09-24-caption-runs-render`（契約: `docs/contract-2026-09-24-caption-runs-v0.md`）。

実機: 専用の CDP ポート 9487・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`（名前に `caption-runs-render` を含む）。
ウィンドウ 1440×900・倍率 2 で撮影（レイアウトは CSS px のまま、ラスタだけ 2 倍）。出力 1280×720。
BEFORE は変更前（基点 `813debc0`）を別ディレクトリへ展開してビルドしたもので撮った。

## ファイル

| ファイル | 内容 |
|---|---|
| `scripts/gen-fixture.mjs` | fixture（2 秒刻み）。`--runs` で手書きの runs を足す（AFTER 用）/ `--animator` で c-0007 だけの別 fixture（字幕アイテムに animator） |
| `scripts/captures.mjs` | プレビューと書き出しで撮る時刻の一覧 |
| `scripts/l1.mjs` | プレビュー: 各時刻へシーク → webview の領域を撮る・字幕の板の DOM（outerHTML・run / 文字 / 強調 span の矩形と計算済みスタイル）を記録 |
| `scripts/export.mjs` | 書き出し: render-cut を `--engine gpu` / `--engine osr` で走らせ、同じ時刻のフレームを落とす |
| `scripts/compare.mjs` | プレビューの撮影から映像枠（0x27313f）を色で切り出し、書き出しのフレームと同じ色の分類で画素の重心（フレーム比）を比べる |
| `scripts/rederive-l1.mjs` | 台本パネルで c-0001 を 3 回直し、captions.json の runs とプレビューの run の span を記録（AFTER のみ） |
| `scripts/cdp-lib.mjs` / `scripts/l1-lib.mjs` | caption-scale-position-coords の写し |
| `results-*.json` | プレビューの DOM の記録（`-animator` は c-0007 の別 fixture） |
| `export-*.json` | 書き出しの記録（採用エンジン・警告） |
| `compare-*.json` | プレビュー ⇄ GPU / OSR の重心の差 |
| `results-rederive-after.json` / `after-rederive-*.png` | 台本での付け替え |
| `lint-after.txt` | 範囲外・空の run を足した captions.json への edit-lint の出力 |
| `<phase>-preview-*.png` / `<phase>-export-{gpu,osr}-*.png` | 映像枠の切り出し（732px 幅） |

## fixture

| 字幕 | 内容 | runs（AFTER） |
|---|---|---|
| c-0001 | これは最高のアイデアです | 最高 = 赤 `#ff5a5f`・1.3 倍・太字 900・上へ 0.1em・8°（role emphasis）/ アイデア = 字間 0.05em（role keyword） |
| c-0002 | 手動の改行 `display_fragments`（今日の天気は / 晴れのち曇りです） | 天気は晴れ（断片をまたぐ）= 水色・1.2 倍 |
| c-0003 | 乾杯🍻👍🏽みんなか + U+3099 来た | 🍻👍🏽（肌色の修飾つき）= 1.3 倍 / が（結合文字）= シアン・下線 |
| c-0004 | ここが一番のポイント | 一番 = 紫・`animation.loop` float |
| c-0005 / c-0006 | 強調 `emphasis_words`（one-char-bang / emphasis-red） | なし |
| c-0007 | animator（basis chars。別 fixture） | なし |
| c-0008 | ふつうの字幕です | なし |
| c-0009 / c-0010 | 折り返しで 3 行 / 5 行が同時に見える長い字幕（日本語 / 空白を含む英語） | 行をまたぐ run = 橙（c-0009 は 1.15 倍・c-0010 は字間 0.05em） |

## BEFORE（変更前）— 既存の 1 文字ずつの経路と強調の描かれ方

- 強調（`emphasis_words`）: プレビューは語を `akari-caption__tok--emphasis akari-caption__tok--size-pulse` の span で描き、`style_preset` の見た目（emphasis-red の赤・大きさ）を反映しない。書き出し（GPU / OSR）は赤く大きく描く。
  → c-0006 は白い文字の重心がプレビューと書き出しで縦 0.011 ずれる（**変更前からの差**。本票の対象外で、AFTER も同じ値）
- one-char-bang（c-0005）: プレビュー・書き出しとも語の中ほど（出始め +0.04 秒）で見た目の差は無い（白い文字の重心差 ≤0.001）
- animator（basis chars・c-0007）: プレビューは `akari-caption__char` の span ごとに inline の transform（translate / rotate）を掛ける。GPU・OSR の書き出しも同じ形（重心差 ≤0.0013）
- runs の無い字幕のプレビューと書き出しの重心差は ≤0.0017（c-0006 を除く）

## AFTER — 受け入れ条件の実測

### プレビュー ⇄ 書き出しの run の文字の中心（`compare-after.json`・フレーム比。基準 ±0.005）

| 字幕 | 分類 | GPU dcx / dcy | OSR dcx / dcy |
|---|---|---|---|
| c-0001 | 赤（最高） | 0.0000 / −0.0001 | 0.0000 / +0.0002 |
| c-0001 | 白（アイデア を含む残り） | +0.0007 / +0.0004 | −0.0007 / +0.0009 |
| c-0002 1 断片目 | 水色（天気は） | +0.0004 / −0.0003 | +0.0005 / 0.0000 |
| c-0002 2 断片目 | 水色（晴れ） | 0.0000 / −0.0002 | +0.0002 / −0.0001 |
| c-0003 | 絵文字（🍻👍🏽・1.3 倍） | −0.0006 / +0.0028 | 0.0000 / +0.0024 |
| c-0003 | シアン（結合文字の が） | −0.0001 / +0.0009 | −0.0001 / +0.0010 |
| c-0004 | 紫（一番） | 0.0000 / +0.0007 | +0.0005 / +0.0011 |
| c-0009 | 橙・1 行目 / 2 行目 | +0.0004 / 0.0000・−0.0004 / −0.0002 | −0.0003 / +0.0002・+0.0002 / +0.0001 |
| c-0010 | 橙・1 行目 / 2 行目 | +0.0012 / +0.0005・+0.0012 / +0.0007 | +0.0010 / +0.0006・+0.0002 / +0.0009 |

全 run で |差| ≤ 0.0028（GPU・OSR とも）。行をまたぐ run（c-0009 / c-0010）は両方の行で一致。
絵文字の縦の差（+0.0024〜0.0028）は BEFORE（run なし・等倍）でも +0.0022〜0.0026 あり、絵文字の描画の差（run の有無と無関係）。

プレビューの DOM（`results-after.json` c-0001）: 最・高 は `akari-caption__run` `data-role="emphasis"`・color rgb(255, 90, 95)・font-weight 900・
transform `translateY(-0.1em) rotate(8deg) scale(1.3)`、アイデア は `data-role="keyword"`・letter-spacing 1.9px（0.05em）。
行の高さは run の有無で変わらない（c-0001・c-0009 とも 34.35px = BEFORE と同じ）。

### runs を持たない字幕の不変

- プレビュー: c-0005・c-0006・c-0007・c-0008 の板の outerHTML が BEFORE と文字列一致
- 書き出し: 同じ 4 本（6 時刻）の GPU / OSR のフレームが BEFORE と**画素一致**（最大差 0）

### run の動き（c-0004 の loop float）

描かれない（契約 v0 の「animation は予約・静的描画は反映しない」）。紫の重心は 3 時刻（+0.6 / +1.0 / +1.3 秒）で同じ値（プレビュー・GPU・OSR とも）。

### 台本での付け替え（`results-rederive-after.json`）

| 操作 | captions.json の runs | run の文字 | プレビューの run の span | 通知 |
|---|---|---|---|---|
| 初期 | [3,5) [6,10) | 最高 / アイデア | 最・高・ア・イ・デ・ア | — |
| 1. 前に「ねえ」 | [5,7) [8,12) | 最高 / アイデア | 最・高・ア・イ・デ・ア | — |
| 2. 最高 → 最強 | [5,7) [8,12) | 最強 / アイデア | 最・強・ア・イ・デ・ア | — |
| 3. 最強 を消す | [6,10) | アイデア | ア・イ・デ・ア | **出ない** |

### lint（`lint-after.txt`）

範囲外 `[10, 20)`（表示 12 書記素）と空 `[4, 4)` の run がそれぞれ `[warning] captions.run-range` になる（PASS のまま・描画では無視）。

## 再現手順

```sh
node scripts/gen-fixture.mjs && node scripts/gen-fixture.mjs --runs && node scripts/gen-fixture.mjs --animator
node scripts/l1.mjs before|after [--set=animator]
node scripts/export.mjs before|after --engine=gpu|osr [--set=animator]
node scripts/compare.mjs before|after
node scripts/rederive-l1.mjs
```
