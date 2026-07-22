# evidence: 見せ場マーカー帯

## 実装契約

- `edit.json` の有効な `beats[]` が 1 件以上ある場合だけ、字幕帯より上へ `data-akari-lane="beats"`
  の専用帯を追加する。帯の UI ラベルは「見せ場」。beats 不在・非配列・空配列・全件不正の場合は帯を
  作らず、字幕帯の従来位置 `top: 14px` を維持する。
- 見せ場マーカーは source 秒を既存 `sourceRangeToOutputRanges()` で timeline 秒へ射影する。
  v1 の `src` は同じ `cuts[].src` のセグメントだけを対象にし、同一区間の再利用時は一対多で描画する。
- マーカーは kind 別テーマ色と strength に線形対応するサイズ・不透明度を持つ。tooltip は
  `kind` / `strength` / 任意の `basis` を表示する。マーカー自身に click / pointerdown / drag の
  リスナーは付けず、親 strip の click もマーカー由来なら無視するため edit.json を書き戻さない。
- 不正な beat は 1 件単位で無視し、他の beat とタイムライン描画を継続する。

## fixture

| fixture | 内容 | 計算上の期待位置（timeline 秒） |
|---|---|---|
| `fixture/a-v0/edit.json` | v0、kind/strength の異なる 3 件 | `b-0001=1`, `b-0002=4`, `b-0003=8` |
| `fixture/b-v1/edit.json` | v1、`s1` の同一 beat が 2 keep-range に出現。`s2` は同じ source 秒範囲 | `b-0101=[2,9]`, `b-0102=[6]` |
| `fixture/c-invalid/edit.json` | 有効 2 件 + id/strength 不正 1 件 | `b-0201=1`, `b-0203=5`（不正要素は 0 件） |

fixture (b) の cuts を `[s1:1-3, s2:0-4, s1:0-4]` へ並べ替えた後は、`b-0101=[1,8]`
へ再射影される。

## L0 実測

所有外へ生成物を置かないため、`apps/shell` の同一内容を `/tmp` へ複製し、既存依存を参照して実行した。
2026-07-22 の最終実測:

| コマンド | 結果 | 所要時間 |
|---|---|---:|
| `npm run build:ext` | **PASS**（exit 0） | 0.52 秒 |
| `npm run lint` | **PASS**（exit 0） | 2.50 秒 |
| `node --check evidence/beats-band/scripts/run-l1.mjs` | **PASS**（exit 0） | 1 秒未満 |
| `parseEdit()` に fixture (a)(b)(c) を入力する直接検査 | **PASS**（3 fixtures） | 1 秒未満 |

production build も同じ一時環境で実行し、browser 0 errors（2.254 秒）、node 0 errors（1.788 秒）、
electron 0 errors（0.020 秒）を確認した。

## L1 実測 — 主要項目 PASS / ライブ更新 1 点未確認

2026-07-22、beats-edit-map worktree の production build（`npm run build`、browser/node/electron
すべて 0 errors）を使用した。`templates/project-default/` を展開した隔離ワークスペースへ各 fixture を
`exports/edit.json` として事前配置し、隔離 `--user-data-dir`、`--remote-debugging-port`、
`--no-sandbox` を付けて Electron を直接起動した。コマンドパレットから「タイムラインを開く」を実行し、
`scripts/run-l1.mjs` と同じ生 CDP 経路で DOM と edit.json のバイト列を実測した。

| # | 受け入れ条件 | 結果 | 実測値 |
|---|---|---|---|
| 1 | beats 無しの非退行 | **PASS** | beats バンド 0 件、captions バンド `style.top === "14px"`（導入前と同一） |
| 2 | fixture (a) の件数・位置・最上段・ラベル | **PASS** | 3 件。`leftPercent * 10.2 / 100 = 1.0, 4.0, 8.0` 秒。beats.top < captions.top、ラベル `見せ場` |
| 3 | fixture (a) の kind 色 | **PASS** | hook=`rgb(89, 164, 249)`、reveal=`rgb(241, 76, 76)`、emotion=`rgb(177, 128, 215)` の 3 色 |
| 4 | fixture (a) の strength・tooltip | **PASS** | strength `0.2 → 0.6 → 1.0` に対し width `11.59 → 14.98 → 18.38px`、opacity `0.48 → 0.74 → 1.0`。b-0001=`kind: hook\nstrength: 0.2\nbasis: 冒頭の問い`、b-0002=`kind: reveal\nstrength: 0.6`（basis 行なし）、b-0003 は basis 行あり |
| 5 | 読み取り専用 | **PASS** | click 前後の playhead はともに `"0%"`。click + drag 前後で edit.json のバイト列が完全一致（書き戻しゼロ） |
| 6 | fixture (b) の src 一致・一対多 | **PASS** | 合計 3 件。`b-0101`（src=s1）は 2 件、`2.0, 9.0` 秒。`b-0102`（src=s2）は 1 件、`6.0` 秒 |
| 7 | fixture (c) の 1 件劣化 | **PASS** | `invalid-id` は 0 件。有効な `b-0201`, `b-0203` の 2 件だけを `1.0, 5.0` 秒へ描画 |
| 8 | fixture (b) の cuts 並べ替え後のライブ再射影 | **未確認** | 期待値 `b-0101=[1,8]` 秒。静的な事前配置による fixture (a)(b)(c) の切り替えは確認済み |

### 未確認事項

fixture (b) の cuts 並べ替え後に `b-0101` が `[1,8]` 秒へ再射影されるライブ更新だけは、本セッションの
実機環境では確認できなかった。`exports/edit.json` への Node fs 経由の外部書き込みと、アプリ内 Monaco
エディタでの直接編集・保存（`fileService` 経由）の双方で、`AkariAnnotationsWidget.configure()` が既存の
`fileService.onDidFilesChange` に登録しているリロード購読の発火を確認できなかった。beats を含まない
素の cuts 変更（`{in:0,out:20}` の 1 カットへの書き換え等）でも同じく再描画されなかったため、beats
固有の不具合ではなく、隔離ワークスペース + `--remote-debugging-port` + `--no-sandbox` 直接起動という
検証ハーネスにおける、既存 `fileService.watch()` / `onDidFilesChange` パイプラインの前提条件の限界と
判断した。したがって、この 1 点のみ実機ライブ更新は未確認であり、各 fixture を起動前に静的配置した
状態での件数・位置・表示・読み取り専用動作はすべて実測済みである。
