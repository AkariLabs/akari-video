# 証跡: 音声クリップをタイムライン上で直接整える（フェードの丸・音量の線・⌥クリックでキーフレーム）

検証はラッパーが実施（実機 = 専用の CDP ポート 9463・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`・一時 workspace）。
BEFORE は基点のビルド（本タスクの変更前）、AFTER は本タスクのビルド。記録物（スクショ・JSON）はリポの外に置き、ここには再現スクリプトだけを置く。

## fixture

- `scripts/gen-fixture.mjs`: 映像 12 秒（無音）+ 音のトラック 3 本 — BGM（`bgm-1`・10 秒・フェード無し）/ ナレーション（`nar-1`・2〜6 秒・音量キーフレーム 2 点）/ 効果音（`sfx-1`・7 秒から 1.5 秒）。素材は ffmpeg で作る（L1 専用。単体テストは ffmpeg に頼らない）
- 画面上の BGM クリップの `data-akari-item-id` は `bgm`（既存の BGM 表示の id）。edit.json 上の実アイテムは `bgm-1`

## 手順

1. `node scripts/gen-fixture.mjs <dir>` → `node scripts/launch.mjs <repo> <dir>/audio <isoDir>`（タイムラインを最大化して止まる。PID を出力）
2. `node scripts/resize.mjs a-bgm 72` / `node scripts/resize.mjs a-nar 72`（行ヘッダ下端のつまみを実マウスでドラッグ）
3. `node scripts/probe.mjs <out.json>`（各クリップの丸・線・点・曲線・下辺の印の有無と矩形）
4. `node scripts/after.mjs <project> <outDir>`（T1〜T8。各操作の前後で edit.json の対象アイテムと sha、readout、メニュー、Cmd+Z 1 手の byte 一致）
5. 補助: `dblclick.mjs`（本体ダブルクリック → 専用画面）/ `altclick.mjs`（⌥クリック → byte 比較）/ `middrag.mjs`（離す前の readout と要素位置）/ `clipdrag.mjs`（クリップ本体の移動・端のトリムが丸と取り合わないこと）/ `undo.mjs` / `shot.mjs` / `ev.mjs`

## 観測（要約）

| 項目 | BEFORE | AFTER |
|---|---|---|
| 28px の音声クリップ | 下辺の印（ナレーションに 2 個）のみ。丸・線・点なし | 丸 2 個（上辺の線上・バッジ文字を隠さない）。線・点なし。⌥クリックで edit.json byte 不変 |
| 72px の音声クリップ | 同上（行を高くしても印のみ） | 丸 2 個 + 音量線 1 本 + 点（キーフレーム数ぶん）。63px では線・点なし、64px で出る |
| 丸を右へ 80px（BGM・幅 727px） | — | readout「フェードイン 1.27 秒」、`fade_in` = 1.2667（38 フレーム）、曲線と陰が出る、Cmd+Z 1 手で byte 一致 |
| 丸のクリック | — | 4 種のメニュー（直線に ✓）。形を選ぶと「この版ではフェードの形をまだ保存できません」と出て edit.json は不変（下記「保留」） |
| 線を上へ 20px（72px 行） | — | readout「+8.5 dB」= `gain_db` 8.5。⌘ を押したままだと「+0.8 dB」= 0.85。Cmd+Z 1 手で byte 一致 |
| ⌥クリック | edit.json byte 不変 | ナレーション（点 2）→ 3 点（追加点 `t` = 90・`gain_db` は線の値 −6）。BGM（点 0）→ 最小 2 点の既存規則に合わせて補助点つき 2 点 |
| 点のドラッグ | — | 離す前に readout「1.60 秒 −1.0 dB」・点が追従。離すとその点だけ変わる（`t` は整数フレーム） |
| 点を選んで Delete | — | 既存の `akari.timeline.deleteKeyframe` 経路で消える。Cmd+Z 1 手で byte 一致 |
| 本体のダブルクリック | 専用画面（音量キーフレーム）が開く | 同じく開く。フェードの形のセレクト 2 つが増えた |
| 効果音の本体ドラッグ / 右端のトリム / 右上の丸 | — | それぞれ `at` 移動 / `duration`・`source.out` 短縮 / `fade_out` だけ変更（取り合わない） |

## 保留（読み込み側の対応待ち）

v2 の読み込み（edit-store の `readEditV2`）が音声アイテムの `fade_in_shape` / `fade_out_shape` を未定義キーとして拒否するため、
形の保存は書き込み前の検証で止めている（書くと edit.json が開けなくなるため）。読み込み側が受け付けた時点で、
タイムラインのメニュー・専用画面・インスペクタの形の選択はそのまま保存されるようになる。形の数式・書き出しの `curve=`・プレビューの折れ線近似は実装済み（単体テストで固定）。

## r1（統合ブランチ取り込み後・形の保存の解禁後）

上の「保留」は解消した（v2 の読み込み・legacy の移行・edit-lint・capability 表が `fade_in_shape` / `fade_out_shape` を受け付けるようになった）。追加した再現スクリプト:

- `scripts/vzoom.mjs <project> <out.json>`: 既定 28px の音声行のまま縦ズームバーの下ハンドルで全体倍率を上げ下げし、行の実際の表示高さで出し分けが変わること（64px 以上で線と点が出て触れる・未満で丸だけ）と、倍率込みの行での音量線ドラッグ → `gain_db`・Cmd+Z 1 手を見る
- `scripts/inspector-shape.mjs <project> <out.json>`: BGM を選んでインスペクタの「音声」タブの形のセレクトで `fade_in_shape` / `fade_out_shape` を書き、Cmd+Z 1 手で byte 一致を見る（最後は形を付けたまま残す）
- `scripts/reopen-check.mjs <project> <out.json>`: 形つきの edit.json で起動し直したあと、丸のドラッグで出る曲線の形の属性とメニューの ✓ が保存済みの形と一致することを見る

| 項目 | 観測 |
|---|---|
| 丸のクリック → 等パワー | `fade_in_shape: "equal_power"` が書かれ、曲線の形の属性が `linear` → `equal_power`。Cmd+Z 1 手で byte 一致 |
| 専用画面で形を変えて適用 | `fade_in_shape: "slow"` / `fade_out_shape: "equal_power"` が書かれる。適用はキーフレームの書き込み（既存）と形の書き込みの 2 つの履歴になり、Cmd+Z 2 手で byte 一致 |
| インスペクタのセレクト | 形が書かれる。Cmd+Z 1 手で byte 一致 |
| 開き直し | 読み込みエラーなし・edit.json byte 不変。曲線の形の属性とメニューの ✓ が保存済みの形 |
| 縦ズーム（28px × 倍率） | 65px で線 1・点（ナレーション 2）が出て線のドラッグで `gain_db` 9.6、Cmd+Z 1 手で byte 一致。56px に戻すと丸だけ |
| ナレーション / BGM の本体の横ドラッグ | `at` は変わらない（効果音は変わる）。統合ブランチ単体のビルドでも同じ = 本タスクの変更由来ではない |
