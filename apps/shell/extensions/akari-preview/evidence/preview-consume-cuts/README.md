# preview-consume-cuts — L1 実測（keep-range ギャップレス再生）

タスク: `2026-07-20-preview-consume-cuts`。`akari-preview` の `<video>` プレーヤーが
edit.json の `cuts[]`（keep-range）を消費し、残す区間だけをタイムライン順に
ギャップレス再生するようになったことを、Electron 実機 + 生 CDP（`playwright-core` 等の
追加依存なし・Node 22+ 組み込みの `fetch`/`WebSocket` のみ）で検証した記録。

手法は `docs/e2e-method/README.md` 確立の二重 iframe 到達法（外側 `webview/index.html`
ターゲットへ直接 CDP 接続 → `Page.getFrameTree` + `Runtime.executionContextCreated` で
内側 `active-frame` の実行コンテキストを特定）を踏襲。

## フィクスチャ

- 素材: `ffmpeg -f lavfi testsrc=1280x720:rate=30:duration=30` + `sine` 音声（30秒、実ファイル。
  リポジトリには含めない・検証用に都度生成）
- `edit.json`（初期状態）:
  - `cuts`: `[{in:2,out:6}, {in:12,out:15}, {in:20,out:24}]`（source 秒。合計 timeline 長 = 11秒）
  - `overlays`: `ov-a`（`start:1, duration:2` = **timeline 秒**）
  - `captions.json`: `cap-in-cut1`(source `[3,4)`、cut1 内)/`cap-in-cut2`(source `[13,14)`、cut2 内)/
    `cap-in-gap`(source `[8,9)`、cut1〜cut2 の間の「切り落とし区間」— 通常再生では絶対に
    到達しないことの陰性対照)

`run-consume-cuts-e2e.mjs` はこのフィクスチャの生成手順は含まない（引数で
`workspaceDir` を受け取るだけ）。再実行する場合は上記を自分で用意すること。

## 実行手順（再現用）

```sh
cd apps/shell
PYTHON=/usr/bin/python3 npm install --no-workspaces   # 初回のみ
# electron dist の allow-scripts 回避（verify スキル L1 節参照）
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  <apps/shell 絶対パス> <フィクスチャ workspace 絶対パス> \
  --remote-debugging-port=<port> --user-data-dir=<隔離dir> --no-sandbox &

node run-consume-cuts-e2e.mjs <port> <フィクスチャ workspace 絶対パス> <evidence 出力先>
```

## 受け入れ条件との対応

| # | 受け入れ条件 | 実測結果 | 証跡 |
|---|---|---|---|
| 1 | cuts 3個で残す区間だけが順に再生され、切り落とした区間が飛ばされる | Phase A: `<video>.currentTime` を再生中に178点サンプリング（`playbackRate=4`で最後まで）。**全サンプルが3つの keep-range のいずれかに収まる（範囲外0件）**。最後の区間の `out`（24.0秒）で自動停止（`endedPaused:true`, `finalTime:24`） | `run-log.json` の `phaseA-playback-samples` / `phaseA-out-of-range-check`、`phaseA-samples.json`、`02-after-full-playthrough.png` |
| 2 | シークバーが出力全長を示し、途中シークが正しい source 位置へ飛ぶ | 初期状態で `#seek.max` = `"11"`（= Σ(out-in) = 4+3+4）。timeline秒 `5.5` を `#seek` にセット → segment1(`[12,15)`)内のオフセットへ変換され `video.currentTime` = `13.5` に一致 | `run-log.json` の `phaseA-initial-state` / `phaseA-seekbar-timeline-to-source`、`01-preview-opened.png`（`0:00/0:11` 表示） |
| 3 | cuts を1つトリム（out を縮める）→ 再生がその新しい境界で次区間へ飛ぶ | cut1 の `out` を `6.0→4.0` に書き換え（file-watch 経由でリロード）。`#seek.max` が `9`（新合計 2+3+4）に更新。`source=3.5` から再生 → **旧境界(6.0)ではなく新境界(4.0)で `12.0` へジャンプ**し、以後 `15.022→20`（次のギャップも正しく飛ぶ）→ `24` で停止。旧 `[4,6)` 区間には一切滞在しない | `run-log.json` の `phaseB-*`、`04-after-trim-boundary.png` |
| 4 | cuts 配列の順序を入れ替え → 再生順が変わる | `[cut1(trim後2-4), cut2, cut3]` → `[cut2, cut3, cut1]` に並べ替え。リロード後、初期位置が新しい先頭区間の `in`（`12.0`）にスナップ。再生順が `[12,15)→[20,24)→[2,4)` の順になり、`[2,4)` のサンプルは `[20,24)` のサンプルより**後**に出現することを確認。最終停止位置 = 新しい末尾区間の out（`4.0`） | `run-log.json` の `phaseC-*`、`phaseC-samples.json`、`05-after-reorder.png` |
| 5 | cuts 空のプロジェクトで従来どおり全体再生（後方互換） | `cuts:[]` に書き換え。`#seek.max` が素材全長（`30`）に復帰。かつては cut1/cut2 間の「切り落とし区間」だった `source=8` 付近から再生しても、**スキップなく単調増加**（`8.046→20.042`）で連続再生されることを確認 | `run-log.json` の `phaseD-*`、`06-empty-cuts-full-playback.png` |
| 6 | 非退行（オーバーレイ・字幕・スペース再生・外部シーク） | オーバーレイ `ov-a`（timeline `[1,3)`）: `source=2.5`(timeline0.5)で`hidden`→`source=3.5`(timeline1.5)で`visible`→`source=5.5`(timeline3.5)で`hidden`、**source 秒ではなく timeline 秒で可視判定されていることを実測**（本タスクの核心=`window.akari.runtime.tick()`への時刻ドメイン変換の検証）。字幕は source 秒のまま追従（`source=3.5`→`cap-in-cut1`、`source=13.5`→`cap-in-cut2`）。外部シーク（`akari-preview-seek` message）は source 秒のまま`currentTime`に直接反映（`13.0`指定→`13`、契約不変を確認）。スペースキーで再生/一時停止トグル | `run-log.json` の `phaseA-overlay-caption-timeline-domain` / `phaseA-seekbar-timeline-to-source` / `phaseA-external-seek-source-domain` / `phaseA-space-toggle`、`03-overlay-caption-window.png` |

