[English](./README.md) | **日本語**

# プレビュー・マーキー L1

このランナーは `preview-multi-select-v1` 型の使い捨てプロジェクトを用意します。ルートの HTML 3 枚、子 2 枚を持つ group、リポジトリの小さな動画 fixture からコピーした半分の大きさのカットを含みます。カットの周囲にはステージ内で映像の無い帯が残ります。隔離したプロファイルで Electron を起動し、CDP の実ポインタ・キー入力で操作します。スクリーンショットと `run-log.json` はこのディレクトリ（または `AKARI_EVIDENCE_DIR`）に保存します。

実行前に edit-store、preview-server のランタイム bundle、shell をビルドします。

```sh
npm --prefix packages/edit-store run build
npm --prefix packages/preview-server run build
npm --prefix apps/shell run build
bash apps/shell/extensions/akari-preview/evidence/preview-marquee-v1/scripts/run-l1.sh
```

`AKARI_CDP_PORT` の既定値は他のプレビュー検証と分けた `9774` です。`ELECTRON_BIN` で実行ファイルを差し替えられます。使用中のポートは拒否し、自分が作った一時作業場・プロファイル・Electron プロセスだけを片付けます。実走はラッパーが行います。スクリプトの存在は L1 合格を意味しません。

9 項目は、2 枚のマーキー選択とタイムライン 2 行、⌘G、映像の素ドラッグ、映像上の Shift マーキー、200% でのパンと Shift マーキー、Shift 加算、Esc 取消、group 内の子だけの選択、静止した空きクリックでの解除を確認します。group 化は後続項目の前に undo します。検証対象の操作には CDP 入力を使い、セットアップと観測にはアプリのコマンド・DOM 読み取りを使います。

ランナーはオーバーレイのマウントを待ってから枠を計測します。

step 3 は undo 後にカットが操作可能になるまで待ちます。プレビューの描き直し中にホストがドラッグを落とした場合、同じ操作を最大 3 回試し、各試行を `attempts` に記録します。step 5 は準備として Alt ドラッグで左上のパン端まで寄せ、ステージ内の映像の無い帯を画面に出します。その空きからの素のドラッグは、マーキーを始めずにパンし、カットとオーバーレイ選択を変えないことを確認します。映像の上からの Shift ドラッグは、パンを変えずにマーキーを表示することを確認します。step 9 はステージ外の余白を動かさずにクリックしても選択が残ることを記録し、続いてステージ内の映像もオーバーレイも無い点をクリックして選択が解除されることを確認します。
