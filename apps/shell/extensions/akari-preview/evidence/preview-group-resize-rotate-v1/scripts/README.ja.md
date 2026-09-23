[English](./README.md) | **日本語**

# プレビュー group 拡縮・回転 L1

シェルのビルド後に `scripts/run-l1.sh` を実行します。スクリプトは素材プロジェクトを `/tmp` の使い捨てワークスペースへ複製し、隔離 profile の Electron に CDP で接続して、実際のポインターとキー入力を送ります。group のハンドル・拡縮・回転と Shift 吸着、袋の拡縮・回転、葉の回転、回転済み group 内の葉の拡縮、Esc 中止、既存 group ドラッグの数値を 8 項目で確認します。

結果はこの evidence ディレクトリの `run-log.json` と各ステップのスクリーンショットに記録します。元 fixture と製品リポジトリは編集しません。`AKARI_CDP_PORT` と `ELECTRON_BIN` でポートと Electron 実体を指定できます。ポート使用中は起動前に失敗します。Electron の実走はエージェントの sandbox 外でラッパーが行います。
