# マイスタイルに「効果音・画面効果・装飾」の部品を足す（字幕にひも付けて置く）— 実機 L1 の証跡

タスク: `task/2026-09-24-mystyle-attach-parts`。契約文書: `docs/contract-2026-09-02-item-caption-anchor-v0.md`・`docs/contract-2026-09-24-style-v0.md`（Japanese）。

実機: 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動。専用の CDP ポート 9491・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`・一時 workspace（名前に `mystyle-attach-parts` を含む）。
**起動の cwd はリポ直下**（テキストスタイルの索引の探索が cwd 基準）。ウィンドウ 1440×900・右パネル幅 360。ライブラリの置き場は隔離した `AKARI_HOME` の `library-location.json` で一時の作業場の `library/` を指す（`scripts/library-home.mjs`）。
操作は CDP の実マウス・実キーボード（右クリックは `Input.dispatchMouseEvent` の right、文字入力は `Input.insertText`）。「字幕にひも付ける」のダイアログの `<select>` だけは、ネイティブのポップアップを CDP で操作できないので JS で値を合わせてから「ひも付ける」を実クリックする。

## ファイル

| ファイル | 内容 |
|---|---|
| `scripts/gen-fixture.mjs` | fixture（話した言葉 5 行・0 / 3 / 6 / 9 / 12 秒から 2.5 秒ずつ・15 秒・1280×720・30fps）。`anchored/` = html 装飾を c-0002・c-0003 に手書きのアンカー（全体）/ `anchored-sfx/` = さらに効果音にもアンカー / `spoken/` = c-0001 に見た目 + 動き、効果音 `sfx-a`（0 フレーム）と装飾 `deco-a`（0〜75 フレーム）をアンカー無しで置く。素材はライブラリの参照（`.akari/asset-references.json` に記帳・宣言パス `assets/<category>/<id>/<file>`）/ `library/` = 効果音 `audio/sfx-pop/pop.wav` と装飾 `overlay/deco-frame/deco.html` の実体。映像・効果音は ffmpeg（L1 専用） |
| `scripts/before.mjs` | 手順 0（BEFORE）の記録（判定なし）。基点 `8ec4c16d` のビルドで実行 |
| `scripts/after.mjs` | 手順 3（AFTER）の受け入れ条件 22 項目。最終ビルドで 1 回通しで実行 |
| `scripts/cdp-lib.mjs` / `l1-lib.mjs` / `l1-common.mjs` / `common.mjs` / `view.mjs` / `library-home.mjs` | mystyle-motion-part の写し（変更なし） |
| `results-before.json` / `results-after.json` | 実測値 |
| `before-*.png` / `after-*.png` | スクリーンショット |

## BEFORE（基点 `8ec4c16d` のビルド）— 手順 0

| 観測 | 記録 | 結果 |
|---|---|---|
| html 装飾にアンカーを手で書いた案件を開く | `before-anchored-01-opened.png` | **タイムラインが edit.json を読めない**: 通知「edit.json を読み込めませんでした: edit.json v2 が不正です (edit.json.tracks[1].items[0]): 未定義キーを使用できません: anchor」。タイムラインは字幕だけ（トラック `t-captions-implied`）・出力プレビューは空。基点の `readEditV2` の item のキー集合に `anchor` が無い（スキーマと `readInternalEdit` は受け付ける） |
| 字幕 c-0002 をタイムラインで右へドラッグ | `before-anchored-02-moved-c-0002.png` | c-0002 は 3.0 → 3.5 秒へ動くが、装飾 `deco-c2` の `at` は **90 のまま**（期待 105）。edit.json は書き直される（整形が変わる）が、アンカーは解決し直されない。undo 1 回で 2 ファイルとも fixture と byte 一致 |
| 字幕 c-0003 を選んで Delete | `before-anchored-03-deleted-c-0003.png` | c-0003 は消えるが、アンカーされた装飾 `deco-c3` は **180 フレームのまま残る**。undo 1 回で c-0003 は戻るが、captions.json は fixture と **byte 不一致**（行の再挿入で戻すため） |
| 効果音にもアンカーを書いた案件 | `before-anchored-sfx-*.png` | 上と同じ（最初に落ちるのは html の anchor）。効果音 `sfx-c2` も c-0002 を動かしても 90 のまま = 音声のアンカーは解決されない（基点の `resolveItemAnchors` は visual のトラックだけ・音声の item のキー集合にも `anchor` が無い） |

## AFTER（最終ビルド・**22/22 pass**・`results-after.json`）

| 受け入れ条件 | 記録 | 実測 |
|---|---|---|
| 右クリック「字幕にひも付ける…」（効果音） | `after-02-attach-dialog-sfx.png` | 効果音の帯を右クリック → 「字幕にひも付ける…」→ ダイアログ（ひも付ける字幕 = 同じ時刻の c-0001・位置 = 登場 / 退場）→ `sfx-a.anchor = {caption: c-0001, edge: start, duration: own}`・at 0 のまま・印なし |
| 右クリック「字幕にひも付ける…」（装飾） | `after-03-attach-dialog-decor.png` | 装飾の帯（タイムラインでは overlay 種別）でも出る。位置 = 登場 / 退場 / 全体（既定 全体）→ `deco-a.anchor = {caption: c-0001, edge: start, duration: caption}`・0〜75 フレーム |
| 保存ダイアログ（ひも付いた要素の無い c-0005） | `results-after.json` | 効果音・画面効果・装飾は無効 + 「（ひも付いた要素がありません）」 |
| 保存ダイアログ（c-0001） | `after-04-save-dialog.png` | 見た目・動き・効果音・装飾が有効で既定でチェック・画面効果は無効 |
| 保存 | `results-after.json` | style.json の parts = look / motion / decor / sfx。sfx = `{mode: attach, attach: {at: in, offset_frames: 0}, asset: {category: audio, id: sfx-pop}, file: pop.wav, duration_sec: 0.4, gain_db: 0}`・decor = `{attach: {at: whole}, asset: {category: overlay, id: deco-frame}, file: deco.html}`・絶対パスなし |
| B・C に当てる | `after-05-apply-popover.png` | 部品のチェック（見た目・動き・装飾・効果音が既定でチェック）→ 当てる。captions.json の B・C に見た目 + 動き、edit.json に B・C ごとに印付きの装飾（visual・`style-visual-1`）と効果音（音声・`style-audio-1`）: B = 90 フレーム（装飾 75 フレーム = 字幕の尺・効果音 12 フレーム）/ C = 180 フレーム。`anchor.attached_by = {style_uid, caption}`。効果音の素材は `sources[]` の `assets/audio/sfx-pop/pop.wav`・装飾は `assets/overlay/deco-frame/deco.html`・参照台帳に両方。利用台帳 `{caption_ids: [c-0002, c-0003], parts: [look, motion, decor, sfx]}` |
| undo（当てる） | `results-after.json` | Cmd+Z **1 回**で captions.json・edit.json とも当てる前と byte 一致 |
| 当て直しで重複しない | `results-after.json` | 同じスタイルを B にもう一度 → B の印付きは装飾 1 + 効果音 1 のまま・C は不変・item 総数 8 のまま |
| 出力プレビュー: 装飾は字幕の間だけ | `after-07-preview-b.png` | 4.25 秒（B の中）= B の装飾だけ表示 / 7.25 秒（C の中）= C の装飾だけ / 2.75 秒・9.5 秒（字幕の外）= どちらも非表示 |
| 字幕 B を動かす | `after-08-moved-b.png` | B をタイムラインで右へドラッグ → B = 3.5〜6.0 秒・B の装飾と効果音の at = 105（装飾の尺 75 のまま）・C の分は 180 のまま。書き込み 1 回 |
| undo（動かす） | `results-after.json` | Cmd+Z **1 回**で 2 ファイルとも byte 一致 |
| 字幕 C を消す | `after-09-deleted-c.png` | C を選んで Delete → C の印付きの装飾・効果音（2 件）も消える。B の分・A のひも付け（`sfx-a` / `deco-a`）・ほかの item は残る（残った item の並びが消す前から C の 2 件を除いたものと一致） |
| undo（消す） | `results-after.json` | Cmd+Z **1 回**で 2 ファイルとも消す前と byte 一致（C・装飾・効果音が戻る） |
| 手で動かすと外れる | `results-after.json` | 印付きの装飾（B の分）を手でドラッグ → `anchor` と印が外れ普通の要素になる（at 99）。undo 1 回で byte 一致 |
| 印の無いアンカー要素は外れない | `results-after.json` | 「字幕にひも付ける」で作った `deco-a`（印なし）を手でドラッグ → `anchor` は残る（基点と同じ挙動）。undo 1 回で byte 一致 |
| 書き出し前の検査 | `results-after.json` | B を右へ動かした状態で edit-lint exit 0・`v2.item-anchor-stale` なし |
| 書き出しで同じ時刻 | `results-after.json` | 「素材をまとめる」（`akari-assets bundle`）→ render-cut。音の立ち上がり（1/30 秒ごとの RMS が -45 dB を超えた所）= **0 / 3.5 / 6.0 秒** = A・B（動かした後）・C の字幕の頭。装飾の枠の色（x 54・y 90）: 1.25 / 4.75 / 7.25 秒（A・B・C の中）= `rgb(252,60,122)`・3.0 / 9.0 秒（字幕の外）= 背景 `rgb(37,47,62)` |

`after-06` / `after-08` / `after-09` の画面写真では、インスペクターやプレビューの操作でタイムラインの仕切りが戻り、帯の行が折りたたまれて写ることがある。判定はファイルのバイト比較と、操作の直前に帯へ実際に当たることで行っている（`after.mjs` の `stripOf` / `chipOf` / `ensureTimeline`）。

## 書き出しとライブラリ参照（基点からの制約）

render-cut の `loadOverlays` は html をプロジェクト内の実体からだけ読む（ライブラリ参照へのフォールバックが無い）。そのため装飾の素材が参照のまま（実体がプロジェクトに無い）だと、書き出しは `assets/overlay/deco-frame/deco.html could not be read: ENOENT` で止まる。
これはスタイルを当てていない fixture のまま（参照で置いた `deco-a` だけ）でも同じで、基点からの挙動（`results-after.json` の書き出しの `referenceOnlyPlan`）。この証跡は既存の「素材をまとめる」で参照を実体化してから書き出した。render-cut の src はこのタスクの編集範囲外。

## 調べた経緯（判定側の修正）

- 帯を左クリックで選んでから右クリックすると、選択枠・トリムのつまみが帯に重なって右クリックが帯に届かない。選ばずに、帯の中で実際に帯に当たる点を探して右クリックする
- 高負荷の時間帯（load average 90〜240）はタイムラインの仕切りのドラッグやチップのドラッグが空振りすることがあるので、帯に手が届くまで仕切りを広げ直し、ドラッグは書き込まれるまで最大 3 回
- 同じ段に C の装飾（180 フレーム〜）があるので、B の装飾を手で動かす量は重ならない 0.3 秒にする（1 秒だと重なりで移動が拒否される）
- render-cut の出力先はプロジェクト内に限る（`exports/`）
