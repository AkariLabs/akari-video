# evidence: render-path-unification-l1

L1（実機・Electron + CDP）検証。タスク `2026-08-21-render-path-unification`
（`packages/edit-store`・`packages/render-cut`・`packages/edit-lint` — 実装済み・編集対象外）の
「クリップの旧種別（cuts/layers）は段の位置に一切依存しない」という主張を、実際に動く UI で確認する。

正典: `packages/edit-store/src/internal-model.ts` の `legacyKindOfV2Track` / `needsLayersEngine`
（2026-08-21 コメント）。media アイテムの旧種別は既定で常に `'cuts'`。`'layers'` に残るのは
blend（`normal` 以外）・keyframed perspective・background 未宣言の chroma_key のいずれかを
**アイテム自身が**宣言している場合のみで、段（track）の位置は一切見ない。

## 検証環境

- 隔離ワークスペース: `/tmp/render-path-unification-l1-ws/project/`（実プロジェクトは不使用）
- fixture 素材: ffmpeg lavfi 生成（`green.mp4` / `magenta.mp4` / `blue.mp4`、640x360@10fps、
  単色 + サイン波音声）。`scripts/prepare-fixture.mjs` が Electron 起動前にディスクへ書く
- production ビルド（`apps/shell`: `npm run build` — build:ext + `theia build --mode production`、
  browser/node/electron とも 0 errors）を実測前に**再実行して確認した**（重要: `packages/edit-store/
  lib/internal-model.js` の再コンパイル時刻が旧 `apps/shell/lib/frontend/bundle.js` より新しく、
  再ビルドしないと本タスクの修正前のフロントエンド bundle を検証してしまうところだった）
- Electron 本体（`apps/shell/node_modules/electron/dist/Electron.app`）を隔離
  `--user-data-dir` + `--remote-debugging-port` + `--no-sandbox` で起動し、生 CDP
  （`../timeline-tracks/scripts/cdp-lib.mjs` を再利用）でタイムラインを開き実 DOM を読む

## 実測メモ — シナリオごとに Electron を再起動する理由

`evidence/v1-clips` や `evidence/timeline-tracks` が使う「`Page.reload()` してから同じ fixture
パスを上書き→再度コマンドパレットでタイムラインを開く」という手法は、**本タスクの検証では
機能しなかった**。実測して判明したこと:

- ワークスペースの `project/` サブフォルダは、Electron を**新規プロセスとして CLI 引数で**
  起動したときだけ、オンボーディング側の自動判定で直接開かれる
- `Page.reload()` はこの自動判定を再トリガーしない（Theia 自身のレイアウト復元は、CLI 引数由来の
  この自動オープンとは別の仕組みで、reload 後は「ホーム」画面に戻る）。結果、edit.json の中身を
  書き換えて reload しても、タイムラインは古いプロジェクト（または空）を表示したままになる

このため、3 シナリオ（実質 5 フェーズ: `1`・`2a`・`2b`・`3a`・`3b`）はそれぞれ**新しい Electron
プロセス**で検証する（`scripts/run-l1.sh` がフェーズごとに fixture 準備 → 起動 → 検証 → 終了を
繰り返す）。

## 実測メモ — ドラッグ UI のバグ（本タスクの境界外・修正はしていない）

シナリオ 2・3 の「無関係なクリップの移動」を**実際のマウスドラッグ**で再現しようとしたところ、
2 番目以降の cuts クリップ（グローバル segment index が 0 でないクリップ）をドラッグすると、
**同一行内でのわずかな水平移動ですら**、`akari-annotations-widget.ts` の `cutItemId()` が
`updateDragPreview` 内から uncaught な例外を投げ、移動がコミットされないことを実測した:

```
Error: クリップ 2 の id を特定できません。
    at Xpn.cutItemId (bundle.js:7937:784)
    at Xpn.updateDragPreview (bundle.js:7937:28778)
```

再現手順（`v-pip`/`v-move` の 2 トラックがどちらも実クリップを持つ状態で確認、シナリオ 2 の
`2a` fixture）:

