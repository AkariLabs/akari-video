# 証跡: 置けない行の赤い枠の文言を 1 行に / 「文字」行のチップは縦ドラッグで行を出ない（2026-09-23-timeline-dnd-polish）

検証はラッパーが実施（実機 = 専用の CDP ポート・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`・一時 workspace）。
BEFORE は基点のビルド（本タスクの変更前）、AFTER は本タスクのビルド。ウィンドウは 1120×668（CSS px）。

## fixture と手順

- `scripts/gen-fixture.mjs`: 話した言葉 4 行（c-0001〜c-0004・source 域・12 秒。`place-text-button` の `spoken` の写し）+ 空の音のトラック `a1` + 素材（効果音 1.5 秒 wav・動画 4 秒 mp4・画像 png）。
  画面の行は上から「文字」（24px）/「字幕」（24px）/ Base（映像・48px）/ A1（音・28px）
- `scripts/launch.mjs` / `scripts/open.mjs`: 起動してタイムラインを開き、`akari.caption.placeText` で置いた文字を 1 本（3〜6 秒・`time_domain: "output"`）置く
- `scripts/dnd.mjs`: プロジェクト面の素材カードの dragstart と同じもの（window CustomEvent `akari.material.dragStart` + MIME `application/x-akari-material` の JSON）を送り、
  CDP `Input.dispatchDragEvent` で各点に dragOver ×3 → 採寸 → 最後の点で drop。採寸は素材ゴーストの矩形・rejected クラス・border・文言・
  **文言の行数**（`Range.getClientRects()` の行 top の数）・`scrollHeight` / `clientHeight`、ポインタの下の行ヘッダの矩形、フッター。
  `--lock=<trackId>` は行ヘッダの鍵ボタンを実クリックしてロック（終わったら外す）。`--undo` は Cmd+Z 1 手のあと edit.json の byte 比較
  （プロジェクト面の一覧はこの環境では「読み込み中…」のまま出なかったため、カードの dragstart が送るものを直接送っている）
- `scripts/vdrag.mjs`: 字幕チップを実マウス（CDP `Input.dispatchMouseEvent`）で横 dx・縦 dy に動かして離す。離す直前にドラッグ中の表示、離したあと captions.json / edit.json（sha256）/ チップの矩形、`--undo` で Cmd+Z 1 手のあと両ファイルの byte 比較

## (a) 置けない行の赤い枠

| ケース | BEFORE（`before/`） | AFTER（`after/`） |
|---|---|---|
| 効果音 → 映像の行（Base・48px） | 枠 h48 = 行 h48、幅 70.9。文言「映像のレーンには音を置けません。」が **4 行**に折れ、scrollHeight 57 > clientHeight 44 で下が切れる | 枠 h48 = 行 h48、幅 77.8。文言「レーン違い」**1 行**・切れなし。フッターに全文「映像のレーンには音を置けません。」 |
| 動画 → 音の行（A1・28px） | 枠 h28 = 行 h28、幅 189.1。文言は 1 行（幅が足りる） | 枠 h28 = 行 h28。「レーン違い」1 行。フッター「音のレーンには映像を置けません。」 |
| 画像 → 音の行（A1） | （BEFORE は採っていない） | 枠 h28 = 行 h28。「レーン違い」1 行 |
| ロックした A1（28px）へ効果音 | 枠 h28 = 行 h28、幅 70.9。「「A1」はロック中です（鍵を外すと編集できます）」が **5 行**・scrollHeight 70 > 24 で大半が切れる | 枠 h28 = 行 h28。「ロック中」1 行。フッター「「A1」はロック中です（鍵を外すと編集できます）」 |
| ロックした Base（48px）へ動画 | 枠 h48 = 行 h48。文言 2 行 | 枠 h48 = 行 h48。「ロック中」1 行 |

- 全ケースで枠の高さと行の高さの差は **0px**（BEFORE も枠は行の高さ・`overflow: hidden` で、文言が折れて枠の中で切れていた。枠が行より背が高くなる現象はこの版では出なかった）
- 全ケースで離しても **edit.json は不変**（ドロップの拒否は従来どおり）。枠の色（`2px solid rgb(241, 76, 76)`）・rejected クラス・受理行での通常の点線表示は BEFORE と同じ
- 途中（r1 ビルド）では「レーンが違います」が 1.5 秒の効果音の枠（幅 77.8）に収まらず「レーンが違…」と省略されたため、語を「レーン違い」「ロック中」「置けません」へ短くした（最終ビルドの値が上の表）

## (b) 「文字」行のチップの縦ドラッグ

| ケース | BEFORE（`before/`） | AFTER（`after/`） |
|---|---|---|
| 置いた文字を +90px 横・+70px 下（2 行下 = Base の行）へ | ドラッグ中のゴーストは「文字」行のまま・表示「00:00:04.904 – 00:00:07.904」。離すと start 3 → 4.904 / end 6 → 7.904（`output` のまま）、チップは lane `t-placed-text-display`・top 不変。edit.json byte 不変・ほかの字幕行不変。Cmd+Z 1 手で captions.json byte 一致 | 同じ（同じ配置の `b-placed-down-2-rows-same-layout.json` で数値まで一致: 4.904 / 7.904・top 433.9 不変）。別配置の `b-placed-down-2-rows.json` でも「文字」行のまま・edit.json 不変・Cmd+Z で byte 一致 |
| +45px 横・+26px 下（1 行下 =「字幕」行） | 時刻だけ動く・行は「文字」のまま・edit.json 不変・Cmd+Z で byte 一致 | 同じ |
| 真下へ 120px（横 0） | 変化なし（captions.json / edit.json とも不変） | 同じ |
| 話した言葉 c-0002 を +45px・+60px（回帰） | 「字幕」行のまま、隣で止まって 3.5〜6.0、Cmd+Z で captions.json / edit.json とも byte 一致 | 同じ（同じ配置で数値一致） |

- **BEFORE で既に縦方向は無視されていた**（caption のドラッグ分岐が Y 座標を使わず時刻だけを動かす）。本タスクではこの振る舞いを純関数 `planPlacedTextMove`（ゴーストの top を元の段に固定）として明示し、単体テストで固定した
- 話した言葉のチップを動かすと、BEFORE / AFTER とも edit.json の sha が変わる場合がある（Cmd+Z 1 手で両ファイル byte 一致に戻る）。本タスクでは触っていない既存の経路

## 回帰（受理される D&D）

同じ配置・新しい fixture で 効果音 → A1 / 動画 → Base（重なる位置）/ 画像 → Base（重なる位置）の順に「置く → Cmd+Z」を行った。

| ケース | AFTER（`after/regress-*`） | 基点（`base-compare/`） |
|---|---|---|
| 効果音 → A1 | `a1` に `audio-1@111+45`、Cmd+Z 1 手で byte 一致 | 同じ結果（配置が違うので at は 124）・byte 一致 |
| 動画 → Base の重なる位置 | 挿入の表示「重なるので新しいトラックに置きます」→ 新トラック `v1` に `clip-1@111+120`、Cmd+Z で byte 一致 | 同じ・byte 一致 |
| 画像 → Base の重なる位置 | 新トラック `v1` に `image-1@111+150`、Cmd+Z で byte 一致 | 同じ・byte 一致 |

ライブラリ面の BGM / B-roll（`application/x-akari-library-item`）の D&D は実機では流していない（受け側の変更は拒否時の枠の文言だけで、受理経路・MIME は触っていない）。
