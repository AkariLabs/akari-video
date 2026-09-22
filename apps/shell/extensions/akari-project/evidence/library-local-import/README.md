# ローカルから取り込む — L1 証跡（codex 1 往復目の実装・ラッパー採取）

## 採取方法
- `apps/shell` で `npm ci --no-workspaces --ignore-scripts` → Electron dist と native build/ を `library-reference-in-shell` worktree から ditto → `npm run build` → libffmpeg を stock（`H264 Decoder` 1 件）へ戻してアドホック再署名
- 起動は **cwd = apps/shell**（dev ビルドの resolver 探索は cwd 依存。/tmp を cwd にすると「アセット resolver が見つかりません」になる = 既存の挙動）
- `AKARI_HOME` / `AKARI_LIBRARY_ROOT` / `AKARI_CREATOR_ROOT` / `THEIA_CONFIG_DIR` / `--user-data-dir` はすべて `<SCRATCH>/` 配下。CDP 9447
- 素材フォルダ `MyPack/`: short-hit.wav 0.8 秒 / mid-loop.wav 14 秒 / long-theme.wav 42 秒（ffmpeg sine）・my-font.otf（システムの Noto の複製）・grade.cube・clip.mp4（testsrc2 3 秒）・notes.docx（偽 zip）
- 操作は `scripts/cdp.mjs`（実マウス・`Input.dispatchDragEvent` による OS ファイルドロップ）と `scripts/find.mjs`。＋ →「選ぶ」は native ダイアログを CDP で操作できないため、widget の `dialogs.showOpenDialog` を renderer 内で差し替えて呼び出し引数を記録した

## 実測
| 観測 | 記録 | 結果 |
|---|---|---|
| ＋ がライブラリ面の右下 | `s1.png` | 表示される。楕円・Lint バッジと重なる（差し戻し 4） |
| フォルダをライブラリ面へドロップ | `s3.png` / `s4.png` | シート高 561 / 親 638 = **0.880**。効果音 1・BGM 1・フォント 1・映像 1・迷ったもの 1（mid-loop 14.0 秒）・取り込まない 2（docx「対応していない形式」・cube「presets/ の管轄」）。**ただし開いた直後は widget ノードが scrollTop=561 までスクロールされ、フッターだけがパネル上端に見える（`s3.png`）**。scrollTop=0 に戻すと正しい位置（`s4.png`）→ 差し戻し 1 |
| 効果音の行 → 一覧 → ▶ | — | details が開き 1 行。▶ で `file://<SCRATCH>/src/MyPack/short-hit.wav` の play() が resolve（元ファイルを鳴らす） |
| 乗せると大きな表示 | `s5-hover.png` | 300×220 のポップアップ（x=192 = 行の右隣）、波形 PNG（data URL）・「0.8 秒 · 69 KB」 |
| 全部開いても高さ不変 | `s6-all-open.png` | 全 details open 後もシート 561・scrollHeight 948 / clientHeight 440 で内部スクロール・「取り込む」は top 578 / bottom 629 で可視 |
| 迷ったもの → BGM | — | 切り替えは効く（aria-pressed BGM:true）が、**BGM ボタンが幅 190px のパネルからはみ出して見えない**（scrollIntoView で出して押した）→ 差し戻し 2 |
| 取り込む | `library-after-import.txt` / `meta-summary.txt` | 4 秒で完了。置き場に 5 素材（audio×3・broll・font）。全部 `validate-asset` exit 0・`origin:own`・`folder:MyPack`・sfx タグは short-hit だけ（mid-loop は BGM に切り替えたので無し）・`private-owned`・`ai_training_allowed:false`・price 0。受け入れ条件の「6 素材」は LUT を含む数で、司令塔追記どおり cube は rejected なので 5 |
| ホームの帯 | `s7-home-after.png` | 「最近入れた」の先頭に `MyPack · 5 件` の 1 個 |
| 同じフォルダを再ドロップ | `s8-duplicates.png` | 「0 個を取り込みます」・もう入っています 5 件（既存の素材名つき）・取り込むは disabled。外側クリックで閉じ、置き場の差分なし |
| ＋ → ローカルから取り込む → 選ぶ | — | メニュー: ローカルから取り込む / 素材サイトでさがす（無効）/ URL を貼って入れる（無効）/ 区切り / ライブラリを点検（無効）。macOS は 1 ボタン「ファイル・フォルダを選ぶ」で `{canSelectMany:true, canSelectFiles:true, canSelectFolders:true}`。同じシート（0 個・全件重複）に到達 |
| ライブラリに保管 | `s11-context-menu.png` | 実体カードの右クリックに「ライブラリに保管」（名前を変更の直前）。押すと置き場に `audio/proj-chime/` が入り validate 緑、プロジェクトの `git status` と `assets/` は不変 |
| プロジェクト面へのドロップ | — | `assets/short-hit.wav` が増え、置き場は不変、シートは出ない（従来どおり） |
| 取り込んだ効果音をタイムラインへ | `ledger-after-place.json` / `edit-diff-place.txt` | 台帳に `{audio, short-hit}` が 1 行、edit.json は `assets/audio/short-hit/short-hit.wav`、`assets/` は増えない（参照） |

