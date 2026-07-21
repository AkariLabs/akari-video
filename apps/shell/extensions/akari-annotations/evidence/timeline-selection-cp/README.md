# evidence: timeline-selection-cp

## 対象

- 字幕・オーバーレイの単一選択、Escape 解除、ファイル更新後の選択復元
- タイムラインとプレビュー webview のオーバーレイ選択双方向同期
- アプリ内コピー＆ペースト、行ベース字幕挿入、文字列パッチ式 overlay 挿入
- ペーストの undo/redo と Wave 21 の再生同期・ドラッグ・ズーム・クリックシーク回帰

## L0

`apps/shell` で以下を実行し、すべて exit 0（2026-07-21、ラッパー自身が再実行して独立確認済み）。

- `npm run build:ext`
- `npm run lint`
- `npm run build`（browser/node/electron が各 0 errors）
- `node --check extensions/akari-annotations/evidence/timeline-selection-cp/scripts/run-l1.mjs`
- `node --check extensions/akari-annotations/evidence/timeline-selection-cp/scripts/cdp-lib.mjs`

字幕・オーバーレイのストア関数は fixture の生テキストへ挿入・削除を行い、次を実測した。

- 字幕 ID 順: `caption-a, caption-copy, caption-b`（時刻順位置）
- 新字幕は 1 件 1 行形式
- overlay ID 順: `overlay-a, overlay-a-copy`
- 両形式とも挿入後の削除で元の入力へバイト単位で復元

## プレビュー選択の実現手段

`packages/overlay-runtime` は無編集。webview のホストメッセージ受信時、既存 `interaction.js` が公開している
DOM イベント挙動を使う。

- 選択: 対象 `[data-overlay-id]` の可視断片中央へ bubbling `MouseEvent('click')` を送る
- 解除: webview の `window` へ `KeyboardEvent('keydown', { key: 'Escape' })` を送る

これにより `interaction.js` 内部の `selectOverlay` / `clearSelection` が通常操作と同じ経路で動き、
`data-akari-interaction-selected="true"`、変形ハンドル、追従枠をまとめて更新する。属性だけを外部から
直接変更して内部選択状態と乖離させる実装にはしていない。

`removeCaption` / `removeOverlay` はペースト HistoryEntry の undo 専用内部 API としてのみ呼び出し、
Delete キーや削除 UI には接続していない。

## L1 実測 — 総合判定: PASS

検証環境: production ビルド（`npm run build`）の Electron を隔離 user-data-dir + `--remote-debugging-port`
で `--no-sandbox` 起動し、生 CDP（`scripts/cdp-lib.mjs`）で実際のマウス・キーボード・wheel イベントを
ディスパッチして操作した。ワークスペースは `templates/project-default/`（`.akari/` 込み）を
`<SCRATCH>/l1-ws/` へ展開し、fixture（`fixture/`。12秒・640x360・h264/yuv420p 映像 + MP3 音声、
3 cuts・2 captions・1 overlay）を配置したもの。`ALL ACCEPTANCE CRITERIA PASSED`（アサーション 48 件
全通過、`run-log-final.json` に一括走行の全記録）。

再現コマンド:

```sh
node apps/shell/extensions/akari-annotations/evidence/timeline-selection-cp/scripts/run-l1.mjs \
  <cdpPort> <workspaceDir> <evidenceDir>
```

| # | 受け入れ条件 | 結果 | 実測値 |
|---|---|---|---|
| 1 | 字幕クリック選択・Escape解除・renderStrip後の選択維持 | **PASS** | 下記「L1-1」 |
| 2 | オーバーレイのタイムライン選択 → プレビュー webview 側の選択属性 | **PASS** | 下記「L1-2」 |
| 3 | プレビュー側選択 → タイムライン側ハイライト | **PASS** | 下記「L1-2」 |
| 4 | 字幕 Cmd+C/V → captions.json 挿入・undo/redo | **PASS** | 下記「L1-3」 |
| 5 | オーバーレイ Cmd+C/V → edit.json 挿入・既存整形保存・undo/redo | **PASS** | 下記「L1-4」 |
| 6 | ペースト対象なし／input フォーカス中 Cmd+V の無害性 | **PASS** | 下記「L1-3」 |
| 7 | 回帰（再生同期・ドラッグ・ズームHUD・クリックシーク） | **PASS** | 下記「L1-5」「L1-6」 |
| 8 | evidence 実測値記録・内部パス秘匿 | 本ファイル | — |