## 外部シーク（source 秒 / timeline 秒どちらに合わせたか）

**source 秒のまま変更していない。** `akari-preview-seek` message ハンドラおよび
`akari.transcript.seekRequested` コマンド経由の外部シークは、`akari-transcript-widget.ts`
が `caption.start`（captions.json = source 秒アンカー）をそのまま渡す既存契約であり、
本タスクではこの受け口の契約を変更していない。**`#seek`（シークバー）の表示だけ**を
timeline 秒に変換した（既存の受け口はいじらず、表示層のみ timeline 化）。上表 #2/#6 の
実測どおり、`akari-preview-seek` に `13.0`（source 秒）を渡すと `video.currentTime` は
そのまま `13.0` になる（timeline 秒への変換は行われない）。

## スクリーンショット一覧

| ファイル | 内容 |
|---|---|
| `00-boot.png` | 起動直後 |
| `01-preview-opened.png` | `sample.mp4` を開いた直後。シークバーが `0:00 / 0:11`（出力全長）を表示 |
| `02-after-full-playthrough.png` | Phase A: 3 keep-range を最後まで再生し切った直後（`24.0` で停止） |
| `03-overlay-caption-window.png` | Phase A: オーバーレイ/字幕の timeline・source 各ドメイン確認シーケンスの最終状態（`cap-in-cut2` 表示中、シークバー `0:05/0:11`） |
| `04-after-trim-boundary.png` | Phase B: cut1.out トリム後、新境界での再生確認後 |
| `05-after-reorder.png` | Phase C: cuts 配列の並べ替え後、新しい順序での再生確認後 |
| `06-empty-cuts-full-playback.png` | Phase D: cuts 空での全体再生確認後 |

## 既知の限界（正直に書く）

- ドラッグ操作によるオーバーレイインスペクタ経由の cuts 編集 UI（`akari-annotations`
  拡張側）は本タスクの境界外（`akari-preview` のみが所有ファイル）。本検証は edit.json への
  直接書き込み（file-watch 経由のリロード）で cuts の変化を模擬した
- macOS arm64 実機のみ（Windows/Linux 未確認）
- フレーム送り（1コマ）・10秒スキップボタン自体は本タスクで意図的に変更していない
  （raw source 秒のまま。`tick()` 内の境界補正が事後的にクランプする設計）ため、
  ボタン単体の境界通過は個別実測していない（`tick()` の境界補正ロジック自体は
  Phase A〜D の全サンプリングで通過を実測済み）
- waveform（波形表示）はソースドメインのまま変更していない（本タスクのスコープ外）ため、
  cuts 環境下での波形プレイヘッド表示の非退行は個別実測していない
