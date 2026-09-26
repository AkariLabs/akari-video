# タイムラインへ素材を置くと再生位置が 0 秒に戻る / 置く前に入る場所が見えない — L1 証跡

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動（`scripts/launch.mjs`）。`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は本票専用の一時ディレクトリ、CDP ポート 9622。frame-engine は既定（有効）
- fixture: `scripts/gen-fixture.mjs` の `spoken`（1280×720・12 秒の単色映像 + 話した言葉 4 行・字幕トラック）に、空の音声トラック `A1` と、プロジェクトの画像 4 枚（800×600 の単色 PNG）・B ロール 2 本（testsrc の 4 秒 / 3 秒）を足して git 管理
- 記録（`scripts/tdp-lib.mjs` の `INSTALL`）: 本体ページで `AkariPreviewOpenHandler.prototype` の `forwardPlaybackTick`（受け取った tick の time / pageId / positionReady と、その時点の widget の pageId）・`refreshPreview`（復元に使う seek 値・force）・`queueRefresh` をフックし、`akari.preview.playbackTick` イベント（= ホストが**採用して**タイムラインへ流した再生位置）も記録する。さらにタイムラインの `playheadT`・`reviewTransportByEdit`・`akariPreviewLastKnownTime` を 150ms ごとに採る
- ドラッグ（`scripts/tldrag.mjs`）: 実マウスでカードを掴み、`Input.setInterceptDrags` で本物の DragData を横取りして `Input.dispatchDragEvent`（dragEnter → dragOver ×6 → drop / dragCancel）でタイムラインの「時刻 t・指定の行」へ運ぶ。行は `row:<見出し>`（見出しを scrollIntoView）か `track:<track id>`（タイムラインの `laneLayout` で行の縦位置を取り、帯のスクロールで見える所へ出す）。スクリーンショットはタイムラインの枠だけを CSS px 等倍で撮り、ポインタの位置に**マゼンタの丸**を描き足している（証跡の目印でアプリの表示ではない）
- 毎回 `akari.preview.seekOutput` で 5 秒へシークし直してから落とす（`scripts/batch.sh`）。プレビューへ落とす経路は P-1 の `scripts/pvdrag.mjs` を `scripts/pvcheck.mjs` で包んで同じ記録を取る
- 回数表は `scripts/summarize.mjs` が各 JSON から作る（`*-summary.json`）。「一時的に 0」= ホストが 0 秒の再生位置イベントを 1 回でも発行した、または採取した playheadT / transport が 0 になった回。「0 のまま」= 見張り終了時点でも 0。各 JSON の `summary.resetToZero` / `zeroTicks` は**受け取った** tick を数えているので（修正後はページが送っても採用されない）、判定には `*-summary.json` の `zeroTicksAccepted` を使う
- 負荷: 6 票が同じ機械で並走し、load average 40〜140 の中で採取

## BEFORE（基点 `e2a5eaf3` のビルド）— `before/`・`before-summary.json`

| 観測 | 回数 | 一時的に 0 | 0 のまま |
|---|---|---|---|
| (a) ライブラリの画像をタイムラインの 5 秒へ（軽い: レイヤー 0〜9 枚） | 10 | 8 | 1（`a01`） |
| (a) 同（重い: レイヤー 10〜19 枚） | 10 | 9 | 0 |
| (b) プロジェクトの画像 | 5 | 0 | 0 |
| (b) B ロール | 5 | 0 | 0 |
| (b) 図形 | 5 | 0 | 0 |
| (b) テキスト | 5 | 0 | 0 |
| (c) ライブラリの画像をプレビューへ（P-1 の経路） | 5 | 0 | 0 |

`heavy-a02`（`still/bg-dark-grid`）は「この素材は直接置けません」で置かれない素材（AFTER でも同じ）。

### ログで特定した経路

1. ライブラリの素材を置くと必ず `queueRefresh(force)` → `refreshPreview(seek=5)` でプレビューのページが作り直され、ファイル監視からの 2 回目のリフレッシュでもう 1 回作り直されることが多い（プロジェクトの素材・図形・テキストは作り直しにならず 0 回）
2. **作り直された新しいページは、最初の tick を time=0 で送ってくる**（例: ページ `:8` の tick 列 `[0,5,5,5,…]`、`:14` は `[0×9, 5, …]`）。初期位置（initialSeekTime=5）の反映前の outputTime の初期値
3. その 0 の tick の **pageId は widget の pageId と一致している**（`refreshPreview` が setHTML の前に pageId を進める）。司令塔の仮説 3（pageId で絞っていない）は当たっているが、古い pageId を捨てるだけでは直らない。ホストが「初期位置の反映前」の 0 を採用していることが一時的な 0 の原因
4. 0 のまま戻らなかった `a01`: 作り直されたページ自身が `0:00 / 0:12` のまま（webview の `#time-label`・frame-engine の時計あり・`#preview-video` は readyState 0）。0 を 1 回送り、5 は一度も送らなかった。直前 2 回のリフレッシュの seek はどちらも 5（仮説 4 の「復元値に 0 が使われる」はこの 20 回では観測されず）
5. 修正の 2 往復目のビルド（`r2/`・`r2-summary.json`）で、さらに経路が 1 本見つかった: frame-engine のページで `applyInitialPosition()` が frame-engine の時計の作成**より前**に走ると、video 経路で outputTime=5 にしただけで確定し、後から作られた時計は `position = 0` から始まる。停止中の `clock.tick()` は自分の position（0）を返すので、確定済みのページが 0 を報告し続ける（`r2/stuck-positionready-log.json`: 新しいページが `positionReady:true` で time 0 を数十回送り、5 は来ない）。r2 のビルドでは 20/20 回で一時的に 0（`r2-summary.json`）
6. 置き場所そのものが 0 になる経路（sequential の cuts 帯）はこの fixture（v2・`at` あり）では出ず、すべて落とした時刻（at=150 = 5 秒）に入った

