# タイムラインで複数選んだ字幕を、出力プレビューでまとめて動かす・大きさを変える — 実機 L1 の証跡

タスク: `task/2026-09-23-caption-multiselect-move`。

実機: 専用の CDP ポート 9477・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`・一時 workspace（名前に `caption-multiselect-move` を含む）。
出力 1280×720、ウィンドウ 1440×900・倍率 1。「px」はすべてプレビュー上の表示 px（webview の CSS px）。
操作は CDP の実マウス・実キー（`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`）。undo は Cmd+Z の割り当て先 `akari.timeline.undo` を CommandService で実行。

## ファイル

| ファイル | 内容 |
|---|---|
| `scripts/gen-fixture.mjs` | fixture: 話した言葉 c-0001〜c-0004（1 / 5 / 9 / 13 秒から 3.6 秒ずつ）+ 置いた文字 c-0101〜c-0103（17〜22 秒・同じ時刻に 3 段）。映像は ffmpeg |
| `scripts/l1.mjs` | L1 本体（`before` = 記録のみ / `after` = 受け入れ条件の判定つき。AFTER は S0 / S3 / S4 を `results-before.json` と比べる） |
| `scripts/cdp-lib.mjs` / `scripts/l1-lib.mjs` | akari-preview/evidence/caption-drag-and-icon-tools の写し |
| `results-before.json` / `results-after.json` | 実測値 |
| `before-*.png` / `after-*.png` | スクリーンショット（プレビューの枠だけを切り出し） |

シナリオ: S0 = 1 本だけ（チップをクリック → 本体ドラッグ 40px）/ S1 = Cmd クリック 3 本（置いた文字・同じ時刻）/ S2 = 範囲選択 3 本（話した言葉・時刻が別々）/ 再読込 = Electron を起動し直す / S3 = 台本の Cmd+A / S4 = 全字幕モード（⌥ドラッグ）。
S3・S4 は undo が効かない書き込みを残すので、再読込の比較の後に行う。

## BEFORE（基点 `bfeac121`）

| 所見 | 実測 |
|---|---|
| Cmd クリックは切り替えにならない | クリック → Cmd クリック → Cmd クリックで、タイムラインの選択は `c-0103` の 1 本だけ（切り替えは Shift だけ）。プレビューも `c-0103` だけ選択・枠 1（`before-s1-01-selected.png`） |
| 範囲選択はプレビューに届かない | タイムラインは `c-0001〜c-0003` の 3 本。プレビューの `c-0001` は `data-selected` なし・つまみ 0・枠 0（`before-s2-01-selected.png`） |
| 本体ドラッグは掴んだ 1 本だけ | S1: `c-0103` だけ +40.01px（他の 2 本 0px）。S2: `c-0001` だけ +40px（`c-0002` / `c-0003` は 0px）。書き込み 1 回 |
| 角のつまみ | 選択が 1 本なので `c-0103` だけ `scale 1.235` |
| 台本の Cmd+A | 台本・タイムラインとも `c-0001〜c-0004`。プレビューの `c-0001` は `data-selected` + つまみ 5・**選択枠 0**。本体ドラッグは `c-0001` だけ書く |
| undo | **プレビュー発の字幕の書き込みは 1 本のときも undo できない**（S0 / S1 / S2 / S3 / S4 とも `akari.timeline.undo` の後も captions.json は書き込み後のまま） |

## AFTER（最終ビルド・11 項目中 9 pass / undo の 2 項目が不合格）

| 受け入れ条件 | 実測 |
|---|---|
| Cmd クリック 3 本 → プレビューに選択と枠 | タイムライン `c-0101〜c-0103`。プレビューは 3 本とも `data-selected` + つまみ 5。枠: 主 `c-0103` = `#caption-select-box` 1.5px 実線、他の 2 本 = `.caption-multi-select-box` 1px 破線（同じ青 `rgb(77,163,255)`・文字の外接矩形と同じ大きさ）。ミニパネル 1 つ（主の上）（`after-s1-01-selected.png`） |
| 範囲選択 3 本 → 見えている選択中に枠 | タイムライン `c-0001〜c-0003`。その時刻に見えている `c-0001` に `data-selected` + 破線の枠（主 = 範囲の最後の `c-0003` はこの時刻に見えないのでミニパネルは出ない）（`after-s2-01-selected.png`） |
| 本体ドラッグ 40px → 3 本とも同じ量 | S1: `c-0101` +39.99 / `c-0102` +40.01 / `c-0103` +40.01px（縦 0）。S2（見えていない 2 本を含む。各字幕の時刻へシークして測る）: 3 本とも横 +40px・縦 +7.6px（下端が 95% の線へ吸着 — BEFORE の 1 本だけのときと同じ量）。**captions.json への書き込みは 1 回** |
| 保存・再読込後も同じ | Electron を起動し直した後の位置の差: S1（拡縮後）/ S2 の 6 本とも 横 0・縦 0・幅 0px |
| 角のつまみで 3 本とも同じ倍率 | `c-0101` / `c-0102` / `c-0103` とも `scale 1.235`（`after-s1-03-scaled.png`） |
| 保存値の形 | 1 本だけのときと同じ（`text_anchor` + `position {x, y}`・`zone` を消す）。S2 の `c-0001` の保存値は BEFORE の 1 本だけのドラッグと同値 `{bc, x 0.3101, y 0.95}` |
| 1 本だけ（回帰） | タイムライン `c-0004` → プレビュー選択・実線の枠 1。+39.98 / +7.6px、保存値は BEFORE と一致、書き込み 1 回 |
| 台本の Cmd+A（回帰） | 台本・タイムラインの選択は BEFORE と同じ `c-0001〜c-0004`。プレビューは `c-0001` に選択枠（実線）が出るようになった。本体ドラッグは選んだ 4 本とも書く（指示 2 の「複数選択中は選んだ全部が動く」による変化） |
| 全字幕モード（回帰） | ⌥ドラッグで `default_text_style` だけが `{zone}` → `{text_anchor, position}` に変わり、cue は書かない（BEFORE と同じ形）・書き込み 1 回 |
| **undo 1 回で 3 本とも戻る** | **不合格**: S1・S2 とも `akari.timeline.undo` の後も captions.json は書き込み後のまま（BEFORE から、プレビュー発の字幕の書き込みには undo の経路が無い。履歴サービスは akari-annotations にあり、akari-preview からは参照できない） |

## 再現手順

```sh
node scripts/gen-fixture.mjs            # 既定の出力先は OS の一時ディレクトリ
node scripts/l1.mjs before|after        # 変更前 / 変更後のビルドで（高負荷時は AKARI_CDP_TIMEOUT_MS=60000）
```
