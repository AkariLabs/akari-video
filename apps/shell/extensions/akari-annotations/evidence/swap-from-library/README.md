# 素材の入れ替え v0（入口 1 行 → 候補棚 → お試し → 確定）— L1 証跡

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`、codex 3 往復目の最終差分）の Electron を直接起動。`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は
  一時ディレクトリ（`/tmp/swap-l1/`）。CDP ポート 9395。起動後 `window.resizeTo(1120, 980)`（内寸 1120×927 CSS px）、プレビューとタイムラインの境を上へ、
  中央と右パネルの境を右へドラッグ。カタログは本番（AKARI Sounds / still / broll）
- fixture `fixture-edit.json`（sha256 `0b6ccf6c…`、git 管理のプロジェクト。メディアは GOP 1 秒に再エンコード）:
  - V1 `cut-1` / `cut-2`（base.mp4。本編カット）/ V2 `img-1`（`assets/still/bg-aurora-mesh/bg.png`、0〜60、transform あり）・
    `broll-1`（`assets/broll/br-city-walk-long/clip.mp4`、90〜1350 = 42 秒。検証用に作ったライブラリ形の 45 秒 B-roll。meta.json は `fixture-broll-meta.json`）/
    V3 `telop-1`（HTML オーバーレイ）/ A1 `bell-1`（`sfx-bell-tree`、60〜136、gain −3・fade あり）・`pop-1`（150〜204）/ A2 `bgm-1`（role bgm）
  - トランジション確認用 `fixture-trans-edit.json`（V1 に cut 2 本のみ）
- 操作はすべて実マウス / 実キー（CDP `Input.dispatchMouseEvent` / `dispatchKeyEvent`）。例外は下記「実クリックできなかった所」だけ
- 再生の観測はタイムラインの再生ヘッド線（`style.left` %）を 150 ms ごとに標本化。線の全幅は 49.5 秒相当（`DUR=49.5` で換算。10 秒へのシークが 9.09 と出たことから較正）
- edit.json の同一性は sha256 で判定。lint は `packages/edit-lint/bin/edit-lint.mjs --json`（`media.source-range` を含む）

## 実測値

