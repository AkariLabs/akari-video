# evidence: timeline-sync-undo（プレイヘッド同期 + 多段 undo/redo + ドラッグ堅牢化）

## 対象

- プレビュー再生 tick の source 秒同期、78% 自動追従、停止中パン保持
- 50 段 undo/redo（Cmd/Ctrl+Z、Cmd/Ctrl+Shift+Z、ツールバーボタン）
- ドラッグ中の外部ファイル更新による再描画延期と、次回ドラッグの自己回復
- Wave 19/20 回帰（ズーム HUD、横スクロールバー、横スワイプ、クリックシーク、trim/caption drag）

## L0

以下をすべて実行し exit 0（`apps/shell` 配下、2026-07-21）。

- `npm run build:ext`
- `npm run lint`
- `npm run build`（browser/node/electron すべて 0 errors）

## source 秒の根拠

`akari-preview-open-handler.ts` の `tick` は、cuts の keep-range 境界を適用した後、オーバーレイ
runtime には `sourceToTimeline(...)` の timeline 秒を渡す一方、再生同期イベントには
`video.currentTime` を渡す。したがってタイムライン横軸へ送る値は source 秒である
（同ファイル 1302–1309 行付近）。pause/seeked は即時送信、通常 tick は 50ms スロットル。

## L1 — 実測 PASS（最終一括走行）

検証環境: production ビルド（`npm run build`）の Electron を隔離 user-data-dir +
`--remote-debugging-port` で `--no-sandbox` 起動し、生 CDP（`scripts/cdp-lib.mjs`）で実際の
マウス・キーボード・wheel イベントをディスパッチして操作した。フィクスチャは `fixture/`
（12秒・640x360・h264/yuv420p 映像 + MP3 音声、3 cuts・2 captions・1 overlay）。ワークスペースは
`templates/project-default/` を `<SCRATCH>/l1-ws/` へ展開したもの（`.akari/` 込み）。

再現コマンド:
```sh
node apps/shell/extensions/akari-annotations/evidence/timeline-sync-undo/scripts/run-l1.mjs \
  <cdpPort> <workspaceDir> <evidenceDir>
```

**総合判定: PASS**（`ALL ACCEPTANCE CRITERIA PASSED` を最終一括走行で確認。スクショ 00〜19 と
`run-log-final.json` は同一走行のもの）。

| # | 受け入れ条件 | 結果 | 実測値 |
|---|---|---|---|
| 1 | 再生でタイムライン playhead が追従（2秒以上・単調増加・source秒対応誤差±0.2s）。一時停止で停止 | **PASS** | 下記「L1-4」 |
| 2 | 再生中に 78% 超で表示窓が自動送り。停止中の手動パンは引き戻されない | **PASS** | 下記「L1-5」 |
| 3 | cuts をトリムした状態でも 1〜2 が成立（Wave 18a keep-range 再生との同居） | **PASS** | 4 の時点で cuts は既にトリム・並べ替え済み（下記「L1-9」参照）。同状態で 1〜2 実測 |
| 4 | 2 操作連続 → Cmd+Z ×2 逆順取り消し → Cmd+Shift+Z ×2 再適用。各段階で実ファイル内容一致 | **PASS** | 下記「L1-7」 |
| 5 | ツールバーの元に戻す/やり直すが同動作・スタック空で disabled | **PASS** | 下記「L1-7」に含む |
| 6 | ドラッグ堅牢化: ドラッグ中に renderStrip 要因を人工発火しても完走/安全中断、次のドラッグが正常動作 | **PASS** | 下記「L1-9」 |
| 7 | 回帰: ズーム HUD / 横スクロールバー・横スワイプパン / クリック→シーク / 既存ドラッグ編集 | **PASS** | 下記「L1-1」「L1-2」「L1-6」「L1-9」 |
| 8 | evidence に実測値記録・内部パス秘匿 | 本ファイル | — |