### L1-1: 字幕選択・Escape・renderStrip 後の維持

- `.akari-annotations-strip-caption` クリック → `selectedItems: [{kind:'caption', id:'caption-a'}]`、
  クラスに `akari-annotations-selected` 付与を実測（`20-caption-selected.png`）
- Escape → `selectedItems: []`（解除）
- 外部ファイル書き換え（captions.json の mtime のみ更新 = renderStrip 再構築を誘発）後も
  `selectedItems` は `caption-a` のまま維持（id 照合による選択復元）

### L1-2: タイムライン ⇔ プレビューのオーバーレイ選択双方向同期

- **timeline → preview**: オーバーレイをタイムラインでクリック →
  プレビュー webview 内 `[data-overlay-id="overlay-a"]` に
  `data-akari-interaction-selected="true"` が実測（`22-timeline-to-preview-overlay-selected.png`）。
  タイムライン側も同時に `akari-annotations-selected` 保持
- **preview → timeline**: Escape で両側解除後、webview 内で overlay-a へ合成 click →
  タイムライン側 `selectedItems: [{kind:'overlay', id:'overlay-a'}]` が実測（シークなし、
  `23-preview-to-timeline-overlay-selected.png`）
- **実装上の注意（検証で判明・コード修正）**: `renderInspector`（プレビュー webview 内、
  `akari-preview-open-handler.ts` の `previewBootstrapScript()`）が新規選択通知コードで
  `vscode.postMessage(...)` を直接呼んでいたが、`vscode` 変数は別の `<script>` タグ
  （`hostAdapterScript()`）のクロージャにのみ存在し、`previewBootstrapScript()` 側からは未定義。
  実機 CDP で `ReferenceError: vscode is not defined at MutationObserver.renderInspector` を捕捉して
  特定。修正は既存の `window.akari.*` ブリッジ規約に合わせ、`hostAdapterScript()` 側に
  `window.akari.reportOverlaySelection` を追加し `previewBootstrapScript()` からはそれを呼ぶ形へ
  変更（codex への 2 回目の委譲で修正。詳細は report.md）

### L1-3: 字幕コピー＆ペースト・undo/redo・無害性

- クリップボード未設定での Cmd+V: captions.json / edit.json とも無変化
- Cmd+C 未選択かつ input フォーカス中の Cmd+V: captions.json 無変化
- caption-a（start=1, end=2.5, "first caption"）を Cmd+C → 7 秒付近へシーク → Cmd+V:
  新規 `caption-copy`（start=6.9939, end=8.4939, duration=1.5 一致, text 一致）が
  時刻順位置へ 1 行形式で挿入（実ファイル確認）。playheadT はクリック位置の px 量子化を
  経由するため厳密に 7.000 ではなく 6.9939（許容誤差 0.05 秒以内）
- Cmd+Z → captions.json から `caption-copy` 消滅（実ファイル確認）。Cmd+Shift+Z → 再出現

### L1-4: オーバーレイコピー＆ペースト・undo/redo・整形保存

- overlay-a を Cmd+C → 8 秒付近へシーク → Cmd+V: 新規 `overlay-a-copy`
  （start=7.9962, duration=3 一致, transform/vars 一致）が edit.json の overlays[] へ挿入
- 挿入前後で overlays[] 外の prefix/suffix（バイト列）が完全一致（`outsidePrefixPreserved` /
  `outsideSuffixPreserved` とも true）— 既存の他フィールド・整形をバイト単位で保存
- Cmd+Z → edit.json が挿入前と**バイト単位で完全一致**（`overlay paste undo restores edit.json
  byte-for-byte`）。Cmd+Shift+Z → 同一 id (`overlay-a-copy`) で再出現

### L1-5: 回帰 — ズーム HUD・横スクロール・クリックシーク・ドラッグ編集

- ctrl+wheel ズームイン後のカーソル不動点誤差 `0.0123`秒（閾値 = 可視幅の2% = `0.0694`秒）
- 最小ズーム: `scrollWidth <= clientWidth`実測（738px = 738px）
- 横スワイプパン: `scrollLeft` 699.49→949.86px。左端 `scrollLeft:0`、右端 `1755.35`
  （`maxScroll:1756.44` とほぼ一致）
- クリック→シーク: タイムライン 4.5 秒相当クリック → footer
  「00:00:04.500 にプレビューをシークしました。」→ プレビュー `currentTime` 実測 `4.49986`
  （誤差 0.00014秒）
