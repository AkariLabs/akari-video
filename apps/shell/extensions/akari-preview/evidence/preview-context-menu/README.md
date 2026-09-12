# preview-context-menu — 出力プレビューの右クリックで空メニューが出る件の L1 証跡

対象: 出力プレビュー（webview）の右クリック。修正前は「中身ゼロのコンテキストメニュー」が
要求されていた（オーナー報告の「黒い丸ポチ」）。修正は webview 内で `contextmenu` を
capture 段階で 1 本受け、`preventDefault()` したうえでホストへ `akari-preview-context-menu`
を送る（ホストは本票ではログのみ）。

## 実行方法

```
AKARI_FRAME_ENGINE=1 AKARI_L1_LABEL=after-frame-engine AKARI_CDP_PORT=9475 node run-l1.mjs
AKARI_FRAME_ENGINE=0 AKARI_L1_LABEL=after-legacy       AKARI_CDP_PORT=9476 node run-l1.mjs
```

`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` はすべて `mkdtemp` した一時ディレクトリ。
実利用の `~/.akari` `~/.theia` は読み書きしない。終了時は spawn した pid だけを指名 kill する。

## 何を測っているか

Theia の webview pre-script は `contextmenu` を受けて `did-context-menu` をホストへ送るが、
その先頭で `if (e.defaultPrevented) return;` する。したがって webview 内で
`preventDefault()` すれば要求自体が発生しない。計測はこの鎖を 3 点で押さえる。

| 計測点 | 取り方 |
| --- | --- |
| `defaultPrevented` | webview の isolated world に `document` bubble で probe を張り、実マウス右クリック 1 回のイベントを読む |
| `hostHandleContextMenuCalls` | ホスト側 `WebviewWidget.handleContextMenu`（= `did-context-menu` の受け口）を包んで呼び出しを数える |
| `contextMenuRenderRequests` | `ContextMenuRenderer.doRender` を包み、`menuPath` と**項目数**を記録する |

## 実測（2026-09-12・macOS arm64・dev ビルド）

| run | defaultPrevented | handleContextMenu | doRender 要求 | `.lm-Menu` ピーク | ホストが受けた payload |
| --- | --- | --- | --- | --- | --- |
| before / frame-engine | `false` | 1 回 | `webview-context-menu` items **0** | 0 | — |
| before / legacy | `false` | 1 回 | `webview-context-menu` items **0** | 0 | — |
| after / frame-engine | `true` | **0 回** | **0 件** | 0 | `{x:0.5, y:0.5027, timelineT:0}` |
| after / legacy | `true` | **0 回** | **0 件** | 0 | `{x:0.5, y:0.5027, timelineT:0}` |

`.lm-Menu` が before でも 0 なのは**このビルドが DOM メニューを使っていないから**で、
症状が出ていないからではない。`titleBarStyle` が `native` のため Theia は
`ElectronContextMenuRenderer` の**ネイティブ経路**（`electronTheiaCore.popup`）を通り、
OS 側のメニューとして描かれる。ネイティブメニューはページのサーフェスに含まれないので
`Page.captureScreenshot` にも `document.querySelectorAll('.lm-Menu')` にも写らない。
そのため harness は 1 段上流の `doRender` 要求（`menuPath` + 項目数）を証跡に採り、
実 popup は抑止している（モーダルで計測が止まるため）。

同じ理由でスクリーンショットは右クリック前後で**バイト一致**する（削除した押下前ショットの
sha256 = 押下後ショットと同一。after/frame-engine `261a07e0…`, after/legacy `99fb7173…`,
before/frame-engine `d5929efc…`, before/legacy `6fe98c3c…`）。ここに残したのは押下後の 1 枚ずつ。

## ファイル

- `run-l1.mjs` — 検証用ハーネス（ラッパー作成・製品ソースではない）
- `run-log-<label>.json` — 全計測（作業機のパスは `<WORKTREE>` / `<TMP>` / `<HOME>` へ置換済み）
- `<label>-after-right-click.png` — 右クリック直後の画面