### L1-1/2: ズーム後のスクロール・カーソル不動点（回帰）

- ctrl+wheel ズームイン後（`contentWidthPx`: 904→3021.72）、素の wheel `deltaX:250` 相当の横スワイプで
  `scrollLeft` が 856.51→1106.88 に変化
- 左端: `scrollLeft: 0`。右端: `scrollLeft: 2126.396`、`maxScroll: 2127.72` と一致
- カーソル不動点誤差 `0.0329`秒（閾値=可視幅の2%=`0.0694`秒、誤差は閾値の約47%）

### L1-4: 再生 → playhead 同期（AC4）

- 再生 4.2 秒間（7.5秒→11.5秒、cuts 最終区間の keep-range 内）で playhead 1638.7→2444.5px、
  14 サンプル全区間で単調非減少
- tick 時刻との対応: worst error **0.0806秒**（閾値 0.2秒）
- 一時停止で playhead 停止（2 サンプルとも 2444.5px で完全一致、揺れなし）
- **実装上の注意（検証で判明）**: playhead と preview の対応誤差はサンプリング方式に敏感。
  `widgetState(main)` と `video.currentTime` 読み出しを別々の CDP ラウンドトリップとして
  **直列 await** すると、2 呼び出しの間に再生が進み見かけ上の誤差が最大 0.28 秒まで悪化する
  （閾値 0.2 秒を超えて偽 FAIL する）。`Promise.all` で同時発行するよう `run-l1.mjs` を
  修正し、0.08 秒まで縮小して閾値内に収まることを確認した（プロダクト側の同期精度自体は
  修正前から一貫して妥当だった。詳細は本 README 末尾「検証ドライバの修正点」参照）

### L1-5: 78% 自動追従・停止中パン保持（AC5）

- playhead が可視幅 78% を超えた時点（サンプル#3, 閾値0.78）以降、`scrollLeft` が
  1254.17→1755.35px に増加（auto-follow 発火）
- 停止中の手動スクロール: 目標 `1555.35` に対し実測 `1553.96`（誤差1.4px、auto-follow に
  引き戻されないことを確認）

### L1-6: タイムラインクリック → プレビューのシーク（回帰、AC6）

- タイムライン上 4.5秒相当をクリック → footer「00:00:04.500 にプレビューをシークしました。」
- プレビュー側 `video.currentTime` 実測 `4.49986`（誤差 0.00014秒）

### L1-7: 多段 undo/redo（AC7/AC8）

caption 移動 → overlay 移動の2操作を実行後、Cmd+Z ×2 → Cmd+Shift+Z ×2 の順で検証:

| 段階 | captions.json `start` | edit.json overlays[0].start | undo有効 | redo有効 |
|---|---|---|---|---|
| 初期 | 1 | 1 | ✗（空） | ✗（空） |
| caption移動後 | 1.2306784660766963 | 1 | — | — |
| overlay移動後 | 1.2306784660766963 | 1.1922320550639136 | ✓ | ✗ |
| Cmd+Z ×1（overlay取消） | 1.2306784660766963 | **1**（復元） | ✓ | ✓ |
| Cmd+Z ×2（caption取消） | **1**（復元） | 1 | — | — |
| Cmd+Shift+Z ×1（caption再適用） | 1.2306784660766963 | 1 | — | — |
| Cmd+Shift+Z ×2（overlay再適用） | 1.2306784660766963 | 1.1922320550639136 | ✓ | ✗（空に復帰） |

続けてツールバーの「元に戻す」×2→「やり直す」×2でも同じ往復を再実施し、両ファイルが同じ値に
戻ることを確認済み（`redoDisabled: true` を再確認）。各段階で `captions.json`/`edit.json` の
実ファイル内容を読み直して検証（`09-caption-move-result.png`〜`12-after-redo-x2.png`）。

### L1-9: 回帰・ドラッグ堅牢化・スナップガイド（AC9）

