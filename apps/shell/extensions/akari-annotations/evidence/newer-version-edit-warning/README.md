# newer-version-edit-warning — L1 証跡

新しい版で保存したプロジェクトを古い版で開いたときの案内（版スタンプ `.akari/saved-by.json`）。
開発ビルド（shell v0.1.86）を隔離プロファイルで起動し、CDP で操作・撮影した。

fixture: `dev-fixtures/cross-track-image-overlap` を一時ディレクトリへ複製し、
`edit.json` の `tracks[0].items[0]` に未定義キー `futureKey` を追加。スタンプの `appVersion` を場合ごとに変えた。

| ファイル | 条件 | 観測 |
|---|---|---|
| `before-timeline.png` | 修正前・スタンプ 9.9.9 | プレビュー・タイムラインとも「手で編集した場合は取り除くか、.akari/backup/ の原本から復元してください」 |
| `after-newer-preview.png` | 修正後・スタンプ 9.9.9 | プレビューの通知が「このプロジェクトは新しい版の AKARI Video（v9.9.9）で保存されています。いまの版（v0.1.86）では開けない機能が使われています。AKARI Video を更新してください。」+「アップデートを確認」 |
| `after-newer-timeline.png` | 同上 | タイムラインの通知も同じ文言 +「アップデートを確認」 |
| `after-newer-update-button-about.png` | プレビュー通知のボタンを押す | 設定の「このアプリについて」が開く |
| `after-newer-timeline-click-update-button-about.png` | タイムライン通知のボタンを押す | 同上 |
| `after-stamp-none-*.png` | スタンプ無し | 従来の文言のまま（回帰なし） |
| `after-stamp-same-timeline.png` | スタンプ = いまの版 | 従来の文言のまま |
| `after-save-save1.png` | 未定義キー無し・スタンプ 9.9.9・参照切れ素材 1 件で保存 1 回目 | 上書きの注意が 1 回出る。保存後の検証の表示に前置き「このプロジェクトは新しい版（v9.9.9）で保存されています。…」が付く。スタンプは 0.1.86 に更新 |
| `after-save-save2.png` | 同じプロジェクトで保存 2 回目（通知を消してから） | 上書きの注意は出ない。前置きも付かない（スタンプが 0.1.86 になったため） |
