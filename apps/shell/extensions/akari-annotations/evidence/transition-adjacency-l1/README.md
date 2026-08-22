# transition adjacency — L1 証跡

隣接する同一トラックのクリップ境界だけにトランジションの丸ポチが出ることを、Electron + CDP
の実 DOM と実ポインター操作で計測する。

## フィクスチャと計測

- 10fps、同一トラック 7 クリップから、隣接 3 箇所（`0-1` / `2-3` / `4-5`）と非隣接
  3 箇所（`1-2` / `3-4` / `5-6`）を作る
- `[data-akari-transition-boundary]` の DOM 個数と dataset 値を取得する
- 各丸ポチの中心 x と、対応する後クリップ `[data-akari-ui="timeline:cut:<n>"]` の左端 x の
  差を px で記録する
- ズームスライダーを段階的に上げ、先頭クリップが 120px 以上になった状態でも横スクロールしながら
  隣接 3 箇所・非隣接 3 箇所と丸ポチ位置を再計測する
- 先頭クリップの右端を実ドラッグでトリムして `0-1` を離し、丸ポチが消えることを記録する
- 同じ Electron セッションで undo を実クリックし、`0-1` の丸ポチが戻ることを記録する
- 6 番目のクリップを同一トラックの中心 y のまま実ドラッグで右へ移動し、`4-5` の丸ポチが
  消えることと、続く undo で戻ることを記録する
- 非隣接の宣言済み `transition_out` に `[data-akari-unsupported-transition="5"]` が出て、title
  が固定の日本語メッセージであることを記録する

実行は `scripts/run-l1.sh`。CDP 接続直後に `Emulation.setDeviceMetricsOverride` で
1680×1250 へ広げる。結果は `phase-initial.json` / `phase-after-zoom.json` /
`phase-after-trim.json` / `phase-after-trim-undo.json` / `phase-after-move.json` /
`phase-after-move-undo.json` と対応する PNG に保存する。

## 実測値

`apps/shell` の production ビルド（`build:ext` + `theia build`）は browser / node / electron とも
**0 errors**。`scripts/run-l1.sh` は **exit 0**、6 フェーズすべて PASS
（`TRANSITION ADJACENCY L1 PASS`）。application shell ready まで **9,057ms**。

| フェーズ | 丸ポチ | 位置ずれ（中心 x − 後クリップ左端 x） | 判定 |
|---|---|---|---|
| initial | `0-1` / `2-3` / `4-5` の 3 個のみ | **0px / 0px / 0px** | PASS |
| after-zoom（cutWidth 142.25px） | 同上 3 個 | **0px / 0px / 0px** | PASS |
| after-trim | `2-3` / `4-5` の 2 個（`0-1` 消滅） | 0px / 0px | PASS |
| after-trim-undo | 3 個へ復帰（`0-1` 復活） | 0px / 0px / 0px | PASS |
| after-move | `0-1` / `2-3` の 2 個（`4-5` 消滅） | 0px / 0px | PASS |
| after-move-undo | 3 個へ復帰（`4-5` 復活） | 0px / 0px / 0px | PASS |

- 非隣接 3 箇所（`1-2` / `3-4` / `5-6`）はどのフェーズでも DOM に存在しない
  （各境界時刻まで横スクロールしたうえで不在を確認）
- 非隣接の宣言済み `transition_out` を持つクリップ 6（index 5）には
  `[data-akari-unsupported-transition="5"]` の警告ボタン（`⚠ 削除`・24.95×49px）が出て、
  title は「このトランジションは次のクリップとの間にすき間があるため書き出されません。
  すき間を詰めるか、トランジションを削除してください。」
- 移動フェーズはクリップ 6 を `at` 103 → **126** フレームへ実ドラッグし、`4-5` が消えることを確認
- 各フェーズの生値は `phase-*.json`、画面は同名の PNG

## 実測メモ

1. 既定ズームではクリップ 1 個が約 30px しかなく、トリムの実ドラッグに使える幅が無い。
   ズームスライダー（`[data-testid="akari-timeline-zoom-slider"]`）を段階的に上げ、
   先頭クリップが 120px 以上（実測 142.25px）になってから操作する。
2. **丸ポチはレーン中央・境界線上にあり、トリムの右エッジ帯（6px）を覆う**。
   実測でクリップ高さ 72px に対し丸ポチは 16px（中央 ±8px）で、
   `elementFromPoint(rect.right - 2, 中央 y)` は丸ポチを返す。丸ポチは `pointerdown` を
   `stopPropagation()` するため、中央 y からのトリムドラッグは開始すらしない。
   L1 は掴む y を `rect.top + 5` / `rect.bottom - 5` にずらして操作し、
   ドラッグ前に `elementFromPoint` が目的のクリップであることを assert している。
3. `apps/shell/node_modules/@theia/core` がルートの `node_modules/@theia/core` と二重に
   存在すると、esbuild が inversify のサービス識別子を 2 セット取り込み、Electron の
   バックエンドが `Could not unbind serviceIdentifier` で起動できない
   （フロントエンドのウィンドウだけ先に出るため気付きにくい）。L1 が接続できないときは
   まずこれを疑う。