- ドラッグ編集回帰: cut-trim（`cuts[0].in`: `0.5→0.68838`）・cut-reorder（`[C1,C2,C3]→[C2,C1,C3]`）・
  スナップガイド表示（word boundary 付近）・Escape キャンセル（無変化確認）・overlay-resize
  （`duration`: `3→3.18838`）・caption 移動（`start`: `1→1.28257`）・overlay 移動
  （`start`: `1→1.23547`）を実測、いずれも直後の別ドラッグが正常完走（残留症状なし）

### L1-6: 回帰 — 再生同期 playhead 追従・多段 undo/redo（Wave 21）

- **多段 undo/redo**: caption 移動 → overlay 移動の 2 操作後、Cmd+Z ×2 で逆順取消
  （overlays[0].start: `1.23547→1`、captions[0].start: `1.28257→1`）→ Cmd+Shift+Z ×2 で再適用
  （両値とも移動後の値に復帰）。ツールバーボタンでの同じ往復、スタック空時の disabled も実測
- **再生 → playhead 同期（AC4）**: 4.25 秒間（7.76秒→11.5秒、cuts 最終区間の keep-range 内）で
  playhead 1645.33→2444.51px、14 サンプル単調非減少。tick 対応誤差 worst **0.0731秒**
  （閾値 0.2秒）。一時停止で playhead 完全停止（2 サンプルとも 2444.51px 一致）
- **78% 自動追従・停止中パン保持（AC5）**: サンプル#3（可視幅 78% 超）以降 `scrollLeft`
  1264.83→1755.35px に増加。停止中の手動スクロール（目標 1555.35、実測 1553.96、誤差 1.4px）は
  auto-follow に引き戻されない
- **実装上の注意（検証環境固有・製品コード無変更）**: このサンドボックス実行環境には音声出力
  デバイスが無く、音声トラック有りの `<video>` で `play()` すると Chromium のメディアクロックが
  進行せず `currentTime` が完全に静止する（`muted=false` で 1.5 秒待っても不動、`muted=true` で
  同条件から正常進行することを実測して特定）。`tick()`/playheadT 同期ロジックは
  `video.currentTime`/`paused` のみを参照し `muted` を見ないため、検証ドライバ側で該当区間のみ
  `video.muted = true` にして環境の音声出力欠如を回避した（`run-l1.mjs` に注記あり）

## 発見した問題と対処（すべて検証ドライバ側 or 別ラウンドの codex 委譲、詳細は report.md）

1. **playheadT の px 量子化**: クリックで立てた `playheadT` は厳密に整数秒にならないため、
   ペースト位置の等値アサーションを 0.05 秒許容誤差に変更（検証ドライバのみ）
2. **webview フォーカス奪取**: プレビュー webview を一度でも開閉・操作すると、CDP の
   `Input.dispatchKeyEvent` がメインウィンドウでなく webview 側に配送され続ける現象を実測。
   Escape/Cmd+C/Cmd+V/Cmd+Z 系の直前にタイムラインウィジェットのツールバーを実クリックして
   フォーカスを戻す `focusWidgetToolbar()` を追加（検証ドライバのみ）
3. **`renderInspector` の `vscode` 未定義参照**: 上記「L1-2」参照。**製品コードのバグ**。
   codex への 2 回目の委譲で `window.akari.reportOverlaySelection` ブリッジを追加して解消
4. **webview の executionContext 失効**: AC9/AC7/AC8 の一連の write 操作後、古い
   `executionContextId` が無効化されることを実測（`Cannot find context with specified id`）。
   `connectPreview()` を関数化し、AC6 セクション前で再接続するよう変更（検証ドライバのみ）
5. **音声出力デバイス不在によるメディアクロック停止**: 上記「L1-6」参照。検証ドライバのみで
   ミュート回避（製品コード無変更）

## 実測ログ

`run-log-partial-1.json`〜`run-log-partial-3.json`・`run-log-partial-5.json`・`run-log-final.json`
に各フェーズの実測値・assertion 結果を構造化記録（`ALL ACCEPTANCE CRITERIA PASSED` は
`run-log-final.json` 末尾で確認可能）。`fixture/` に検証用フィクスチャ（edit.json / captions.json /
review.json / analysis.json / overlay-a.html、動画本体は検証後に破棄しコミットしていない）。
`scripts/cdp-lib.mjs` / `scripts/run-l1.mjs` が検証ドライバ本体（依存追加なし、Node 22+ 組み込みのみ）。