### ドラッグ中の仮枠（`before/ghost-*.png`・ポインタは 6 秒）

- 画像を字幕行 / Base 行へ: 緑の挿入線と、字幕行の帯の上のオレンジ枠（`ghost-image-on-caption.png`）
- 画像を音の行へ・BGM を映像行へ: 赤い「レーン違い」。BGM は音の行があっても入らない（`ghost-bgm-on-base.png`）
- テキスト: どの行に向けても字幕行の上の点線の帯に出て、札は無い（`ghost-text-on-a1.png`）
- 図形: 仮枠も札も出ない（`ghost-shape-on-a1.png`）

## AFTER（最終ビルド = codex 3 往復目）— `after/`・`after-summary.json`

| 観測 | 回数 | 置かれた | 一時的に 0 | 0 のまま |
|---|---|---|---|---|
| (a) ライブラリの画像をタイムラインの 5 秒へ（軽い） | 10 | 10 | **0** | **0** |
| (a) 同（重い: レイヤー 10〜20 枚） | 11 | 10 | **0** | **0** |
| (b) プロジェクトの画像 | 5 | 5 | **0** | **0** |
| (b) B ロール | 5 | 5 | **0** | **0** |
| (b) 図形 | 5 | 5 | **0** | **0** |
| (b) テキスト | 5 | 5 | **0** | **0** |
| (c) ライブラリの画像をプレビューへ | 5 | 5 | **0** | **0** |

- (a) の重い側: `heavy-a02` は置けない素材（BEFORE と同じ）なので `heavy-a11-replacement`（`still/bg-forest-mist`）で 1 回足した。`heavy-a09` は見張りの 15 秒より後に入った（edit.json に `image-18` として入っていることを確認）。置かれた 20 回すべてで一時的な 0 も 0 のままも 0 回
- ページは作り直しのたびに今も 0 の tick を送ってくる（`zeroTicksReceived`）が、`positionReady` の無い tick はホストが採用しない（`zeroTicksAccepted` = 0）
- (c) は 5 回とも落とした時刻 5 秒に留まった（P-1 の挙動は従来どおり）
- テキストは置いた文字の開始時刻へ再生位置が移る（`ghost-text-*` の後の `drop-text-on-a1`: 2 秒 → 6 秒）。置いた文字を選んで見せる既存の動き（この票では変えていない）で、0 へ戻る現象とは別

