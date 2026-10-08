# L1 — テンプレのテロップは外側から選ぶ・ダブルクリックで文字の編集・メニューの「中の部品を選ぶ」（2026-10-08-preview-telop-outer-first）

シェル実機（npm の Electron 39.8.7・`path.txt` あり・stock の `libffmpeg`（H.264 あり）= tier 2）で、
テンプレのテロップ（`isTelopOverlay` が真のアイテム）を押したときに外側（アイテム）が選ばれるか、
ダブルクリックで文字の編集に入れるか、小さなメニューの「中の部品を選ぶ」で中の要素を選べるか、
テンプレでない HTML の選び方が変わっていないかを測る。

## 回し方

```bash
bash apps/shell/extensions/akari-preview/evidence/preview-telop-outer-first-v1/scripts/run-l1.sh after
#   AKARI_PTOF_OUT_DIR    = 記録の置き場（既定 /tmp/ptof-l1/<mode>）
#   AKARI_PTOF_RUNS="T S" = 起動の組（T = テロップの fixture / S = 同梱のサンプル）
#   AKARI_PTOF_BEFORE_DIR = before の記録（after は before と比べる手順がある。既定 <out>/../before）
#   AKARI_PTOF_LIBRARY    = 利用者のライブラリの根（既定 ~/Akari/library）。テロップ telop-base-question-label-tab があれば ov-lib として置く
```

先に `apps/shell` の `npm run build` が要る（`prepare-fixture.mjs` が `akari-surfaces/lib` のオンボーディングのサービスでサンプルを書き出す）。
before は分岐点の作業ツリーを複製した場所で `AKARI_REPO_DIR=<複製> bash …/run-l1.sh before` として回す（判定なしの記録）。

- `scripts/prepare-fixture.mjs`: 作業用フォルダに 2 つのプロジェクトを作る
  - `project`（出力 1280×720・10 秒・4 トラックに同じ時間で並べる）
    - `ov-plate` = ソースが `assets/overlay/telop-l1-plate/fragment.html`（ライブラリのテロップを置いたときの形）。板 `.tp__plate` + アイコン `.tp__icon` + 文字 `.tp__text`
    - `telop-l1-name` = id が `telop-*`（ソースは `overlays/name-card.html`）。板 `.nc__plate` + 名前 `.nc__name` + 肩書き `.nc__role`
    - `ov-lib` = 利用者のライブラリのテロップ `telop-base-question-label-tab` を、ライブラリから置いたときと同じ `assets/overlay/<id>-edit-<item>-…/fragment.html` の形へ写したもの（`params.text` 付き）。**素材の実体はリポに入れない**（ライブラリが無い環境では置かない）
    - `ov-card` = テンプレでない HTML（`overlays/card.html`）。テロップと同じ形（板 + アイコン + 文字）で、判定だけが違う
  - `sample` = 同梱のオンボーディングのサンプル（お手本の最終段・`demo-title` / `demo-diagram` を含む HTML 断片 9 本）
- `scripts/run-l1.mjs`: CDP で操作して測る（クリック・ダブルクリック・ドラッグ・キーはすべて `Input.dispatch*` の実入力。小さなメニューのボタンはホストの文書を実クリック）

## 手順と判定（after）

run T（テロップの fixture）:

