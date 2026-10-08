# ボタンの使い分け

- 主操作: `theia-button`。
- 補助操作: `theia-button secondary`。
- 控えめな操作: `theia-button quiet`。
- 削除などの危険な操作: `theia-button danger`。
- 小さいボタンには `small` を加える。
- アイコンだけのボタンには `icon` を加える（`small`・`quiet`・`secondary` と併用可）。
- 切り替え・タブは `akari-seg` に入れ、選択を `aria-pressed="true"` またはタブの `aria-selected="true"` で示す。
- AKARI の widget・シート・ダイアログ内で class のない `button` は副の見た目になる。

# 役割色の使い分け

- 成功・完了の表示には `--akari-success` を使う。
- 注意・警告の表示には `--akari-warning` を使う。
- エラー・危険な操作の表示には `--akari-danger` を使う。

# Webview ビューの遅延 resolve

Theia 1.73.1 は `PluginViewWidget` を作る途中で webview ビューの resolver を呼びます。右パネルなどでビューが隠れていると、子の `WebviewWidget` に iframe がまだなく、拡張が設定する HTML が届きません。Codex 拡張は HTML 設定後に 30 秒の `ready` 待ちタイマーを開始するため、そのままではエラー通知になります。

`AkariPluginViewRegistry` は resolver の登録と親ビューの表示が両方揃うまで webview の resolve を保留します。未登録の間は Theia の revival キューにも積みません。Lumino の表示メッセージでタブ、パネル、折りたたみ、移動のいずれも扱い、同じ webview につき一度だけ呼びます。最初から見えるビューと tree ビューの処理は Theia の経路を使います。復元済みの子 webview の作成も Theia の経路に戻しています。

Theia を更新するときは `PluginViewRegistry` の `prepareView`、`resolveWebviewView`、`registerWebviewView` と、Lumino の `after-show` / `after-attach` 時点の `isVisible`、`WebviewWidget` の iframe 作成時点を見直してください。実機確認の手順は [evidence/codex-view-lazy-resolve/README.md](evidence/codex-view-lazy-resolve/README.md) にあります。
