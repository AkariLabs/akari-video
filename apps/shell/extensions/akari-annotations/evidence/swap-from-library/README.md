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

---

## r1（差し戻し feedback-r1 への対応）— L1 証跡

### 採取方法（r0 からの差分）

- 同じ fixture（`fixture-edit.json`、sha256 `0b6ccf6c…`）を `/tmp/swap-l1/ws` に再構成（メディアは内部リポの `assets/audio/takes/*-b.mp3` 等。尺は r0 と同じ 2.520979 / 1.800979 秒）。
  Electron は r1 の各ビルドで再起動（CDP 9395、内寸 1120×927）
- 計測は `scripts/r1-trials.mjs`: 棚のカードを実クリックし、Electron の stdout ログ（Theia がフロントの console をバックエンドへ転送）から
  `[akari-swap-trial]` 行を読んで、回ごとに 再読込回数・再生要求回数・送り直し回数・クリック→適用・クリック→`playback_state playing` を記録。
  併せてタイムラインの再生ヘッド線を約 150 ms ごとに標本化（`clickToPlayheadMoveS` = 2 標本連続で小さく前進し始めた時刻）。
  ログの全文は `r1-final-swap-trial.txt`、トークン別の要約は `scripts/r1-tokens.mjs`
- **計測時のマシン負荷**: load average 33〜70（他席の処理。自席では止めていない）。出力プレビューの再生そのものが遅く進む回がある

### 連続お試し（最終ビルド = codex 往復 3 後）— `r1-summary.json` / `r1-t-a-sfx12.json` / `r1-t-b-image9.json`

| # | 対象 | 候補 | 取得済み | 再読込 | 再生要求 | 送り直し | 結果 | クリック→適用 | クリック→再生(ログ) | 適用→再生(ログ) | クリック→再生ヘッド前進 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 効果音 bell-1 | sfx-blip-pluck | 未 | 1 | 1 | 0 | playing | 1.47 | 3.94 | 2.47 | 4.54 |
| 2 | 〃 | sfx-blip-beep | 済 | 1 | 1 | 0 | playing | 0.16 | 2.03 | 1.87 | 2.39 |
| 3 | 〃 | sfx-blip-sine | 未 | 1 | 1 | 0 | playing | 2.10 | 3.44 | 1.35 | 3.80 |
| 4 | 〃 | sfx-blip-marimba | 済 | 1 | 1 | 0 | playing | 0.18 | 1.71 | 1.53 | 2.13 |
| 5 | 〃 | sfx-blip-xylophone | 未 | 1 | 1 | 0 | playing | 1.67 | 3.91 | 2.24 | 4.60 |
| 6 | 〃 | sfx-chime-success | 済 | 1 | 1 | 0 | playing | 0.26 | 2.30 | 2.05 | 3.29 |
| 7 | 〃 | sfx-click-bottlecap | 未 | 1 | 1 | 0 | playing | 2.17 | 5.69 | 3.52 | 7.14 |
| 8 | 〃 | sfx-harp-gliss | 済 | 1 | 1 | 0 | playing | 0.99 | 3.63 | 2.64 | 4.44 |
| 9 | 〃 | sfx-click-bright-blip | 未 | 1 | 1 | 0 | playing | 1.52 | 3.73 | 2.21 | 4.79 |
| 10 | 〃 | sfx-impact-echo | 済 | 1 | 1 | 0 | playing | 0.24 | 3.30 | 3.06 | 4.05 |
| 11 | 〃 | sfx-click-clock-tick | 未 | 1 | 1 | 0 | playing | 1.77 | 3.51 | 1.74 | 4.13 |
| 12 | 〃 | sfx-levelup-arp | 済 | 1 | 1 | 0 | playing | 0.14 | 1.48 | 1.33 | 2.28 |
| 13 | 画像 img-1 | bg-aurora-polar | 未 | 1 | 1 | 0 | playing | 3.30 | 4.60 | 1.29 | 4.83 |
| 14 | 〃 | bg-deep-gradient | 未 | 1 | 1 | 0 | playing | 1.76 | 2.75 | 0.99 | 3.36 |
| 15 | 〃 | bg-aurora-polar | 済 | 1 | 1 | 0 | playing | 0.14 | 0.78 | 0.64 | 1.32 |
| 16 | 〃 | bg-fluid-marble | 未 | 1 | 1 | 0 | playing | 1.96 | 2.70 | 0.74 | 3.33 |
| 17 | 〃 | bg-deep-gradient | 済 | 1 | 1 | 0 | playing | 0.14 | 1.03 | 0.89 | 1.51 |
| 18 | 〃 | bg-frosted-glass | 未 | 1 | 1 | 0 | playing | 3.01 | 4.98 | 1.97 | 6.06 |
| 19 | 〃 | bg-fluid-marble | 済 | 1 | 1 | 0 | playing | 0.62 | 2.67 | 2.06 | 3.85 |
| 20 | 〃 | bg-silk-waves | 未 | 1 | 1 | 0 | playing | 2.62 | 4.26 | 1.65 | （0→0.57→2.42 と飛び飛びに前進） |
| 21 | 〃 | bg-frosted-glass | 済 | 1 | 1 | 0 | playing | 1.05 | 5.32 | 4.27 | （ログ playing 後も約 5 秒 0 のまま → window_end は 10.8 秒） |
| 22〜30 | B-roll broll-1 | still/br-*（9 回予定） | — | — | — | — | **実施不能** | — | — | — | — |

