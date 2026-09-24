[English](./README.md) | **日本語**

# プレビューの重なり順 L1 計測

Electron シェルをビルドした後、このディレクトリから `bash scripts/run-l1.sh` を実行します。ランナーは隔離した作業領域とユーザーデータ領域を作成・削除し、ここに `run-log.json` と 6 枚のスクリーンショットを出力します。

検査するのは、重なった背面の葉を最前面へ動かして 1 回の undo で戻す、group の子を右クリックで前面へ動かす、タイムラインの `]` で同じ移動を行う、最前面でのフッター文言と edit.json 不変、複数選択と袋の部品で z 項目が出ない、の 6 場面です。

macOS の右クリックは Theia のネイティブメニューになるため、`electronMenuFactory.createElectronContextMenu` の表示テンプレートを捕捉してモーダル popup を抑止し、選択項目の `execute` を呼びます。他の環境では DOM メニューを読みます。`]` は `KeybindingRegistry.resolveKeybinding` で物理 `code` と `keyCode` を解決してから CDP キーイベントを送ります。JIS 配列の Mac では `Backslash` になる場合があります。書き込み後の undo は、履歴が積まれたことを示すタイムラインのフッター完了文言を待ってから実行します。

ラッパーは最終ランナーパッチを使い捨てコピーへ適用して 6 場面すべての通過を報告しています。Electron 計測と実走ログはラッパーが担当します。
