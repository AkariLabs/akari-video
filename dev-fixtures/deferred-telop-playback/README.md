# deferred-telop-playback — L1 検証ハーネス

ネイティブテロップ（`source.kind: "telop"`）の遅延ラスタライズについて、
**焼き中はプレースホルダが見える / 焼き上がった瞬間に（再生中でも）その場で表示が始まる /
焼き上がり後の通し再生・シークが非回帰** を、production ビルドの Electron + CDP + 実 DOM で実測する。

## 使い方

```sh
cd apps/shell && npm run build          # production ビルド（L1 の前提）
cd ../.. && node dev-fixtures/deferred-telop-playback/run-l1.mjs
```

`edit.json` を持つプロジェクトを隔離コピーして Electron を起動し、`出力プレビュー` タブを
前面化してから webview 内の実 DOM を requestAnimationFrame ごとにサンプリングする。
既定ではテンプレート + ffmpeg で合成プロジェクトを作る。

| 環境変数 | 意味 |
|---|---|
| `AKARI_L1_PROJECT` | 既存プロジェクトを隔離コピーして使う（原本は無改変） |
| `AKARI_L1_OUTPUT` | コピー側の出力解像度を上書き（例 `640x360`） |
| `AKARI_L1_FPS` | コピー側の出力 fps を上書き（尺は秒で保つようフレーム番号を換算） |
| `AKARI_L1_TELOP_EXTEND` | `1` で telop を全尺へ延長 |
| `AKARI_L1_READY_TIMEOUT_MS` | 焼き上がり待ちの上限（既定 300000） |
| `AKARI_L1_OUT` | 結果 JSON / スクリーンショットの出力先 |

`AKARI_L1_OUTPUT` / `AKARI_L1_FPS` は**測定のためだけの逃げ道**である。テロップ焼成は
「解像度 × 焼くフレーム数」に比例して重く、`rasterizeTelopPreview` 側には 120 秒の
タイムアウトがある。負荷の高いマシンでは 1920x1080 / 30fps / 3 秒（90 フレーム）の焼成が
このタイムアウトを超えて `Telop rasterize timed out` になり、**焼き上がり自体が観測できない**。
解像度と fps を落とすとタイムライン上の秒尺を変えずに焼成フレーム数だけ減らせる。

## 計測パス

| pass | 何を見るか |
|---|---|
| pass1 | 開いた直後に 0:00 から即再生。焼き中に区間へ入ったときの見た目と、カット境界をまたぐ通し再生の連続性 |
| pass1b | 区間の中で再生を続けながら焼き上がりの瞬間を待つ。区間端まで来たら区間頭へ戻す（`loop-seek` として時刻を記録）。焼き上がり → 表示までの遅延と、その間にシークが挟まっていないことを判定する |
| pass2 | 焼き上がり後に 0:00 から通し再生（非回帰） |
| pass3 | 一時停止のままテロップ区間内を 6 点シーク（非回帰。スクラブ中に「準備中」が誤表示されないこと） |

## result.json の主要フィールド

- `bakeReadyMs` / `firstVisibleMs` / `readyToVisibleMs` — 焼き上がり（`proxyMissing=false`）から
  実 DOM の `<video>` が可視になるまでのミリ秒
- `visibleWhilePlaying` — 可視になった瞬間に再生中だったか
- `seekBetweenReadyAndVisible` / `visibleAfterLastSeekMs` — 表示が「次のシーク待ち」ではないことの根拠
- `placeholderSeenWhileBaking` / `placeholderText` / `placeholderStates` — 焼き中の見た目
- `placeholderFramesAfterReadyInWindow` / `placeholderFlashFramesWhilePaused` — 焼き上がり後に
  「準備中」が出ていないこと（0 が期待値）
- `visibleFramesInWindow` / `framesInWindow` / `blankFramesInWindow` — 区間内の表示率
- `maxTimelineBackJumpSec` / `crossedCutBoundaries` — 再生時刻がカット境界で巻き戻らないこと
- `maxTelopClockDriftSec` — テロップの `currentTime` とタイムライン時刻のずれ

## evidence/

最終走行の証跡。スクリーンショットはプレビュー webview の矩形だけを clip している
（タブのツールチップが作業ディレクトリの絶対パスを出すため、上端 90px も外す）。

| ファイル | 内容 |
|---|---|
| `01-baking-placeholder.png` | 焼き中に区間へ入った瞬間（`テロップを準備中…`） |
| `02-telop-visible-while-playing.png` | 焼き上がり直後・再生中・区間内でテロップが出ている |
| `03-second-playthrough.png` | 2 回目の通し再生の終了時点 |
| `04-seek-visible.png` | 一時停止シーク後にテロップが出ている |
| `result.json` | 上記フィールドの実測値（パスは `<REDACTED>` に正規化済み） |
