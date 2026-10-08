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

# 通知

右下の札は輪が 0 になるまで留まり、その後 580ms かけてベルへ入ります。動きを減らす設定、またはベルが見つからない場合は 160ms のフェードになります。ボタンの結果は押すまで未解決のまま残ります。

| 条件（上から優先） | 右下にいる時間 |
|---|---:|
| 進行中 | 終わるまで |
| 呼び出し側が `options.timeout` に 0 以下を指定 | 押すまで |
| 呼び出し側が正の `options.timeout` を指定 | 指定値（ms） |
| error / warning、またはボタンが 2 個以上 | 8 秒 |
| ボタンが 1 個 | 5 秒 |
| ボタンなし | 3 秒 |

マウスが札に乗っている間、札の中にフォーカスがある間、ウィンドウが非表示の間、最小化などでコマが描かれていない間は残り時間と輪を止めます。押すまで右下に残したい通知は `options.timeout: 0` を渡してください。

進行中の通知を完了時に報告へ変えて吸い込む処理は、この実装の対象外です。

# Webview ビューの遅延 resolve

Theia 1.73.1 は `PluginViewWidget` を作る途中で webview ビューの resolver を呼びます。右パネルなどでビューが隠れていると、子の `WebviewWidget` に iframe がまだなく、拡張が設定する HTML が届きません。Codex 拡張は HTML 設定後に 30 秒の `ready` 待ちタイマーを開始するため、そのままではエラー通知になります。

`AkariPluginViewRegistry` は Codex 拡張 `openai.chatgpt` の `chatgpt.sidebarView` と `chatgpt.sidebarSecondaryView` だけ、resolver の登録と親ビューの表示が両方揃うまで resolve を保留します。この 2 つのビューは `when` 条件で排他です。未登録の間は Theia の revival キューにも積みません。Lumino の表示メッセージでタブ、パネル、折りたたみ、移動のいずれも扱い、同じ webview につき一度だけ呼びます。一覧にない webview ビューと tree ビューは Theia の経路をそのまま使います。復元済みの子 webview の作成も Theia の経路です。

Theia を更新するときは `PluginViewRegistry` の `prepareView`、`resolveWebviewView`、`registerWebviewView` と、Lumino の `after-show` / `after-attach` 時点の `isVisible`、`WebviewWidget` の iframe 作成時点を見直してください。Theia の更新時や Codex 拡張のビュー id が変わったときは `CODEX_LAZY_WEBVIEW_IDS` の一覧も見直してください。実機確認の手順は [evidence/codex-view-lazy-resolve/README.md](evidence/codex-view-lazy-resolve/README.md) にあります。
