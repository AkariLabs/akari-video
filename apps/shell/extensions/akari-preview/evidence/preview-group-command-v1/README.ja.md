[English](./README.md) | **日本語**

# プレビューのまとめる・ばらす L1

ランチャーは使い捨てのプロジェクトと Electron プロファイルを作り、CDP で実際のポインター・キー入力を送り、`run-log.json` と `step-*.png` をここに出力します。ラッパーがシェルのビルド後に実走します。スクリプトの存在だけでは L1 合格を意味しません。

```sh
bash apps/shell/extensions/akari-preview/evidence/preview-group-command-v1/scripts/run-l1.sh
```

`AKARI_CDP_PORT` の既定は `9762` です。`ELECTRON_BIN` と `AKARI_EVIDENCE_DIR` で実行ファイル・出力先を変更できます。`prepare-fixture.mjs` は既存 `preview-multi-select-v1` 型の fixture を使い捨て領域へ複製し、ルートの葉 3 件、入れ子の葉 2 件を含むグループ、HTML 袋を置きます。ランナーは契約の 8 場面を検査します。タイムラインへの複数行同期、⌘G と 1 回の undo、SCM を開かない ⌘⇧G、入れ子 Delete と 1 回の undo、右クリックからのまとめると単数時の非表示、袋の拒否とファイル不変、単数時のフッター文言、文字編集中のショートカット隔離です。対象操作は CDP の実入力で行い、準備・undo・状態観測にはアプリのコマンドや読み取りを使います。

タイムラインの選択印は tree 行とストリップのクリップの両方から読みます。編集でプレビューの実行コンテキストが作り直されたら webview に再接続し、1.5 秒へ再シークします。まとめた後は残った drill-in スコープから Shift+Enter で group へ上がり、タイムラインへの通知を確認します。⌘⇧G は AKARI と SCM の DEFAULT keymap の順位を記録し、実キーでばらせて SCM が閉じたままであることを検査します。この環境では SCM の view container が破棄済みのため、`scmView:toggle` は使いません。袋の部品は ⌘ の深いクリックで選び、その集合がタイムラインでは単数選択のままか確認します。

macOS では Theia の右クリックメニューは DOM ではなくモーダルな OS ネイティブメニューです。ランナーは `electronMenuFactory.createElectronContextMenu` が作る表示対象項目のテンプレートを捕捉し、popup を抑止します。選択項目の `execute` を呼び、ネイティブクリックと同じ実行経路を検査します。**OS メニューそのものを物理クリックする検証ではありません**。他の環境では DOM メニューをフォールバックとして読みます。

この実走後、ラッパーは次の既存 L1 回帰も個別に実行します。このランナーの結果を各回帰の合格扱いにはしません。

```sh
for suite in preview-multi-select-v1 preview-edit-key-isolation-v1 preview-context-menu; do
  bash "apps/shell/extensions/akari-preview/evidence/$suite/scripts/run-l1.sh" || exit "$?"
done
```
