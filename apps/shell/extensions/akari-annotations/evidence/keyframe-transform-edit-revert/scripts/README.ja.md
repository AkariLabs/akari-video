[English](./README.md) | **日本語**

# キーフレーム変形の再現

このディレクトリから `./run-l1.sh before` を実行する。`templates/project-default` から隔離 workspace を作り、HTML アイテムと Node だけで生成した PNG 静止画を追加し、ビルド済み Electron シェルを起動する。共通 CDP ヘルパーで Theia 本体と入れ子の preview webview を観測し、`../run-log-before.json` と `../before-*.png` を書く。既定 CDP ポートは 9493 で、`AKARI_CDP_PORT` で変更できる。シェルのビルドと Electron 実体は事前に用意する。外部メディアツールと Playwright は使わない。停止するのはこのスクリプトが起動した Electron の PID のみ。一時 workspace、user data、Theia 設定、AKARI home は終了時に削除する。

修正後は `./run-l1.sh after` を実行する。`../run-log-after.json` と `../after-*.png` を書き、全ケースが ok でなければ非ゼロ終了する。`before` は期待値との不一致があっても最後まで測ってゼロ終了する。起動または接続に失敗した場合は非ゼロ終了する。

ランナーは上記パスに完全ログを書く。完全ログは `/tmp` に移し、リポジトリには要約 JSON だけを残す。

`html-item` と `still-item` をそれぞれ測る。

| ケース | 測定 |
| --- | --- |
| `a-prepare-*` | キーフレームなしでインスペクターの X、Y、拡縮、回転、幅、高さを変更し、リサイズ・移動・回転ハンドルも操作する。 |
| `a-toggle-*` | 1 秒（30 フレーム）で点のない変形項目のボタンを押す。`after` では既存の点を消さずに観測する。前後の画面、preview CSS 変数、選択枠の四隅、インスペクター値、保存アイテムを記録する。 |
| `b-*` | キーフレーム有効時にハンドルと数値で編集し、数秒後に保持を再測定する。 |
| `c-seed-two-points` | 一時 fixture に 30 / 90 フレームの異なる値の 2 点を直接置く。 |
| `c-on-*`、`c-between-*`、`c-outside-*` | 1 / 2 / 4 秒でハンドルと数値の編集を繰り返し、点の上・補間中・末尾の範囲外を測る。 |
| `d-single-undo` | 移動を 1 回行い、Theia のキーボード undo を 1 回送り、前・操作後・undo 後のアイテムを比較する。 |
| `e-seek-away-return` | 別時刻へ移動して戻し、表示値を比較する。 |

ランナーの完全ログには各操作の `expected`、`observed`、`status`、アイテムの前後、基準 transform と時刻別キーフレームの差分、preview 書き込み journal と応答、書き込みなし／基準値へ書いて評価値に隠れた場合を分ける診断を残す。ハンドル書き込み失敗時の `error` には webview の Promise reject、host 応答、表示中のエラーバナーも含める。コミットする要約にはケース ID、アイテム、判定、該当する保存済み transform／キーフレームの差分、画面値、エラーの先頭行を残す。数値は小数第 6 位までとし、キーフレーム差分は変化した transform 項目だけを残す。完全ログ内のスクリーンショット名は証跡ディレクトリからの相対名。個別ケースが失敗しても計測は継続する。

frame-engine 表示中の静止画カットでは、`#preview-video` の transform 属性が古いままでも、選択枠とインスペクターは現在フレームを示すことがある。完全ログには生の属性値と `datasetStale` を残し、要約には true の場合のフラグを残す。カットのシーク往復はインスペクター値と選択枠の四隅で判定する。HTML の移動は断片のヒット可能な点から始める。リサイズは両アイテムとも `se` の角を使う。
