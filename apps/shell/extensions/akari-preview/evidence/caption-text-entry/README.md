# 字幕・文字の入力 — 実機の記録

`run-l1.mjs` は合成プロジェクト（1920×1080、30 fps、12 秒。改行入りの字幕 `c-0001`・1 行の字幕 `c-0002`・置いた文字 `c-0101`（`text_style.position` + `mc`）・断片オーバーレイの素の HTML の文字・図形 1 つ）を作り、開発ビルドの Electron を専用の userData / `AKARI_HOME` / `THEIA_CONFIG_DIR` で起動して、CDP の実マウス・実キーで操作する。書き込みは `edit.json` と `captions.json` を 15 ms 毎に読んで数えた。ホストへ転送されたキーは本体ページの `window` の capture で観測だけした（消費しない）。

実行: `node run-l1.mjs --label before|after [--skip-osr] [--only a,b,c,d,e-placed,e-overlay]`。結果は [BEFORE](before.json) / [AFTER](after.json)。

## 原因（BEFORE で実測）

- **Enter が確定**: Enter・Ctrl+Enter・⌘Enter・外のクリックはすべて確定。改行は Shift+Enter だけで、画面に案内は無かった
- **「Delete で字幕が消える」の本当の原因**: 入力中の Backspace / Delete は文字だけに効いていた（ホストへの転送 0 件）。消えるのは **Enter で確定した後**。確定しても字幕は選ばれたままなので、改行を消すつもりの Backspace がタイムラインの削除に届き、字幕ごと消えた（`captions.json` 3 → 2 件）
- **入力中の ⌘A / ⌘C / ⌘V / ⌘D がホストへ転送されていた**: ⌘V は本文への貼り付けと同時にタイムラインへも貼り付け（図形の複製 `box-a-copy-1` が増え、選択が移って編集が終わる）。⌘D はホスト側で複製が走った（コンソールに「複製する要素が見つかりません: c-0001」）
- **インスペクターの本文欄**: `<input type="text">` で改行が消えて 1 行表示（高さ 24 px、値「一行目の字幕二行目の字幕」）。欄に入って何も打たずに出るだけで、`captions.json` の本文が `一行目の字幕\n二行目の字幕` → `一行目の字幕二行目の字幕` に書き換わった（書き込み 1 回）

## BEFORE / AFTER

| 操作 | BEFORE | AFTER |
|---|---|---|
| (a) 字幕の編集中に Enter | 確定（書き込み 1 回） | **改行**。続けて打った文字は次の行へ（`…X\nY`）。書き込み 0 |
| Shift+Enter | 改行 | 改行 |
| Ctrl+Enter（mac） | 確定 | 改行（mac の確定は ⌘Enter。Windows / Linux は Ctrl+Enter が確定） |
| ⌘Enter | 確定 | **確定**（書き込み 1 回） |
| Esc | 取り消し（書き込み 0） | 取り消し（書き込み 0） |
| 外のクリック | 確定 | 確定 |
| 末尾で Enter → すぐ ⌘Enter | — | 確定。末尾に空行は残らない（`…X`） |
| 編集中の案内 | 無し | 「⌘Enter で確定・Esc で取り消し」を編集中だけ表示、確定・取り消しで消える |
| (b) 行頭 / 改行の直後 / 全選択後の Backspace・末尾の Delete・← | 文字だけ（転送 0） | 同左 |
| (b) ⌘A / ⌘C / ⌘D | ホストへ転送（各 1 件）。⌘D は複製が走る | **転送 0**。⌘C はクリップボードに本文、item の増減 0 |
| (b) ⌘V（図形を ⌘C した後） | 本文へ貼り付け + **タイムラインに item +1** | 本文へ貼り付けのみ。**item +0**・転送 0 |
| (b) ⌘X | 本文を切り取り（転送 0） | 同左 |
| (c) Enter の直後に Backspace | 編集が終わっており **字幕ごと削除**（3 → 2 件） | 編集中のまま **改行だけが消える**（`…X\n\n` → `…X\n`）。字幕 3 件のまま、転送 0 |
| (d) 本文欄 | `<input>`・1 行・改行が見えない | `<textarea>`・2 行（39.6 px）・改行が見える。3 行で 54 px に伸びる |
| (d) 欄に入って何もせず外をクリック | **改行が消えて書き込み 1 回** | **書き込み 0**・ファイル差分なし |
| (d) 欄の末尾で Enter →「三行目」→ ⌘Enter | — | Enter では書き込み 0。⌘Enter で 1 回、`一行目の字幕\n二行目の字幕\n三行目` を保存し、プレビューも 3 行 |
| (d) 欄で打ってから Esc | — | 書き込み 0、欄の値は元に戻る |
| (e) 置いた文字 | (a) と同じ | (a) の AFTER と同じ |
| (e) 断片オーバーレイの文字 | Enter / Shift+Enter / ⌘Enter すべて確定、Esc 取り消し | 変更なし（下記） |
| (f) 書き出し（OSR） | — | 保存済みの改行（2 行）・インスペクターで足した改行（3 行）とも改行どおり |

断片オーバーレイの画面上の文字編集は `textContent` で保存する 1 行の欄（`<br>` は保存されない）なので、契約どおり「今のまま（Enter = 確定）」とした。入力中のキーがホストへ届かないのは既存の遮断のまま。

IME の変換確定の Enter（`isComposing` / keyCode 229）が改行にも確定にもならないことは単体テストで固定した（CDP の実キーでは変換中の状態を作れないため実機では未測定）。

## スクリーンショット

- (a) [BEFORE の Enter](before-a-enter.png)・[AFTER の Enter（改行）](after-a-enter.png)・[AFTER の案内](after-a-editing-hint.png)・[AFTER の ⌘Enter](after-a-meta-enter.png)
- (b) [BEFORE の ⌘V](before-b-meta-v.png)・[AFTER の ⌘V](after-b-meta-v.png)・[AFTER の ⌘D](after-b-meta-d.png)
- (c) [BEFORE の Backspace 後](before-c-after-backspace.png)・[AFTER の Backspace 後](after-c-after-backspace.png)
- (d) [BEFORE の欄](before-d-inspector-selected.png)・[BEFORE の外クリック後](before-d-inspector-after-blur.png)・[AFTER の欄](after-d-inspector-selected.png)・[AFTER の 3 行入力中](after-d-inspector-typed.png)・[AFTER の確定後](after-d-inspector-committed.png)
- (e) [置いた文字の AFTER の Enter](after-e-placed-enter.png)・[断片オーバーレイの AFTER の Enter](after-e-overlay-enter.png)
- (f) [保存済みの改行の書き出し](after-f-osr-newline.png)・[インスペクターで足した改行の書き出し](after-f-osr-ui-newline.png)

`after.json` の `d` は UI で足した改行の書き出しを加えて別起動で測り直したもの（`note_d`）。`before.json` の `d` も欄の引き当てを直して別起動で測り直した。
