# timeline-filmstrip-size-gate — L1 証跡（main 取り込み後に撮り直し）

タイムライン帯のフィルムストリップ（サムネ）が「クリップ幅 40px 未満」「トラック高 48px 未満」で
丸ごと消える件の修正。

- **BEFORE** = `origin/main`（本ブランチが取り込んだ基点。`akari-annotations-widget.ts` だけを
  `git checkout origin/main --` で戻して再ビルドした状態）
- **AFTER** = 本ブランチ HEAD（main 取り込み後）
- BEFORE / AFTER とも同じドライバ・同じ素材・同じ操作で 1 本ずつ**逐次**実行（Electron は同時 1 本）

## 検証環境（両シナリオ共通）

- 隔離ワークスペース・`AKARI_HOME`・`THEIA_CONFIG_DIR`・`--user-data-dir` をすべて一時ディレクトリへ。
  実利用の `~/.akari` / `~/.config/akari-video/credentials.env` は読み書きしていない
- 起動: `Electron <apps/shell> <workspace> --remote-debugging-port=… --user-data-dir=… --no-sandbox`、
  CDP へ playwright-core で接続。終了時に PID 指名で kill し、残留プロセス 0 件を確認
- **ウィンドウ寸法を固定**: Theia の既定ウィンドウは「開くディスプレイの 2/3」で実行ごとに変わるため、
  electron-store の `windowstate`（1600×1000）を起動前に置き、右ドック（注釈パネル）が開き直したら
  畳み直して帯幅が 3 回連続で同じになるまで待ってから撮影する。両条件とも帯幅 1486px で撮影した

## 1. サイズゲート撤廃（(a) / (b) / (c)）

合成プロジェクト: `ffmpeg -f lavfi -i testsrc2=s=320x180:r=30 -t 60` の 10 秒カット × 75 本 = 750 秒。

| シナリオ | 条件 | BEFORE | AFTER |
|---|---|---|---|
| S0 通常倍率 | 帯幅 221.33px / トラック高 48px | サムネ有り 9/9 クリップ・54 セル | サムネ有り 9/9・**63 セル** |
| (a) トラック高 47px | ヘッダーを実ドラッグで 48 → 47 | **0/9 クリップ・0 セル** | サムネ有り 9/9・63 セル |
| (b) ズームアウト | 帯幅 19.99px（75 クリップ・`viewDuration` 664s） | **0/75 クリップ・0 セル** | サムネ有り 75/75・75 セル |
| (c) トリムで 40px 境界越え | 帯幅 49.18px → 28.20px（`duration` 300 → 172 フレーム） | 越えた瞬間 **0 セル**（可視 41 クリップすべて 0） | クリップ 0 は 1 セル・**可視 41 クリップすべてサムネ有り** |

- (c) は合成イベントではなく実ポインタドラッグ（`dragState = {kind:'cut-trim', edge:'right', index:0}` を観測し、
  ワークスペースの `edit.json` の `duration` が 300 → 172 に書き換わったことを確認）
- S0 のセル数が 54 → 63 に増えるのは、契約の指示 3（`totalCellCount` を `Math.round` → `Math.ceil`）の
  意図した結果（右端の未描画帯が埋まる）

## 2. 既存 fieldtest プロジェクトでの通常倍率比較（受け入れ条件 3）

非公開の内部リポジトリにある実プロジェクト `2026-08-31-object-tree-manual-test`（手動テスト用の fieldtest）を隔離ワークスペースへ丸ごと複製し、
**ズーム・スクロールに触れない既定表示**で撮影した（原本は読むだけ）。
このプロジェクトは動画カット 2 本・PiP（動画レイヤー）・字幕・テロップ・HTML オーバーレイ・
グループ（子テロップ + 子 HTML）・BGM を含み、`mediaGate` を署名から外した変更が及ぶ
非動画レイヤーも同じ画面に載っている。

| 項目 | BEFORE | AFTER |
|---|---|---|
| 帯の幾何（`left/top/width/height`） | cut:0 143/331.5/658.51/48・cut:1 801.51/331.5/548.76/48・pip-b 252.75/253.5/439.01/48・telop 252.75/201.5/329.25/48・overlay 143/149.5/548.76/48 | **すべて同一** |
| フィルムストリップのセル数 | cut:0 18 / cut:1 15 / pip-b 12 | cut:0 **19** / cut:1 **16** / pip-b **13** |
| `edit.json`（sha256 `86e53b1c…3e65`・2222 bytes） | 起動前後で不変 | 起動前後で不変（BEFORE と同一ハッシュ） |

画素比較（`ft-normal-diff.json` / `ft-normal-diff.png`。赤 = 差分画素）:

- 差分 **55,306 / 2,835,288 画素（1.95%）**、最大チャンネル差 216
- 差分画素は **動画クリップ 3 本（cut:0 / cut:1 / pip-b）の矩形の内側に 100% 収まる**
  （`rects.outsideAllRects = 0`）。字幕・テロップ・HTML・グループ・音声・トラックヘッダー・
  ルーラー・ツールバーは**1 画素も変わっていない**
- 中身の差分は指示 3（`Math.ceil`）の帰結: セルが 1 枚増え、`sourceT = in + ((i+0.5)/totalCellCount) × span`
  の分母が変わるため各セルの抽出フレームが少しずつずれる。**帯・レイアウト・他レーンの見た目は不変**
- 撮影の再現性（ノイズ床）: 同一条件で 2 回撮った BEFORE 同士・AFTER 同士はいずれも**差分 0 画素**。
  したがって上記 1.95% はすべて実装差に由来する

## ファイル

| ファイル | 内容 |
|---|---|
| `s0-normal-{before,after}.png` | 合成プロジェクトの通常倍率 |
| `sa-track47-{before,after}.png` | (a) トラック高 47px |
| `sb-zoomout-{before,after}.png` | (b) 帯幅 20px までズームアウト |
| `sc-trim-pre-{before,after}.png` | (c) トリム前（帯幅 49px） |
| `sc-trim-{before,after}.png` | (c) トリム後（帯幅 28px） |
| `measurements-{before,after}.json` | (a)(b)(c) の実測値（帯幅・トラック高・セル数・`edit.json` の duration） |
| `ft-normal-{before,after}.png` | 既存 fieldtest プロジェクトの通常倍率 |
| `ft-normal-diff.png` / `ft-normal-diff.json` | 上記 2 枚の画素比較（赤 = 差分）と集計 |
| `ft-measurements-{before,after}.json` | 帯の幾何・セル数・`edit.json` のハッシュ |

作業機の絶対パス・HOME・一時ディレクトリは証跡に含めていない。
起動ログ（`electron-*.log`）はリポジトリの `.gitignore`（`*.log`）により追跡しない。