1. `move-1`（`v-move`、segment index 1）を実マウスでクリック
2. どんな向き・距離のドラッグでも（同一行内 30px の水平移動のみ、でも再現）
3. mousemove ごとに上記例外が uncaught で投げられ、mouseup 後も edit.json は無変化

一方 `pip-1`（segment index 0、タイムライン上で最初の cuts クリップ）を同じ手順でドラッグしても
例外は出ない（移動量が小さく実際にコミットされたかは未確認だが、クラッシュはしない）。

**このバグは本タスクの境界外**（`apps/shell/extensions/akari-annotations/**` は今回のタスクで
編集していない診断済みの既存コードで、`packages/edit-store` 等の変更対象外パッケージでもない）
であり、ここでは修正していない。ただし、これは本タスクの分類変更が新たに露出させた可能性が高い:
本タスク以前は `mainVisualTrackId` が「唯一の本編トラック」を選ぶ実装だったため、**2 本以上の
visual トラックが同時に `cuts` 種別を持つ状態はそもそも作れなかった**（本編以外は強制的に
`layers` になっていた）。本タスクの修正で「素の media アイテムは段に関わらず常に `cuts`」に
変わったことで、初めて「2 本以上の `cuts` トラックにそれぞれクリップがある」状態が実プロジェクトで
到達可能になり、そこで初めてこの UI 側の添字管理バグが踏まれる。

このため、シナリオ 2・3 は**実ドラッグではなく**、2 回の独立した実機起動（before/after）＋
実 DOM 読み取りで検証した（詳細は各シナリオの節）。検証しているのはタスクの核心である
「無関係なクリップの分類が変わらないか」そのものであり、（別バグである）ドラッグ操作自体は
対象にしていない。

## L1 実測 — 総合判定: PASS（3 シナリオとも分類は不変。ドラッグ UI の別バグを 1 件発見・報告のみ）

再現コマンド:

```sh
bash apps/shell/extensions/akari-annotations/evidence/render-path-unification-l1/scripts/run-l1.sh
```

`scripts/run-l1.sh` が `1 → 2a → 2b → 3a → 3b` の順に Electron を起動し直し、最後に
`scripts/compare-states.mjs` が `2a`/`2b` と `3a`/`3b` のスナップショット差分を判定する。

| # | シナリオ | 手法 | 結果 |
|---|---|---|---|
| 1 | P0 の受け入れ条件（V1 の単一クリップを新規空トラックへ移動） | 実マウスドラッグ | **PASS** |
| 2 | feedback-r1.md の対抗トポロジー（空トラック + transform-only PiP + 移動対象） | 実機 2 回起動（before/after 比較） | **PASS** |
| 3 | feedback-r2.md の対抗トポロジー（v1/v2/v5 命名で再現） | 実機 2 回起動（before/after 比較） | **PASS** |

### シナリオ 1: PASS

`v-main`（唯一の visual トラック）にある素のクリップ `clip-1` を、既存行の上端 6px 以内へ実際に
マウスドラッグ（`Input.dispatchMouseEvent` の press/move×N/release）して新規トラック作成を発火させた。

- ドラッグ後 `edit.json`: `v-main` が空になり、新規トラック（widget が採番した id）に
  `clip-1` が移動（`run-log-phase1.json` の `scenario1-edit-after` 参照）
- 移動前後で `clip-1` の DOM 表現が完全一致: `data-akari-item-kind="cut"` のまま、
  `className` は `akari-annotations-strip-clip` のまま、`getComputedStyle(...).backgroundColor`
  は `rgb(39, 39, 42)`（クリップ本体）・`rgb(44, 138, 154)`（ヘッダー帯）のまま不変
  （実測値は `run-log-phase1.json` 参照）
- 新規トラックの track band 種別 (`data-akari-kind`) も `cuts` のまま
- スクリーンショット: `s1-00-before.png`（V1 に C1・青緑ヘッダー・緑本体・`s1` バッジ）→
  `s1-01-after.png`（同じ見た目の C1 が V2 に移動、元の V1 は「V1 (空)」に。フッターに
  「クリップを移動しました。」の実メッセージも出ている）

### シナリオ 2: PASS（実ドラッグの代わりに 2 回起動の before/after 比較）

