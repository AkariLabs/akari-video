# ボタンの使い分け

- 主操作: `theia-button`。
- 補助操作: `theia-button secondary`。
- 控えめな操作: `theia-button quiet`。
- 削除などの危険な操作: `theia-button danger`。
- 小さいボタンには `small` を加える。
- 切り替え・タブは `akari-seg` に入れ、選択を `aria-pressed="true"` またはタブの `aria-selected="true"` で示す。
- AKARI の widget・シート・ダイアログ内で class のない `button` は副の見た目になる。