- 秒はすべてクリック起点。「取得済み」= クリック前に `assets/<category>/<id>` が既にあった回
- **確実性**: 21/21 回で再生要求 1 回・送り直し 0・`result=playing`。r0 の「シークのみで止まる」は再発なし。再生開始後の再シークもなし（ログ上 `ready_seek_response` は再生要求より前のみ）
- **3 秒以内**: 取得済み 10 回中 7 回（ログ基準。超過 3.63 / 3.30 / 5.32 秒）。未取得は適用→再生が 11 回中 10 回 3 秒以内（超過 3.52 秒）。
  超過した回の内訳は 再読込完了→ready-seek 応答の待ち（1〜3 秒）と、適用（保存）自体の遅れ（〜1 秒）で、高負荷下の出力プレビューの初期化時間
- **B-roll 枠が実施不能**: カタログの B-roll 動画は `broll/talkinghead-desk-ja-01` の 1 本だけ（出力プレビューが止まる既知の別問題）。棚の近い系統 `still/br-*` を
  broll-1（動画 item）に当てると、適用の約 10 ms 後に `trial_end` が出てお試しが終わり、棚が閉じる（`r1-t-c-broll-still-aborted.json`、トークン 28・29）。
  edit.json は `0b6ccf6c` に戻る（巻き戻し自体は正しい）。動画 → 静止画への入れ替えで選択スナップショットの対象判定が変わり、
  `pushSelectionSnapshot` の「別の item の選択」扱いで終了経路に入っているとみられる（未確定）

### 途中ビルドの計測（原因の確定用）

- `r1-round1-build-sfx12.json`（codex 往復 1 後、効果音 12 回）: 12/12 playing・送り直し 0。ただし取得済みでもクリック→再生 2.4〜8.3 秒。
  内訳 = 前の候補の巻き戻し保存による再読込 約 1 秒 → 素材解決 0.8〜5 秒 → 適用後に再読込が始まるまで 1〜1.9 秒 → ready-seek（往復 2 で解消）
- `r1-round2-build-sfx12.json`（往復 2 後）: 12 回中 4 回 `cancelled`。原因 = 終端での自動停止が再生前から有効で、再読込直後の古い再生位置（11.23 / 7.08 / 6.93 秒）の tick を
  「終端超え」と判定して停止していた（標本 1.40 → 6.93 → 1.40）。往復 3 で「再生開始 + 頭出し位置付近の tick を受けてから有効」に修正し、最終ビルドでは 0 件

### 回帰（各 1 往復）と磨き 2〜4

| 項目 | 記録 | 結果 |
|---|---|---|
| やめる で byte 一致（別候補 12 回の後） | `r1-d1-cancel-after-12.json` | 往復 1 ビルド: 12 候補の後の実クリック「やめる」→ `0b6ccf6c`。最終ビルドでも効果音 12 回の後・画像 1 回の後（`r1-f2-cancel.json`）の「やめる」で `0b6ccf6c` |
| 差し替える → Cmd+Z 1 手で byte 一致 | `r1-e1-try.json` / `r1-e2-confirm.json` / `r1-e3-undo.json` | `sfx-chime-success` を確定 → `b71b7c9a`（r0 と同じ bytes）→ Cmd+Z 1 回で `0b6ccf6c` |
| お試し中に別クリップを選ぶと巻き戻る | `r1-i4-select-other.png` | 効果音お試し中（`a21a810c`）に img-1 を実クリック → `0b6ccf6c`、棚・帯とも消える |
| 磨き 3: 履歴の文言 | `r1-e3-undo-footer.png` | フッター「素材の入れ替えを元に戻しました。」（BEFORE = r0 report の「素材を入れ替えを元に戻しました。」） |
| 磨き 2: トーストのノイズ | `r1-f1-image-trial-no-toast.png` / 全回の `toasts` | 最終ビルドの 22 回（効果音 12・画像 10）で通知 0 件。ただし今回は `ready_fallback` / `seek_fallback` が一度も起きず（ログ 0 件）、「通常シークへ落ちて再生できた」経路そのものは実機で踏めていない（単体テストのみ） |
| 磨き 4: 右クリックメニューの画面内クランプ | `r1-g1-menu-clamp-broll.png` | broll-1 を y=635 で右クリック → メニュー 9 項目 top 629.5 / bottom 923（内寸 927 の内側）で、「入れ替え…」を実クリックで起動できた。BEFORE = r0 `b3-ctxmenu-sfx.json`（9 項目目 y 1007 が画面外で element.click() に頼った）。項目の並びは r0 と同じ |

## r2（差し戻し feedback-r2 への対応）— L1 証跡

### 採取方法（r1 からの差分）