`2a`（before）: `v-empty`（空）/ `v-pip`（`pip-1`、`transform` のみ宣言）/ `v-move`（`move-1`、
素の全画面クリップ）の 3 トラック。`2b`（after）: `move-1` が `v-move` から `v-empty` へ
（`moveItem()` が実際に行う手術どおり、id・duration・source・transform は変更せず `at` のみ
再設定）移り、`v-move` が空になった状態を直接ディスクへ書いて実機で開いた。

- `state-2a.json` / `state-2b.json`（実 DOM から読み取った値）を `compare-states.mjs` で比較:
  `pip-1` の `itemKind`（`"cut"` → `"cut"`）・`className`
  （`akari-annotations-strip-clip` → 同一）・`background`（`rgb(39, 39, 42)` → 同一）・
  `headerBackground`（`rgb(44, 138, 154)` → 同一）すべて完全一致（**PASS**）
- `v-pip` の track band 種別 (`data-akari-kind`) も `cuts` のまま両方で確認
- 移動後 `move-1` も `v-empty` 上で `itemKind: "cut"` として描画されることを確認
- スクリーンショット: `2a-state.png`（`pip-1` = C2・magenta 本体・`s2` バッジ）と
  `2b-state.png`（同じ `pip-1` が同じ見た目で描画されたまま、`v-move` が「V3 (空)」に変わり
  `move-1` が別トラックへ）を目視でも比較・一致を確認

### シナリオ 3: PASS（同上、feedback-r2.md 自身の命名 v1/v2/v5 で再現）

`3a`（before）: `v1`（`moved-1`、素のクリップ）/ `v2`（`pip-1`、`transform` のみ）/ `v5`（空）。
`3b`（after）: `moved-1` が `v1` から `v5` へ移り、`v1` が空になった状態
（= feedback-r2.md が報告した反転バグの再現トポロジーそのもの: v1 空 / v2 手つかず pip /
v5 に移動後のクリップ）。

- `state-3a.json` / `state-3b.json` の比較: `pip-1`（`v2` 上）の `itemKind`・`className`・
  `background`・`headerBackground` すべて完全一致（**PASS**）。feedback-r2.md が報告した
  「`pip-1` の `legacy.collection` が `'layers'` → `'cuts'` へ反転する」という症状は、本タスクの
  修正後は発生しない（そもそも `pip-1` は before/after とも `'cuts'` — 本タスクが transform-only
  PiP を `crop`/`perspective` 同様に cuts 経路へ倒す設計へ変えたため、この項目自体が「layers
  であるべき」ものではなくなった。それでも「段によって黙って変わる」ことがないことは、
  before/after の値が一致していることで直接確認できている）
- スクリーンショット: `3a-state.png`（`v5 (空)` + `v2` の `pip-1`）と `3b-state.png`
  （`v5` に移動後の `moved-1`・青本体・`s1` バッジ、その下に見た目そのままの `pip-1`）

## ファイル一覧

- `scripts/prepare-fixture.mjs` — フェーズごとの edit.json + ffmpeg 素材をディスクへ用意
  （Electron 起動前）
- `scripts/run-l1.mjs` — CDP 接続・タイムライン起動・シナリオ 1 は実ドラッグ、
  シナリオ 2/3 は capture-only（`laneItemState`/`trackBandKind`/screenshot を
  `state-<phase>.json` へ）
- `scripts/compare-states.mjs` — `2a`/`2b`・`3a`/`3b` の before/after 比較・PASS/FAIL 判定
- `scripts/run-l1.sh` — 5 フェーズ（`1`/`2a`/`2b`/`3a`/`3b`）のオーケストレータ
  （フェーズごとに Electron を起動し直す。理由は上記「実測メモ」参照）
- `phase*-00-boot.png` / `s1-*.png` / `2a-state.png` / `2b-state.png` / `3a-state.png` /
  `3b-state.png` — 実機スクリーンショット
- `run-log-phase*.json` — 各フェーズの assertion ログ（`record()`/`assert()` の全記録）
- `state-2a.json` / `state-2b.json` / `state-3a.json` / `state-3b.json` — before/after の
  DOM スナップショット（`compare-states.mjs` の入力）
