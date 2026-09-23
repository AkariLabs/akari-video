# 出力プレビューでの字幕の操作を Cmd+Z で戻す・Cmd+Shift+Z でやり直す — 実機 L1 の証跡

タスク: `task/2026-09-23-preview-caption-undo`。

実機: 専用の CDP ポート 9481・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`・一時 workspace（名前に `preview-caption-undo` を含む）。
出力 1280×720、ウィンドウ 1440×900・倍率 1。「px」はすべてプレビュー上の表示 px（webview の CSS px）。
操作は CDP の実マウス・実キー（`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`）。
**undo / redo は実キーの Cmd+Z / Cmd+Shift+Z**（割り当て先 `akari.timeline.undo` / `redo`）。キーで戻らなかったときだけ同じコマンドを CommandService で試し、どちらで戻ったかを `via` に記録する（AFTER は全件 `via: "key"`）。

## ファイル

| ファイル | 内容 |
|---|---|
| `scripts/gen-fixture.mjs` | fixture（caption-multiselect-move の写し）: 話した言葉 c-0001〜c-0004（1 / 5 / 9 / 13 秒から 3.6 秒ずつ）+ 置いた文字 c-0101〜c-0103（17〜22 秒・同じ時刻に 3 段）。映像は ffmpeg |
| `scripts/l1.mjs` | L1 本体（`before` = 記録のみ / `after` = 受け入れ条件の判定つき）。`AKARI_L1_SHELL` で起動する shell を差し替えられる（BEFORE は基点のビルドを複製した一時ディレクトリで走らせた） |
| `scripts/cdp-lib.mjs` / `scripts/l1-lib.mjs` | caption-multiselect-move（← caption-drag-and-icon-tools）の写し |
| `results-before.json` / `results-after.json` | 実測値（captions.json の同一性は内容の比較。記録には SHA-256 の先頭 16 桁） |
| `before-*.png` / `after-*.png` | スクリーンショット（`*-1-done` = 操作の後、`*-2-undone` = Cmd+Z の後。`c-conflict-notice` はウィンドウ全体） |

シナリオ（1 回の起動で順に。各操作は undo → redo で操作後の状態に戻してから次へ進むので、状態は積み上がる）:

- P1 1 本の移動（c-0004 の本体ドラッグ 40px）/ P2 複数選択 3 本の移動（Cmd クリックで c-0101〜c-0103）/ P3 全字幕モード（⌥ドラッグで上へ 30px。c-0003 で測る）
- P4 角のつまみの拡縮 / P6 ミニパネルの太字 / P7 色（パレットの文字色 `#f26666`）/ P8 座布団 / P5 回転（回転のつまみ）/ P9 既定に戻す
- P10 はみ出し防止の切り替え（書き込みがあるかの観測）
- T0 タイムライン発（字幕のチップを時間方向へドラッグ = 「字幕タイミングの調整」）の undo / redo（比較の基準）
- X タイムライン発 → プレビュー発（移動）→ タイムライン発 → プレビュー発（太字）の後に Cmd+Z 4 回 → Cmd+Shift+Z 4 回
- C プレビュー発の移動の後に captions.json を外から書き換え（同じ内容を 4 字下げで書き直す）→ Cmd+Z

各 P の判定: 書き込み 1 回・描画が変わる → Cmd+Z 1 回で captions.json が操作前と一致 + 描画（文字の外接矩形 ±1px・太さ・色・縁取り・背景・transform）が操作前と一致 → Cmd+Shift+Z で操作後と一致 + 描画も操作後と一致。

## BEFORE（基点 `f0d8af2e` のビルド）

| 所見 | 実測 |
|---|---|
| プレビュー発の書き込みは戻らない | P1〜P9 の 9 操作すべて、Cmd+Z（とコマンド）の後も captions.json は書き込み後のまま（`undo.restored: false`・描画も操作後のまま）。書き込みはどれも 1 回 |
| タイムライン発は戻る（比較の基準） | T0: Cmd+Z で操作前と一致、Cmd+Shift+Z で操作後と一致 |
| 交互にすると順番が崩れる | X: 1 回目の Cmd+Z が最後のプレビュー発（太字）を飛ばしてタイムライン発を戻す（`changedToOther`）。4 回で 1 つも期待の状態にならない |
| 外からの書き換えの後 | C: Cmd+Z がタイムライン発の古い履歴（字幕タイミングの調整）を戻し、外の書き換えは上書きされた（`before-c-conflict-notice.png` のフッター） |
| はみ出し防止の切り替え | P10: captions.json への書き込みなし（webview のメモリ上の切り替え）→ undo の対象外 |

## AFTER（本ブランチのビルド・13 項目すべて pass）

| 受け入れ条件 | 実測 |
|---|---|
| 1 本の移動 | 書き込み 1 回（c-0004）。Cmd+Z 1 回で操作前と一致・描画一致（341ms）、Cmd+Shift+Z で操作後と一致・描画一致 |
| 複数選択 3 本の移動 | 書き込み 1 回（c-0101 / c-0102 / c-0103）。Cmd+Z 1 回で 3 本とも戻る（451ms）・redo 一致 |
| 全字幕モード | 書き込み 1 回（`default_text_style` だけ）。undo / redo とも一致・描画一致 |
| 角のつまみの拡縮 / 回転 | それぞれ書き込み 1 回。undo / redo とも一致・描画一致 |
| ミニパネルの太字 / 色 / 座布団 | それぞれ書き込み 1 回（太さ 700→900 / 色 白→`rgb(242,102,102)` / 背景 透明→`rgba(0,0,0,0.75)`）。undo / redo とも一致・描画一致 |
| 既定に戻す | 書き込み 1 回。undo で拡縮・回転・位置が戻り、redo で既定に戻る。描画一致 |
| タイムライン発と交互 | X: Cmd+Z 4 回がそれぞれ 1 つ前の状態に一致（太字 → タイムライン → 移動 → タイムラインの順）、Cmd+Shift+Z 4 回が順に一致。すべて実キー・各 255〜283ms |
| 挟まった書き込み | C: Cmd+Z で外の書き換えは上書きされない（`keptExternal: true`）。タイムラインのフッターとトーストに「『字幕を移動』を元に戻せませんでした: 字幕ファイルが後から変更されています」（既存の履歴の失敗表示と同じ経路）。成功の文言は出ない |
| はみ出し防止の切り替え | P10: 書き込みなし（BEFORE と同じ）→ undo の対象外 |

実行時の負荷: 並走レーンと同時で load average 80〜260。BEFORE の初回は Electron が途中で停止したため取り直した（上の BEFORE は 3 回目の記録）。

## 再現手順

```sh
node scripts/gen-fixture.mjs                   # 既定の出力先は OS の一時ディレクトリ
AKARI_L1_SHELL=<基点ビルドの apps/shell> node scripts/l1.mjs before
node scripts/l1.mjs after                       # 高負荷時は AKARI_CDP_TIMEOUT_MS=60000
```
