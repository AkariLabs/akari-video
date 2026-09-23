[English](./README.md) | **日本語**

# 辺ハンドル L1

ビルド済みの AKARI Electron shell と、`fetch`・`WebSocket` が使える Node で実行する。

```sh
bash apps/shell/extensions/akari-preview/evidence/preview-edge-handles-v1/scripts/run-l1.sh
```

`AKARI_CDP_PORT` の既定値は **9771**。`ELECTRON_BIN` で Electron 実行ファイルを指定できる。起動スクリプトは使用中のポートを拒否し、隔離したプロジェクト・ユーザーデータを作り、Theia の起動を待ってから自身のプロセスと一時ファイルを片付ける。shell のビルドは行わない。`run-log.json` に指示 8 の 9 項目それぞれの実測値と `ok` / `ng` を残し、失敗時は exit 1。fixture は `object-tree-html-bag` をコピーして `g1` を `outer` に包み、`g1.second` を 30° 回転する。製品リポジトリにはコミットしない。

Electron を起動せず構文だけ確認する場合:

```sh
node --check apps/shell/extensions/akari-preview/evidence/preview-edge-handles-v1/scripts/prepare-fixture.mjs
node --check apps/shell/extensions/akari-preview/evidence/preview-edge-handles-v1/scripts/run-l1.mjs
bash -n apps/shell/extensions/akari-preview/evidence/preview-edge-handles-v1/scripts/run-l1.sh
```

ハンドルとインスペクターのスクラブは CDP のポインター入力で操作する。`Runtime.evaluate` は既存 UI を開く、シークする、透過的な書き込み観測を付ける、DOM 状態を読む目的で使う。(1) ハンドル 9 個、(2) X だけと対辺不動・1 回書き込み、(3) Y だけ、(4) 回転葉の直角、(5) Shift の自由変形と通常角の等比、(6) group の辺なし、(7) HTML のライブ CSS と幅の保存、(8) プレビュー操作後のインスペクター更新、(9) 拡縮 50%→100% で軸比保持を個別判定する。

辺ドラッグの「X だけ」「Y だけ」は、その軸の**有効倍率だけが変わる**という判定。edit-store の契約では片軸の指定でも両軸キーを明示保存する。インスペクターの確定後は、差し替わったプレビュー iframe へ再接続して葉を選び直してから次の操作へ進む。