## r0 時点の未修正（r1 で解消。下の「r1」節）
1. シートを開くと widget ノードがスクロールされシートが見えなくなる（必須）
2. 迷ったものの 効果音 / BGM 切り替えが狭いパネルではみ出す・フッターのボタンが折り返す
3. 先頭行: rejected があると ✓ が消える（「読み込みを確認しました（取り込まない 2 件）」）
4. ＋ が楕円で Lint バッジに重なる
5. 取り込み完了時に rejected とプレースホルダ警告をトーストで重ねて出す

## r1（差し戻し r1 の 5 点・codex `gpt-6-sol` / high の 1 往復・ラッパー採取）
- 採取方法は r0 と同じ（疑似環境 `<SCRATCH>` を使い回し、置き場は空に戻してから開始）。CDP は 9461（9447 は別レーンが使用中）。左パネルの幅は分割線を実マウスでドラッグして合わせた（widget 幅 190 / 320）
- 採取時の負荷平均は 100 超（8 コア・他レーンの GPU 書き出しと同時）。取り込みの所要はこの影響を受けている

| 観測 | 記録 | 結果 |
|---|---|---|
| ＋ の見た目（差し戻し 4） | `r1-s1-library.png` / `r1-s7-plus-menu-190.png` | 42×42・`border-radius: 50%` の円。右下で Lint バッジ（y 605〜637）の上（y 542〜584）に出て重ならない。メニューは 5 項目（3 つ無効・区切り） |
| ドロップ直後（差し戻し 1） | `r1-s2-drop-190.png` | シート top 80.6 / bottom 642（widget 4〜642）= 高さ比 **0.880**。widget の `scrollTop` は 0 のまま・`scrollHeight` 638 = `clientHeight`（シートが容器を伸ばさない。r0 は 1,199 まで伸びて 561 スクロールした）。「取り込む」は 598〜629 で可視 |
| 中のリストを 400 スクロールしてからドロップ | `r1-s3-drop-scrolled.png` | リストの `scrollTop` 400 のまま・シートは同じ位置（80.6〜642） |
| 幅 190 の迷ったもの・フッター（差し戻し 2） | `r1-s2-drop-190.png` | 効果音 / BGM が 1 行に並ぶ・「閉じる」「取り込む」が折り返さず 1 行 |
| 幅 320（シートを開いたまま広げる） | `r1-s4-sheet-320.png` / `r1-s5-ambiguous-bgm-320.png` | シートがパネルに追従（left 48 / right 368）。切り替え 70〜199 / 203〜331 で両方見える。BGM を押して `aria-pressed` が BGM:true |
| 先頭行（差し戻し 3） | `r1-s2-drop-190.png` | 「✓ 全部読み込めることを確認しました（取り込まない 2 件）」 |
| 全部開く | — | シート 561 のまま・中 scrollHeight 803 / clientHeight 459・「取り込む」598〜629 で可視 |
| 取り込む → トースト（差し戻し 5） | `r1-s6-after-import-toast.png` | トーストは「5 件を取り込みました」の 1 件だけ（rejected・プレースホルダ警告は出ない）。置き場に 5 素材・全部 validate exit 0（`r1-meta-summary.txt`。mid-loop は BGM にしたので `sfx` なし） |
| ホームの帯 | `r1-s7-plus-menu-190.png` | 「最近入れた」の先頭に `MyPack · BGM · 5 件` |
| ＋ → ローカルから取り込む → 選ぶ | `r1-s8-duplicates-190.png` | ダイアログ引数 `{canSelectMany, canSelectFiles, canSelectFolders: true}`。「0 個を取り込みます」・もう入っています 5 件（既存名つき）・取り込むは disabled。シートの上の余白を押すと閉じ、置き場のファイル一覧は差分なし |
