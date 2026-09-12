# タイムライン素材 D&D の L1 証跡

## 修正内容

素材 D&D の受け口を `stripScroll` からタイムラインパネル全体へ広げ、ツールバー、ルーラー、トラックヘッダ列、フッターなどの死に地をストリップ内の有効座標へクランプした。これにより、素材を置くか理由を表示するかのどちらかになり、無言の no-op はゼロになった。あわせて未整理カードの画像による偽ドラッグを抑止し、素材ドラッグ中の縦オートスクロールを追加した。

## L1 の採取方法

Electron を `AKARI_HOME` が一時ディレクトリを指す状態で起動した。CDP の `Input.setInterceptDrags` で素材カードの本物のドラッグを横取りして `DragData` を取得し、その `DragData` を `Input.dispatchDragEvent` の `dragEnter`、`dragOver`、`drop` として各検査点へ送った。

8px 格子の走査では `edit.json` へ 3402 回書き込まないよう、`addMaterialAt` を呼び出し記録用の代役へ差し替えた。代役が実際の配置結果と食い違わないことは、同じ CDP 手順によるツールバー帯、ルーラー帯、トラックヘッダ列、フッター帯、ストリップ内側の「実ドロップ 5 点」で `edit.json` の BEFORE/AFTER 差分を取り、全点で更新されたことによって裏取りした。

## 成果物

- `grid.json`: 8px 格子の全点記録と summary
- `autoscroll-01-top.png`: 上端ホバー時の縦スクロール状態
- `autoscroll-02-scrolled.png`: 下端ホバー後の縦スクロール状態
- `panel-final.png`: 検証完了時のタイムラインパネル
- `l1-after.json`: 全ステップの実測値

## 実測値

| 項目 | 実測値 |
|---|---:|
| タイムラインパネル | 1294 × 163 CSS px |
| 8px 格子の検査点 | 3402 点 |
| `dragover` の `preventDefault` 漏れ | 0 件 |
| document へ抜けた drag イベント | 0 件 |
| 無言 no-op | 0 件 |
| 実ドロップ | 5 / 5 点で `edit.json` 更新 |
| 未整理カードの `Input.dragIntercepted` | 0 件 |
| 下端ホバー時の `scrollTop` | 0 → 655 |
| スクロール領域 | `scrollHeight` 728 / `clientHeight` 73 |
| 上端ホバー時の `scrollTop` | 655 → 0 |
| 可視外の行へのドロップ | 成功 |