- 同じ fixture（`fixture-edit.json`、sha256 `0b6ccf6c…`）・同じ `/tmp/swap-l1/` 構成・CDP 9395・内寸 1120×927。
  入口は右クリック「入れ替え…」を実クリック（インスペクターが狭く「情報」タブが画面外だったため。r1 で両入口の並び一致は確認済み）
- `[akari-swap-trial]` ログは r2 から既定で出ない。計測時だけフロントで `localStorage.setItem('akari.swapTrial.log', '1')` を実行して有効化し、
  `scripts/r1-trials.mjs` はそのまま使用（フラグなしで 1 回お試し → ログ 0 行・お試しは成立、を確認: `r2-round1-h-nolog-trial-state.json`）
- 出力プレビューの 0〜約 8 秒は fixture の telop-1（全面の HTML オーバーレイ）が最前面にあるため、お試しの再生窓（2.4〜6.2 秒）では静止画が隠れる。
  静止画が出ていることは、お試し中に出力プレビューのシークバーを 10 秒付近へ実クリックして確認した（シークバーの操作では選択は変わらずお試しが続く）
- 計測中の load average 30〜67（他席の処理）
- 変更前比較: r0 のビルド（`addae247`）を `/tmp/swap-r0` の一時 worktree でビルドし、別ポート 9396・別プロファイルで 1 回確認

### 原因

入れ替えで broll-1 の素材が動画 → 画像になると、タイムラインの表示経路が `cuts`（index で選択）→ `layers`（id で選択）に変わる。
再読込後も選択が旧 cut の index を指したまま item id を失い、`pushSelectionSnapshot` が「別 item の選択」とみなして `finishMaterialSwap(false)` に入っていた。
r0 のビルドでも同じ操作で即終了する（`r2-r0build-broll-still-aborted.json`: 帯なし・棚が閉じ・edit.json `0b6ccf6c`）ので、**r1 の変更による回帰ではなく r0 からの問題**。

### 実測（最終ビルド = codex 往復 2 後）— `r2-summary.json`

| 受け入れ条件 | 記録 | 結果 |
|---|---|---|
| 動画 item に静止画候補を 9 回（候補を替えながら）→ お試しが続く | `r2-final-t-broll-still9.json` | 9/9 で `trial_end` なし・帯「お試し中」表示のまま・`playing`・再生要求 1 回・送り直し 0。未取得 6 / 取得済み 3。適用後の item は `at 90 / duration 1260 / v2 / in 0 / out 42`（freeze・mute なし）、lint pass・`media.source-range` 0 |
| 出力プレビューにその静止画が出る | `r2-final-a-broll-still-preview.png` / `r2-b-broll-still-trial-preview.png` | お試し中に 10 秒付近へシーク → コーヒー豆 / カフェ店内の静止画が表示、帯は出たまま |
| うち 1 回を「差し替える」→ Cmd+Z 1 手で byte 一致 | `r2-final-c1-try.json` / `c2-confirm` / `c3-undo` | `bef4466e` で確定 → Cmd+Z 1 回で `0b6ccf6c` |
| 別の 1 回を「やめる」で byte 一致 | `r2-final-b-cancel-after-9.json` | 9 候補の後 `0abc8dba` → `0b6ccf6c` |
| 画像 item に動画候補（`broll/talkinghead-desk-ja-01`）→ 即終了しない・やめるで byte 一致 | `r2-final-d1-…` / `d2-…` | 帯が出たまま（`trial_end` なし、`in 0 / out 2`、lint pass）→ やめるで `a8db7eb8` → `0b6ccf6c` |
| お試し中に本当に別 item を選ぶと巻き戻る | `r2-final-e1-try.json` / `e2-select-other.json` / `r2-final-e-select-other.png` | 静止画お試し中（`7e9d4fbc`）に bell-1 を実クリック → `0b6ccf6c`、帯・棚が消え、フッター「素材の入れ替えを元に戻しました。」 |
| 自動再生の回帰なし（効果音 3・画像 3） | `r2-final-f-sfx3.json` / `r2-final-g-image3.json` | 6/6 `playing`・送り直し 0。やめるで各 `0b6ccf6c` |

参考値（合否外）: クリック → `playback_state playing` は効果音 1.18〜2.09 秒 / 画像 1.42〜2.84 秒 / 静止画 B-roll 2.49〜11.23 秒（取得済み 2.49〜3.73、未取得はダウンロード込み 5.20〜11.23）。

往復 1 ビルドでも同じ 9 回（`r2-round1-t-broll-still9.json`）が 9/9 継続・`playing`。往復 2 は preview 側の変更を元に戻しただけ（下記）なので、最終ビルドで全項目を取り直した。

### ラッパーの判断で codex へ差し戻した点（往復 2）

往復 1 で codex は preview の `applyCutVisual` の `deselectCut({ report: requestedCutId === undefined })` を常に `report: false` に変えていた。
お試しと無関係の既存挙動（㉓ cut の無い区間へ移ったときの解除の report）まで変えるため差し戻し、codex は preview の変更を元に戻した
（widget 側の item id 判定と `restoreMaterialSwapSelection` だけで解消することを単体テストで確認）。最終ビルドの実機で 9/9 継続を確認済み。