| 手順 | 判定 |
|---|---|
| (a) 各テロップ（ov-plate / telop-l1-name / ov-lib）の文字の上を 1 回クリック | アイテムが選ばれ要素の焦点なし・パンくずはアイテムの段まで（「全体 › <テロップ>」）・メニューに「中の部品を選ぶ」（`aria-pressed=false`・文字なしのアイコン） |
| (a) 文字の上を ⌘ クリック | 外側のまま（要素の焦点なし）。選んでいるものをもう 1 回 ⌘ クリックすると選択が外れるのは分岐点と同じ |
| (a) 外側で選んだまま中の部品（アイコン / 肩書き / 板）の上へホバー | ホバー枠が中の要素に付かない（無いか、テロップ全体の枠） |
| (c) 板（文字でない所）をダブルクリック | 何もしない（外側の選択のまま・文字の編集に入らない） |
| (c) 文字の上をダブルクリック → Esc | 文字の編集に入る（要素の焦点・パンくずの段を作らない）→ Esc で取り消し・断片は不変・外側の選択のまま |
| (6) タイムラインの行（チップ）を押す | 外側（要素の焦点なし）・ボタンは `aria-pressed=false` |
| (5) ov-card（テンプレでない）の文字を押す / 行で選んで Enter | いちばん深い要素（`.oc__text[0]`）/ メニューに切替ボタンなし / Enter で要素へ降りる |
| (参考) ov-card の文字の編集 → Enter → ⌘Z | 分岐点と同じ結果（いまの文字の編集は ⌘Z の履歴に積まれない = 分岐点でも戻らない） |
| (1)(b) ov-plate の文字の上からドラッグ (+40, −24) | 板と文字が同じだけ動く・edit.json はアイテムの `transform` だけ変わる（`source.elements` なし・断片は不変）・外側のまま |
| (2) 文字の上のダブルクリック → 「改」を入れて Enter | 断片に保存される・編集中も確定後も要素の焦点なし（パンくずはアイテムの段）。⌘Z は分岐点と同じ結果（文字は戻らず、1 つ前の (1) のドラッグが戻る）|
| (3)(d) メニューの「中の部品を選ぶ」→ 板を押す → 辺 e を +30px | ボタンはロックの隣・押すと `aria-pressed=true`「外側を選ぶ」・板 `.tp__plate[0]` に焦点・`source.elements['.tp__plate[0]'].style.width` が書かれる（E3 と同じ書き込み）・その後もテロップのまま（`is-telop`・ボタンあり）→ 空を押して解除 → 文字を押すと外側（ボタンは `false`）|
| (3) 「中を選ぶ」でアイコンを選んだまま ov-card を押す → ov-plate の文字を押す | ov-card は今までどおり深い要素・切替ボタンなし / 戻ると外側 |
| (4) 外側で Enter → Esc … | Enter で中へ（最初の要素・ボタン `true`）→ Esc でアイテムの段（ボタン `false`）→ もう 1 回の Esc で解除 |

run S（同梱のサンプル）:

| 手順 | 判定 |
|---|---|
| (5) `demo-title` / `demo-diagram` の最初の文字要素を 1 回クリック・⌘ クリック | 焦点が before の記録と同じ（`.demo-title__lead[0]` / `.demo-diagram__title[0]`）・メニューに切替ボタンなし |

## 記録

記録（`run-T.json`・`run-S.json`・`environment.txt`）はリポに入れない（`evidence/` にはスクリプトと README だけを置く）。結果の要約:

- before = 分岐点 `4a84389ba`（`git archive` で書き出した作業ツリーに依存を敷いて build したもの）。判定はせず記録だけ（`status: RECORDED`）
- after = 本票の最終コード。**run T PASS 26 / 26・run S PASS 2 / 2**（tier 2: `path.txt` あり・`libffmpeg` の `H264 Decoder` = 1）
- before で見えたこと（after ではテロップについてすべて解消）:
  - テロップの文字を 1 回押すと文字の要素（`.tp__text[0]` など）に焦点・パンくず「全体 › ov-plate › tp__plate › tp__text」・メニューは 5 個（注釈 / ロック / 複製 / 削除 / その他）
  - ⌘ クリックも同じ要素へ・ホバーは中のアイコンに付く・板のダブルクリックで板に焦点
  - 文字の上のドラッグは文字だけが動き、`source.elements['.tp__text[0]'].style.translate` が書かれる（板は動かない）
  - 要素の書き込み（`source.elements`）が入ったテロップは、ホストが上書き済みの HTML を送るため `sourcePath` が消え、テロップと判定されなくなる（選択枠の `is-telop` が外れる）。after ではホストが元のファイル参照を `sourcePath` に残す
  - 文字の編集は ⌘Z の履歴に積まれない（テロップでも ov-card でも）。after も同じ