### 意図的なシーク（`after/seek-intentional*.json`・`after/seek-click-probe.jsonl`）

- `akari.preview.seekOutput` で 2 / 0 / 9.5 秒 → タイムラインの再生ヘッド・transport・プレビューの表示が 3 つとも一致（0 秒への明示的なシークも採用される）
- タイムラインの空いた所のクリック（3 秒・4 秒）→ そこへシーク。7 秒のクリックは音の行の既存クリップの上に当たって選択になった（シークしないのは従来の挙動）

### ドラッグ中の仮枠と、離したときの結果（`after/ghost-*.png` / `after/drop-*.json`・ポインタは 6 秒）

| 素材 → ポインタの行 | 仮枠・札 | 実際に離した結果 |
|---|---|---|
| 画像 → Base 行（重なる） | Base 行のポインタの時刻にオレンジの仮枠 + Base 行の**すぐ上**に挿入線、フッター「重なるので新しいトラックに置きます」（`ghost-image-on-base.png`） | 新しい映像トラック `v1` が Base のすぐ上（字幕の下）にでき、6 秒に入る（`drop-image-on-base.json`） |
| 図形 → Base 行 | 画像と同じ（`ghost-shape-on-base.png`） | `v1` が Base のすぐ上にでき、6 秒に入る。再生位置は動かない（`drop-shape-on-base.json`） |
| BGM → Base 行 | 音の行（A1）の 6 秒にオレンジの仮枠 + ポインタのそばに「音の行に入ります」（`ghost-bgm-on-base.png`） | A1 の 6 秒に入る（`drop-bgm-on-base.json`） |
| テキスト → 音の行 | 文字の行の帯（字幕行の上）の 6 秒にオレンジ枠 + ポインタのそばに「文字の行に入ります」（`ghost-text-on-a1.png`） | 字幕 `c-0005` が 6 秒から入る（`drop-text-on-a1.json`） |
| 画像 → 音の行 | 赤い「レーン違い」・フッター「音のレーンには映像を置けません。」（`ghost-image-on-a1.png`） | 置かれない（従来どおり） |

## 途中の差分（codex の往復ごと）

| 往復 | 観測 | 結果 → 差し戻し |
|---|---|---|
| r1 | ユニットテストで既存 2 件が落ちる（`material-trial-bar` の readySeek・`track-lock-widget` の札の要素） | readySeek の条件を戻す・札の要素が無くても落ちないように |
| r2 | 実機 AFTER で 20/20 回一時的に 0（`r2/`） | 上の経路 5（frame-engine の時計が後から作られる）→ 時計の尺と ready を待ってから `clock.seek` で確定 |
| r3 | 上の AFTER 表 | — |

## スクリプト

`scripts/` — `tdp-lib.mjs`（記録のフック・状態の読み出し）/ `instrument.mjs` / `tldrag.mjs`（タイムラインへのドラッグ）/ `batch.sh`（同じ置き方を N 回）/ `pvcheck.mjs`（プレビューへ落とす前後の記録）/ `seekcheck.mjs` / `clickt.mjs`（意図的なシーク）/ `watch.mjs`（外部からの編集で作り直されたときの見張り）/ `summarize.mjs`（回数表）/ `fmt.mjs` / `post-launch.sh`。
`cdp-lib.mjs` / `l1-lib.mjs` / `l1-common.mjs` / `common.mjs` / `gen-fixture.mjs` / `launch.mjs` / `open.mjs` / `click.mjs` / `ev.mjs` / `shot.mjs` / `seek.mjs` / `ptime.mjs` / `opencat.mjs` / `pvdrag.mjs` / `stage.mjs` / `stageshot.mjs` / `bbox.mjs` / `measure.mjs` / `plates2.mjs` / `home.mjs` / `reload.mjs` / `undo.mjs` / `sum.mjs` / `setup.sh` は akari-preview の `p1-preview-drop` の写し（ポートだけ 9622）。
