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
