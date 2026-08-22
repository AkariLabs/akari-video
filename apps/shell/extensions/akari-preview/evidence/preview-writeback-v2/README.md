# preview-writeback-v2 — 出力プレビューの書き戻しを v2 対応した L1 実測

task/2026-08-22-preview-writeback-v2 の検証記録（L0 + L1）。
`handleOverlayWrite` / `handleLayerWrite` / `handleCutWrite` が edit.json v0/v1 の形
（`overlays[]` / `layers[]` / `cuts[]`）しか知らず、v2（`tracks[].items[]` のみ）では
例外で即死して 1 バイトも書けなかった問題を直し、実機（Electron + CDP）で確認した。

## フィクスチャ

`scripts/` の L1 ドライバが使う v2 プロジェクト（検証用に生成。リポには置かない）:

- `assets/talk.mp4` — `ffmpeg -f lavfi -i testsrc=1280x720:rate=30:duration=6`
- `overlays/title.html` — 断片 HTML（`edit.v2-before.json` の `title-1` が参照）
- `edit.json` — v2。visual 3 トラック
  （`clip-1` = media カット / `pip-1` = `blend:"screen"` の PiP レイヤー / `title-1` = html 断片）

`edit.v2-before.json` → `edit.v2-after.json` が L1 の操作前後の実差分。
`title.before.html` → `title.after.html` がダブルクリック編集の実差分。

## ログ

| ファイル | 内容 |
|---|---|
| `l0-prefix-repro.log` | **修正前ビルド（HEAD 1f9796e4）での再現**。同じ v2 フィクスチャで overlayWrite / layerWrite が `edit.json の overlays が配列ではありません` / `... layers が ...` で reject され、edit.json も断片 HTML も 1 バイトも変わらない |
| `l1-phase1.log` | 修正後: ドラッグ・四隅拡縮・ダブルクリック編集の実測（下表） |
| `l1-failure-banner.log` | 書き込み失敗時にユーザーへ理由が見えること（edit.json を chmod 444 → EACCES をバナー表示 → × で閉じる） |
| `l1-phase2-after-restart.log` | アプリ再起動後も位置・倍率・テキストが保持されること |
| `l1-legacy-v1-prefix.log` / `l1-legacy-v1-fixed.log` | v1 プロジェクトの非回帰（修正前後で同一挙動） |

## L1 実測（phase1）

| 操作 | 実測 |
|---|---|
| overlay ドラッグ（`title-1`） | `transform.x` 0 → 315.0202786604387（`tracks[2].items[0]`） |
| overlay 四隅拡縮（se ハンドル） | `transform.scale` 1 → 1.8507825571585563 |
| layer ドラッグ（`pip-1`） | `transform` {0,0} → {150.14662756598239, 60.058651026392965} |
| layer 四隅拡縮（se ハンドル） | `transform.scale` 0.4 → 0.6070001307487725 |
| 断片テキスト編集 | `overlays/title.html` が書き換わり、**edit.json は無変更**（`editJsonUnchanged: true`）・`items[].source` は `{kind:"html", path:"overlays/title.html"}` のまま |
| 再起動後 | DOM の `--x` / `--scale` / テキストが上記の保存値と一致 |

## スクリーンショット

`l1-01-opened.png` → `l1-06-after-restart.png`。`l1-05-write-error-banner.png` が
書き込み失敗の可視化（高コントラストの赤バナー + × ボタン）。

## 再現手順

Electron を CDP つきで起動し（`--disable-features=MacWebContentsOcclusion` と
`caffeinate -d -i -m -s -u` を併用しないと、ディスプレイスリープでレンダラが凍結して
`Page.enable` / `Runtime.evaluate` がタイムアウトする — 本タスクで実測）、

```sh
node scripts/run-l1.mjs <cdpPort> <v2ProjectDir> <outDir>       # ドラッグ・拡縮・テキスト編集
node scripts/run-failure.mjs <cdpPort> <v2ProjectDir> <outDir>  # 失敗の可視化
node scripts/run-phase2.mjs <cdpPort> <v2ProjectDir> <outDir>   # 再起動後の保持
node scripts/run-repro.mjs <cdpPort> <v2ProjectDir>             # 修正前ビルドでの再現
node scripts/run-legacy.mjs <cdpPort> <v1ProjectDir> <label>    # v1 非回帰
```

`scripts/cdp-lib.mjs` は `akari-annotations/evidence/t4-track-height-resize/scripts/cdp-lib.mjs`
からの複製に、`connect` / `send` のタイムアウトだけ足したもの。
