# マイスタイルに「動き」の部品を足す（保存の部品チェック・部品ごとに外して当てる）— 実機 L1 の証跡

タスク: `task/2026-09-24-mystyle-motion-part`。契約文書: `docs/contract-2026-09-24-style-v0.md`（Japanese）。

実機: 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動。専用の CDP ポート 9489・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`・一時 workspace（名前に `mystyle-motion-part` を含む）。
**起動の cwd はリポ直下**（テキストスタイルの索引の探索が cwd 基準）。ウィンドウ 1440×900・右パネル幅 360。ライブラリの置き場は隔離した `AKARI_HOME` の `library-location.json` で一時の作業場の `library/` を指す（`scripts/library-home.mjs`）。
操作はすべて CDP の実マウス・実キーボード（文字入力は `Input.insertText`、ドラッグは `Input.setInterceptDrags` で本物の DragData を横取りして `Input.dispatchDragEvent` で運ぶ）。

## ファイル

| ファイル | 内容 |
|---|---|
| `scripts/gen-fixture.mjs` | fixture（話した言葉 5 行・15 秒・1280×720）。c-0001 = 保存元（見た目 + 動き = 登場 `fade-up` 0.6 秒・ループ `float` + 位置）/ c-0002 = 別の見た目 + 位置 + 別の動き（登場 `pop`・退場 `slide-down`）/ c-0003 = 何も無し / c-0004 = `style_preset: emphasis-red`（プリセットに登場 `pop`）/ c-0005 = 何も無し。映像は ffmpeg（L1 専用） |
| `scripts/before.mjs` | 手順 0（BEFORE）の記録（判定なし）。基点 `813debc0` のビルドで実行 |
| `scripts/after.mjs` | AFTER の受け入れ条件（23 項目）。最終ビルドで 1 回通しで実行 |
| `scripts/common.mjs` | 棚を開く・保存ダイアログ・通知・スクリーンショットの小道具（mystyle-look-v0 の after.mjs から切り出し） |
| `scripts/cdp-lib.mjs` / `l1-lib.mjs` / `l1-common.mjs` / `view.mjs` / `library-home.mjs` | mystyle-look-v0 の写し。既定ポートを 9489 に、`l1-lib.mjs` の `launch` に `keep`（起動し直しで user-data-dir を残す）と、起動待ちの上限 10 分・失敗時に起動した PID だけを止める処理を追記 |
| `results-before.json` / `results-after.json` | 実測値 |
| `before-*.png` / `after-*.png` | スクリーンショット |

## BEFORE（基点 `813debc0` のビルド）— 手順 0

| 観測 | 記録 | 結果 |
|---|---|---|
| 保存ダイアログ（動きのある c-0001） | `before-01-save-dialog.png` | 見た目 = 有効・チェック / **動き = 「動き（近日）」で無効**・効果音・画面効果・装飾も近日。保存した style.json の parts は `[look]` だけ（`animation` なし） |
| 保存ダイアログ（動きの無い c-0005） | `results-before.json` | 同じ（動き = 近日で無効） |
| 棚 | `before-02-shelf.png` | 手で置いた見た目 + 動きのスタイルのチップは「見た目」「動き（当てない）」。見本にマウスを乗せてもアニメーション 0 件 |
| 当てる（見た目 + 動きのスタイルを c-0002〜c-0004 に） | `before-03-apply-notice.png` | 部品のチェックは出ず即当てる。見た目だけ書かれ `animation` は書かない（c-0002 の pop / slide-down はそのまま）・c-0004 の `style_preset` は外れる。通知「動き は v0 では当てません。見た目を当てました。」・利用台帳 `parts: [look]`。Cmd+Z 1 回で byte 一致 |

## AFTER（最終ビルド・**23/23 pass**・`results-after.json`）

| 受け入れ条件 | 記録 | 実測 |
|---|---|---|
| 保存ダイアログ（動きあり） | `after-01-save-dialog-motion.png` | 見た目・**動きとも有効で既定でチェック**。効果音・画面効果・装飾は近日のまま |
| 保存（見た目 + 動き） | `results-after.json` | parts = `[look, motion]`。motion = `{kind: motion, scope: caption, mode: modify, animation: {in: {id: fade-up, duration_sec: 0.6}, loop: {id: float}}}`（保存元と一致）。look に `animation` なし・位置 / layout なし・絶対パスなし |
| 保存ダイアログ（動きなし） | `after-02-save-dialog-no-motion.png` | 動き = 無効・未チェック・「動き（この字幕には動きがありません）」 |
| 保存ダイアログ（`style_preset` だけの c-0004） | `results-after.json` | プリセット由来の動き（登場 pop）があるので動きが既定でチェック = 実効の動き |
| 動きだけで保存 | 同上 | 見た目のチェックを外して保存 → parts = `[motion]` だけ |
| 棚のチップ | `results-after.json` | 「見た目」「動き」（当てないの注記なし）。未対応の効果音入りは「効果音（当てない）」。scope / mode を書いていない motion の style.json も読めて棚に残る（書き換えない）。操作は全カード 1 行 |
| 見本で動きを再生 | `after-03-shelf-hover.png` | 乗せる前 0 件 → 乗せた直後 1 件（`iterations 1`・600ms = 保存した登場の長さ。途中の描画 opacity 0.59・translateY 4.9px）→ 終わると 0 件。カードの中でマウスを動かしても再生し直さない |
| 当てる → 部品のチェック | `after-04-apply-popover.png` | 当てるボタンのそばに小さなポップオーバー（212×148px）「当てる部品 / 見た目 / 動き / キャンセル / 当てる」。初回の既定は両方チェック・絵文字なし |
| **動きだけ**（3 本） | `after-05-motion-only-preview.png` | 3 本とも `text_style.animation` = 保存元の動き（c-0002 の退場 slide-down は消える）。見た目・位置・c-0004 の `style_preset` は不変。利用台帳 `parts: [motion]`・通知なし。書き出しの字幕描画（render-cut の `buildCaptionAnimation`）は 3 本とも `akari-anim-fade-up 0.6s … , akari-anim-float 1.6s … infinite`（当てる前: c-0002 = pop + slide-down / c-0003 = なし / c-0004 = プリセットの pop）。出力プレビューの色・大きさ・縁取りは当てる前と同じ |
| undo | `results-after.json` | Cmd+Z **1 回**で captions.json が fixture と byte 一致・`git status` 空 |
| 前回外した部品が次回の既定 | `after-06-popover-remembered.png` | 動きだけの後は「見た目 = 外れ・動き = チェック」で開く |
| **見た目だけ**（3 本） | `after-07-look-only-preview.png` | 見た目 8 項目が保存元と一致・`animation` は当てる前のまま・位置不変。利用台帳 `parts: [look]`。出力プレビューの色・縁取りが c-0001 と一致。Cmd+Z 1 回で byte 一致 |
| 次回の既定（2 回目） | `results-after.json` | 見た目だけの後は「見た目 = チェック・動き = 外れ」で開く |
| **両方**（3 本） | `after-08-both-preview.png` | 見た目 + 動きが入り `style_preset` は外れる。利用台帳 `parts: [look, motion]`。出力プレビューの見た目が c-0001 と一致・書き出しの字幕描画で fade-up + float。Cmd+Z 1 回で byte 一致 |
| 未対応の部品 | `after-09-popover-unsupported.png` | 効果音入りのスタイル: 「効果音（当てない）」は無効表示。Escape で閉じ何も書かない。当てると通知 1 行「効果音 は当てません。」・台帳 `parts: [look, motion]` |
| 部品が 1 つのスタイル | `results-after.json` | 動きだけのスタイルはポップオーバーを出さず即当てる（見た目不変・台帳 `[motion]`・undo 1 回） |
| ＋ | `after-10-plus-placed.png` | 前回の選択（見た目を外した）に関係なく、置いた文字に見た目 + 動き・台帳 `[look, motion]`・Cmd+Z 1 回で byte 一致 |
| ドラッグ | `results-after.json` | カード → タイムラインの 10 秒: 置いた文字に見た目 + 動き（ペイロード `kind: mystyle`・parts `[look, motion]`）・Cmd+Z 1 回で byte 一致 |
| 起動し直し | `after-11-popover-after-restart.png` | 動きだけで当てて undo → アプリを起動し直す（user-data-dir を残す）→ 既定は「見た目 = 外れ・動き = チェック」のまま。記憶はスタイルの uid ごと（`localStorage` の `akari.mystyle.parts.<uid>`） |

## 出力プレビューで動きが見えないこと（基点からの現状）

出力プレビュー（akari-preview）は字幕の `text_style.animation`（textanim の語彙）を描かない。fixture のままの c-0001（登場 fade-up・ループ float）を調査用の小スクリプト（コミットしない）で見ると、開始直後（+0.1 / +0.3 秒）と登場後（+1.2 / +2.0 秒）で plate 以下の全要素の opacity / transform が変わらず、CSS アニメーションも 0 件。AFTER の「両方」で当てた c-0003 も同じ（`results-after.json` の `frames` = +0.05 / +0.3 / +1.2 秒で同一）。
動きを描くのは書き出しの字幕描画（`packages/render-cut/src/captions.mjs` の `CAPTION_ANIMATION_RECIPES`）なので、この証跡は「当てた値が書き出しの字幕描画で登場 + ループの CSS アニメーションになる」ことで再生を確かめた。プレビューへの描画は akari-preview の範囲（本タスクでは編集禁止）。

## 調べた経緯（判定側の修正）

- 負荷の高い時間帯（load average 100〜270）で、起動からワークベンチ表示まで 76 秒〜3 分超。CDP の応答待ちを `AKARI_CDP_TIMEOUT_MS=300000`、起動待ちを 10 分に延ばした
- 待ちの無いシーク（`akari.preview.seekOutput`）はプレビューがシーク可能になる前だと無視されるので、`waitForReady: true` で送る
- 利用台帳の追記は captions.json の書き込みより後に来るので、件数が増えるまで待ってから最後の 1 件を読む
- インスペクターの描き直しの途中で ⋯ を押すと空振りするので、メニュー項目が出るまで押し直す（最大 6 回）
- 起動し直しでは字幕のタイムラインを開き直さない（残した user-data-dir の「開くだけ」の状態では `akari.annotations.open` が「タイムラインを作成」を出して戻らない。この機能とは無関係）。棚のポップオーバーは選択なしで開けるので既定だけを見る