| 受け入れ条件 | 記録 | 結果 |
|---|---|---|
| 効果音を選択しただけでは、ライブラリ面もインスペクター（入れ替え行を除く）も変わらない | `a0` → `a1`（音声タブ）/ `a2`（情報タブ）| 左パネルの内容は選択前後で同一（プロジェクト面のまま、棚なし）。インスペクターの音声タブは入れ替え行なし（102 行）、情報タブの先頭に「入れ替え ／ ⇄ 候補を見る」の 1 行だけが加わる。edit.json 不変 |
| 「⇄ 候補を見る」/ 右クリック「入れ替え…」で帯 + 近い系統 + それ以外。同じ入力で同じ並び | `b1`（インスペクター経由）/ `b3`・`b4`（右クリック経由）/ `b2`（✕）| 帯「⇄ 入れ替え候補 / Bell Tree Sweep Upward…（カタログの title）/ 通常のライブラリに戻る ✕」。近い系統 6（`sfx-blip-*` ほか）/ それ以外の音源 210（id 昇順、local の 3 件は「お試し不可」）。現素材は除外（旧 217 → 216）。インスペクター経由と右クリック経由で並びが完全一致。再起動をまたいでも同じ。✕ で通常のライブラリ面に戻る |
| カードクリックで item の手前から再生 + 帯「お試し中」。at とトラックは不変 | `c1`〜`c18`（効果音 18 回）/ `e1` / `h2` | 帯「お試し中: A → B ［▶ もう一度］［差し替える］［やめる］」は毎回出る（出力プレビュー上端、z-index 1000）。bell-1 は常に A1・at 60。自動再生: **判定できた 17 回中 14 回は item.at−0.6 = 1.40 秒へシークして item 頭 + min(尺, 3.2 秒) まで再生**（例 c1 1.40→4.17 = 2.0+2.1、c3/e1 1.40→5.03 = 2.0+3.0、h2 画像 0→2.04）。**3 回（c2・c4・c15）は 1.40 秒へのシークまでで再生が始まらなかった**（直後の「▶ もう一度」はいずれも正しく再生）。10 秒窓で判定しきれなかった 3 回（c9・c10・c12）は除外。クリックから再生開始まで 0.1〜7.6 秒 |
| 「やめる」で byte 一致。別候補を 3 回以上試してからでも同じ。履歴に残らない | `d1`（18 候補のあと実クリック「やめる」）/ `d2` | `2a1a3b3b` → `0b6ccf6c`（fixture と byte 一致）。直後の Cmd+Z で edit.json 不変（お試しの手が履歴にない）。同じ候補は何度試しても同じ bytes（c1 と c14 がともに `b71b7c9a`）＝ 先に巻き戻してから適用 |
| 「差し替える」で確定、Cmd+Z 1 手で元へ | `e2` / `e3` | 実クリック「差し替える」で `4f509632` のまま帯が消え棚が閉じる → Cmd+Z 1 回で `0b6ccf6c`（byte 一致） |
| 長い効果音でも次の item と重ならない | `e1` | `sfx-impact-echo`（5.24 秒）→ bell-1 は 60+90（= 次の pop-1 の at 150 で止まる）、`source.out` 3.0。lint pass・`media.source-range` 0 |
| 短い B-roll で末尾が静止で埋まる | `g1`〜`g4` | 42 秒の broll-1 を 37.6 秒の `broll/talkinghead-desk-ja-01` へ: at 90・duration 1260・トラック v2・mute true は不変、`in 0 / out 37.6 / freeze {at_sec 37.6, duration_sec 4.4}`。lint pass。右クリック「入れ替え…」は実クリックで届いた |
| お試し中の別クリップ選択 / 棚を閉じる / プロジェクト面へ切り替え で巻き戻る | `i4`（タイムラインで別クリップ pop-1 を選択）/ `i1`（プレビュー上のクリックで別 item を選択）/ `b2`・`d1`（✕・やめる）/ `i2`（プロジェクト面）/ `i3`（タイムラインの空き所クリックで選択解除）| いずれも `0b6ccf6c` へ戻り、棚が閉じる |
| テロップ・BGM・本編カット・トランジションでは入口が出ない | `j-summary.json` / `j-positive-recheck.json` / `j-ctxmenu-transition.json` / `j-transition-selected.png` | telop-1（HTML）・bgm-1・本編 cut-1: 情報タブに行なし、右クリックに「入れ替え…」なし。トランジション（fixture-trans）を選ぶとカットのインスペクターになり、どのタブにも行なし・右クリックメニューなし。画像・B-roll・効果音は行・メニューとも出る |
| 回帰: インスペクター操作 / 素材 D&D / トランジション D&D | `k1` / `k2` / `k3` / `k4` | k1: bell-1 の gain_db を −3 → −6（実キー入力）→ Cmd+Z で byte 一致。k2: ライブラリ SFX `sfx-click-bottlecap` を A1 へ D&D → `audio-1@1006+54`、lint pass、Cmd+Z で byte 一致。k3: プロジェクト面の `raw-clip.mp4` を V3 へ → `clip-1@1124+120`、Cmd+Z で byte 一致。k4: ディゾルブをカット境界へ → 受け皿は出るが edit.json 不変。**変更前ビルド（兄弟 worktree、`6a060562`）でも同じ結果**（`k4-…-baseline-prechange-build.json`）で、前段 library-direct-place の報告と同じ既存挙動 |

## 既存の別問題（本票の変更によらない）

- `broll/talkinghead-desk-ja-01`（GOP 11 秒）を freeze 付きで置くと、出力プレビューの初期化が「メディア供給」段で止まる。edit.json を直接書いても同じ（`g5`。これのみ codex 2 往復目のビルドで採取）、
  **変更前ビルドで同じ edit.json を開いても同じ**（`g6`）。お試し中はこのとき「出力プレビューの準備を確認できなかったため通常の再生を試みました（▶ もう一度 で再試行できます）。」が出るが、帯は残り「やめる」で byte 一致に戻る（`g3`・`g4`）
- タイムラインの右クリックメニューは画面下端でクランプされない。bell-1（y 734）の右クリックでは 9 項目目の「入れ替え…」が y 1007（画面 927 の外）に出るため、
  この 1 件だけ `element.click()` で起動した（`b3-ctxmenu-sfx.json` の `activation`）。B-roll（y 643）では実クリックで起動できた（`g1`）

## スクリプト

`scripts/` — `swap.mjs`（棚の要約・カードの実クリック・帯ボタンの実クリック・状態記録・lint）/ `try-sample.mjs`（カードの実クリック + 再生ヘッド標本化）/
`replay-sample.mjs`（「▶ もう一度」実クリック + 標本化）/ `open-swap.mjs`（クリップ選択 → インスペクター → 情報タブ → ⇄ 候補を見る）/ `ctx.mjs`（右クリックメニュー）/
`panel.mjs`（左パネル・インスペクターの要約）/ `inspector-edit.mjs`（インスペクター数値入力 + Cmd+Z）/ `undo.mjs` / `mdrop.mjs`・`transdrag.mjs`・`opencat.mjs`・`mdrag.mjs`・`click.mjs`・`ev.mjs`・`cmd.mjs`・`cdp-lib.mjs`
（`material-drop-no-overlap` / `library-direct-place` の証跡スクリプトをパス・ポートだけ変えて複製したものを含む）。`winsize.mjs` は Electron では使えなかった（`Browser.getWindowForTarget` 非対応）。
