# 文字範囲（runs）の操作画面 — 実機 L1 の証跡

タスク: `task/2026-09-24-caption-runs-edit-ui`。

実機: 専用の CDP ポート 9499・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`（名前に `caption-runs-edit-ui` を含む）。
ライブラリの置き場は fixture の `library/`（`AKARI_HOME/library-location.json`）。左・右・下のパネルを畳んで出力プレビューを広げてから操作する。
操作は CDP の実マウス・実キー（`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`）。undo / redo は `akari.timeline.undo` / `redo`（Cmd+Z の割り当て先）を CommandService で実行した。

## ファイル

| ファイル | 内容 |
|---|---|
| `scripts/gen-fixture.mjs` | fixture（話した言葉 3 行・c-0001「これは最高のアイデアです」+ マイスタイル 1 件「緑の強調（L1）」= 色・太さ・縁取り・座布団・影）。映像は ffmpeg |
| `scripts/l1.mjs` | L1 本体（下の 14 項目の判定つき）。Electron の起動し直しによる再読込を含む |
| `scripts/export-frame.mjs` | 再読込後の captions.json を render-cut（`--engine gpu`）で書き出し、1.8 秒のフレームで赤（「最高」）と緑（「アイデア」）の画素の外接矩形をプレビューの run の矩形と比べる |
| `scripts/cdp-lib.mjs` / `scripts/l1-lib.mjs` / `scripts/view-lib.mjs` | caption-drag-and-icon-tools の L1 の小道具の写し（起動前の置き場の用意・画面の大きさの上書きを既定で外す、を足した） |
| `results-after.json` / `export-after.json` | 実測値 |
| `after-*.png` | スクリーンショット（01〜07 はプレビューの枠、08〜10 はウィンドウ全体、11 は書き出しフレーム） |

## 結果（最終ビルド・14/14 pass を 2 回連続）

| 項目 | 実測 |
|---|---|
| 範囲なしのミニパネルは今どおり | 字幕を選ぶだけ → アイコンは group / snap / clamp / bold / color / cushion / inspector / my-style-save（範囲用 0 個）。B → `text_style.font_weight: 900`（`runs` なし）・undo 1 回で byte 一致 |
| なぞって選ぶ | ダブルクリック → 「最高」をドラッグ → `data-akari-run-from/to = 3/5`・選択文字列「最高」・範囲用アイコン 8 個（大きく・小さく・上へ・下へ・回転・字間・スタイル・役割）。ツールバーは 1 段（高さ 36px）でプレビューの中 |
| Shift+矢印 | Shift+→ で 3〜6（「最高の」）・Shift+← で 3〜5 に戻る |
| 赤 → 大きく → 上へ → 回転 → 役割 | 各操作とも captions.json への書き込み **1 回**・同じ run を更新（`{from:3,to:5,style:{color:#f26666, scale:1.1, baseline_shift_em:-0.1, rotate_deg:8}, role:"emphasis"}`）・**undo 1 回で書き込み前と byte 一致**・redo で書き込み後と byte 一致。undo の後も編集中の選択（3〜5）は残る |
| 編集中の見た目 | 編集中の要素の中の `.akari-caption__run` が赤（`rgb(242,102,102)`）・`matrix(1.08929, 0.15309, -0.15309, 1.08929, 0, -3.8)`（大きく・上へ・回転） |
| 編集を抜ける | Escape → 範囲用アイコン 0 個・描画の run の span 2 個とも赤 + 変形あり |
| 役割のメニュー | 強調 / キーワード / 補足（保存値は emphasis / keyword / aside） |
| 範囲にマイスタイル | 「アイデア」（6〜10）→ スタイル → 候補にマイスタイル「緑の強調（L1）」と同梱 12 件 → 当てる → run 追加 `{color:#22C55E, font_weight:900, stroke:{color:#0B3D1E, width_px:3}}`（語彙内だけ）・書き込み 1 回・右下に 1 行「文字範囲に使えない見た目を省きました: 座布団・影・大きさの基準」・undo / redo で byte 一致 |
| 保存・再読込 | Electron を起動し直す → captions.json は不変・run の span 6 個の色・変形・太さが同じ・位置の差 0px |
| インスペクターの一覧 | 「文字」カードに「文字範囲」2 行（「4〜5文字目 「最高」 強調」「7〜10文字目 「アイデア」 色・太さ・縁取り」+ 外す）。2 行目を押す → プレビューが文字編集に入り 6〜10（「アイデア」）が選ばれる。外す → 書き込み 1 回・runs 1 件・一覧 1 行・undo 1 回で byte 一致 |
| 台本で「最高」を消す | 台本の行を「これはのアイデアです」に直す → 右下に **「文字範囲 1 件（「最高」）が外れました」**・残った run は 4〜8（「アイデア」）へ付け替え |
| 書き出し（GPU） | render-cut `engine: gpu`・verify pass。フレーム比の中心の差: 「最高」（赤）横 **−0.0003** / 縦 **0.0037**・「アイデア」（緑）横 **0.0011** / 縦 **0.0019** |

## 再現手順

```sh
node scripts/gen-fixture.mjs            # 既定の出力先は OS の一時ディレクトリ
node scripts/l1.mjs                     # 高負荷時は AKARI_CDP_TIMEOUT_MS=60000
node scripts/export-frame.mjs
```

リポ直下から起動する（`process.chdir`）。素材の置き場の解決（asset-resolver の候補探し）が cwd を見るため、別の場所から起動するとマイスタイルの一覧が空になる。
画面の大きさの上書き（`Emulation.setDeviceMetricsOverride`）をした状態では出力プレビューへのクリックで字幕が選ばれなかったため、既定では上書きしない（`L1_EMULATE=1` で上書き）。
