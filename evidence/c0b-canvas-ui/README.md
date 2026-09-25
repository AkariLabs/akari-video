# evidence: c0b-canvas-ui（キャンバスを作る・見せる）

`docs/contract-2026-09-25-canvas-v0.md` の実機（L1）証跡。production ビルドの Electron を隔離
`--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME` + `--remote-debugging-port` で起動し、生 CDP で
実マウス・実キー（⌘Z）を投げて `edit.json` とタイムライン / プレビューの DOM を読む。

```sh
cd apps/shell && npm run build
AKARI_CDP_PORT=<port> node evidence/c0b-canvas-ui/scripts/l1-before.mjs   # 基点で実行した記録 = before/
AKARI_CDP_PORT=<port> node evidence/c0b-canvas-ui/scripts/l1-after.mjs    # 本変更で実行した記録 = after/
```

素材（`clip.mp4`）は ffmpeg の lavfi で一時ディレクトリに都度生成し、終了時に削除する（バイナリはコミットしない）。
`observations.json` のパスは `<REPO>` / `<TMP>` / `<HOME>` に置き換えてある。

## BEFORE（基点 b76f1275・`before/`）

| 観測 | 結果 |
|---|---|
| 空の group（`items: []`）はタイムラインに出るか | 出ない（行・帯とも無し） |
| 空の group はプレビューの選択の木に出るか | 出ない |
| group の帯を横にドラッグ | `at` 300 → 300（動かない） |
| 左の木の行 h1（G1 の子・相対 30 = 絶対 1 秒）を G2（10 秒）の行へ D&D | 相対 30 のまま入り **絶対 11 秒へずれる**（+10 秒） |

## AFTER（`after/`・26 項目すべて PASS）

| # | 受け入れ条件 | 実測 |
|---|---|---|
| 1 | 0:10〜0:15 を範囲選択 →「キャンバスを作る」 | `at` 300 / `duration` 150・`canvas.origin=user`・`durationMode=fixed`・中身 0 |
| 2 | 空のキャンバス = 斜線の 1 行 | 左の行・帯とも `repeating-linear-gradient` |
| 3 | プレビューに点線の枠と意図 | 12.5 秒で `display:flex`・`border-style:dashed`・文字「ここにタイトルを入れる」／ 8 秒で非表示・選択の木にノードあり |
| 4 | 名前・意図・背景（紺 `#1b2a5c`）をインスペクターで設定 | 4 操作とも `edit.json` に反映・左の行の見出しも即時に追随 |
| 5 | 置いた文字（time_domain: output）と html を入れる | 字幕は子の `caption` item（絶対 11 秒・45 フレーム）+ 袋の `exclude` に同じ id。html は絶対 330 フレーム・transform 不変 |
| 6 | 1 行 + ▸ | 行の見出しにトグル |
| 7 | 背景は子より下・キャンバスの字幕は背景の上 | 背景レコード z ≤ 子・11.75 秒で字幕の行が最前面（elementFromPoint）・字幕の行は 1 本 |
| 8 | チップを 0:20 へ | `at` 600 前後（±1px 相当）・子の相対 `at` 不変 |
| 9 | 右端で尺を 3 秒に | `duration` 90・子の `at`/`duration` 不変・区間内（21.97 秒）は表示、区間外（23.72 秒）は非表示 |
| 10 | 中身を 1 個「キャンバスから出す」 | 絶対時刻・transform 不変・プレビュー上の矩形の差 0px |
| 11 | ⌘Z で 1 操作ずつ戻る | 出す → 尺 → 移動 の 3 回とも ⌘Z 1 回で直前の `edit.json` と一致 |
| 12 | 保存して開き直す | アプリを閉じて同じプロファイルで開き直し、`edit.json` 同一・キャンバスの行（名前）あり |
| 13 | 同じ時刻に 4 個（別々の段）→ 畳み | 「同じ時刻に 4 個」の 1 行（▸ はトグルだけ）・`edit.json` 不変 |
| 14 | 畳んだ行の右クリック「キャンバスにする」 | 4 個を子に持つキャンバス 1 個・各子の絶対時刻 750 のまま |
| 15 | 何も無い所の右クリック「ここにキャンバスを作る」 | プレイヘッド 2 秒から 150 フレームの空のキャンバス |
| 16 | 画面に「group」「グループ」が出ない | 本文（メイン + プレビュー）・title / aria-label / placeholder とも 0 件 |

起動した Electron は終了時にプロファイルを握るプロセス 0 件を確認している（`leftoverProcesses`）。

## 注記

- ラウンド 3 のビルドで 4 回走らせ、3 回は全 PASS、1 回（他の席のビルドと重なった時間帯）だけ
  「一時停止中のシーク直後に点線の枠が出ない」「html の右クリックでメニューが開かない」が起きた。
  以後の 2 回連続の実行では点線の枠は 3ms 以内に出て、メニューの再試行も 0 回。
- 書き出し（render-cut / GPU / OSR）での背景・キャンバス内の字幕の見え方は本証跡では測っていない。