- **cut-trim**: C1 左端ドラッグ → `cuts[0].in`: `0.5 → 0.6555058414118817`
- **cut-reorder**: C1 中央ドラッグ → cuts 配列順が `[C1,C2,C3]` → `[C2,C1,C3]` に変化
  （in/out 値の集合は不変、順序のみ変化）
- **スナップガイド**: caption-b を word boundary（analysis.json "two": 4.0-4.4秒）付近へ
  ドラッグ中、`snapGuide.style.display === 'block'` を実測
- **ドラッグ堅牢化の実証**: スナップガイド表示中に captions.json への外部書き込み
  （ファイル監視トリガー）を発火させ、renderStrip 要因を人工発生させた。Escape で
  このドラッグをキャンセル（`edit.json`/`captions.json` は完全に無変化と確認）した後、
  **直後の overlay-resize / caption-move / overlay-move の3ドラッグが全て正常に完走**
  （クリック化などの残留症状なし）。renderStrip のドラッグ中延期 + pointerdown 時の
  自己回復ロジックが機能していることを確認
- **overlay resize**: overlay-a 右端ドラッグ → `overlays[0].duration`: `3 → 3.1537856440511307`
- **caption移動・overlay移動**: L1-7 参照

## 検証ドライバの修正点（ラッパーによる評価スコープ内の修正、§後述）

参照実装（`task/2026-07-20-timeline-nav-sync`）からの移植直後の `run-l1.mjs` は、現 main固有の
差分により4箇所で実際の挙動と食い違っていた。いずれも検証ドライバ側（`scripts/`・`fixture/`）
の修正であり、プロダクトソース（`src/browser/**`）は一切変更していない。

1. **captions.json の整形書き戻しが 1 行形式チェックを壊す**: ドラッグ中の renderStrip 発火用に
   `JSON.stringify(data, null, 2)` で captions.json を書き戻していたが、実サービス
   （`caption-store.ts` の `shiftCaptionLine`）は「字幕1件=1行」の行ベースパッチャーのため、
   整形後の複数行 JSON では以降の字幕ドラッグ commit が全て
   「字幕 caption-a の1行形式を確認できません。」で失敗していた（プロダクト側のバグではなく
   検証ドライバの副作用と実測で特定）。生テキストをそのまま書き戻す方式に変更し解消
2. **非開発者モードの既定化により標準 Explorer に到達できない**: Wave 19
   （非開発者モード向け「素材」差し替えビュー）が landed して以降、新規ワークスペースの既定
   UI は「素材」ロールボタン画面になり、参照実装が前提としていた標準ファイルツリー
   （`.theia-TreeNode` の `exports` 行）が存在しない。設定パネルの「Developer mode」
   チェックボックスを ON にする手順をドライバへ追加し解消
3. **クリックシーク対象時刻が可視窓外**: cut-reorder 後の `cuts[0].in`（=4秒）+0.5=4.5秒への
   クリックシークテストが、直前に `scrollToTime(main, 0)` していたため可視窓
   （ズーム後 visibleDuration 約3.47秒）の外を指し、クリックが何にも当たらずシークが
   発火しなかった。クリック対象時刻が可視窓に収まるようスクロール先を修正し解消
4. **playhead-tick 対応誤差の測定アーティファクト**: 上記「L1-4」に記載の `Promise.all` 化

## 実測ログ

`run-log-partial-1.json`〜`run-log-partial-3.json`・`run-log-partial-5.json`・
`run-log-final.json` に各フェーズの実測値・assertion結果を構造化記録。`fixture/` に検証用
フィクスチャ（edit.json / captions.json / review.json / analysis.json / overlay-a.html、
動画本体は検証後に破棄しコミットしていない）。`scripts/cdp-lib.mjs` / `scripts/run-l1.mjs` が
検証ドライバ本体（依存追加なし、Node 22+ 組み込みのみ）。
