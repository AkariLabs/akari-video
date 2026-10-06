# インスペクタ複数選択の実機観測

`measure.mjs` は一時 workspace に source 域の字幕 1 件と output 域の文字 1 件を作り、Electron を CDP 9478 で起動する。両チップを Shift クリックで選択し、効果カードのホバー、縁、グラデーション、動き、Undo / Redo を調べる。起動した Electron の PID だけを終了する。`before/` は変更前のアプリ、`after/` は変更後のアプリで採取した。

| 項目 | BEFORE | AFTER |
|---|---|---|
| 縁カードのホバー | 字幕 12px、文字 5.32px | 両方 12px |
| 縁の確定前後 30 フレーム | 文字が元の 5.32px のフレーム 27/30 | 最初の 1 フレームはクリック前の元の縁。クリック後の 29/29 フレームは両方 12px |
| グラデーション確定前後 30 フレーム | 両方にグラデーションがあるフレーム 0/30。最大フレーム間隔 930.8ms | 両方にあるフレーム 30/30。最初の採取フレームから表示。最大 25.2ms |
| 描画間隔の中央値 | 縁 16.8ms（59.5fps）、塗り 16.9ms（59.2fps） | 縁 16.7ms（59.9fps）、塗り 16.7ms（59.9fps） |
| 再生中の適用前後 | — | グラデーション前 59.88fps、適用後 59.88fps（45 フレームずつ） |
| 保存値 | 縁・塗りとも両方へ同じ値が保存された | 同じ。縁 `#000000` / `6px`、塗り `#fb923c → #f43f5e → #8b5cf6` / `90°` |
| 動き | タブ見出しはあるが操作カードがない | 28 枚の操作カード。フェードで両方の `animation.in.id` が `fade-in-out`、Undo 1 回で両方から削除 |
| 情報 | 件数のみ | 2 件、字幕 1 件 / 文字 1 件 |
| フォント | パネルは開かず「フォントパネルを開けませんでした」 | 同じ。対象のコマンドとパネル本体は所有範囲外 |

縁と塗りの保存値が BEFORE でも両方に入ったため、「効果が片方にしか書かれない」はこの fixture の Shift 選択では再現しなかった。差はホバーと保存完了までのプレビューにあった。AFTER の塗りは Undo 1 回で両方から消え、画面も両方 12px の縁へ戻り、Redo 1 回で両方に戻った。確認値は `results.json` の `captions`、`frames`、`undoEffect`、`redoEffect`、`motion`、`undoMotion` にある。

BEFORE の動きカードなしは旧セクション構成の読解で確認した。BEFORE 実機で「動き」タブをクリックした画面は採取していない。

各 `frames` は webview 内の `requestAnimationFrame` ごとに計算済みの縁と背景を記録した。縁・塗りの確定中は停止状態で、別の `playbackBefore` / `playbackAfter` は同一セッションで実際に再生して測った。画像は UI の上端・下端を除いた 1440×844 のスクリーンショットで、各 1MB 未満。`selected.png`、`font.png`、`hover.png`、`outline.png`、`gradient.png`、`motion.png` を参照。

## 差し戻し後の AFTER

`after-review/results.json` は source 字幕の退場を `fade-in-out`、output 文字の退場を `slide-left` にして採取した。複数選択で登場フェードを当てると両件の `animation.in.id` は `fade-in-out`、退場はそれぞれ元のまま。Undo 1 回で両件の登場だけが消えた。影 `sh-soft` は両件に同じ色・不透明度・ぼかし・距離・角度を書き、Undo 1 回で両方から消えた。

単独選択では字幕のフォントパネルを開いて `Noto Serif JP`、文字のフォントパネルを開いて `Klee One` を選べた。各操作は選んだ 1 件の `font_family` だけを更新し、エラー通知は 0。画像は `after-review/font-c-0001-panel.png`、`font-c-0001-applied.png`、`font-c-0002-panel.png`、`font-c-0002-applied.png`、`shadow.png`、`motion.png`。

再計測した縁ホバーは両方 12px、縁確定は 30/30 フレームで両方 12px、塗りは 30/30 フレームで両方に表示。再生中 fps は塗り前 60.24、塗り後 59.88（差 0.6%）。最大フレーム間隔は塗り確定中 30.4ms。
