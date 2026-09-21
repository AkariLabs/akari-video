# 素材パネル「プロジェクト / ライブラリ」のスライダースイッチ — L1 証跡

## 採取方法

- BEFORE = 変更前の HEAD（`0d67b842`）を `git archive` で `/tmp/pfss-before` に展開してビルドしたもの。AFTER = 本ブランチのビルド
- Electron を直接起動（`scripts/launch.sh`。`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は `/tmp/pfss-l1/` 配下、CDP 9434、
  ウィンドウが隠れていても描画を止めないよう `--disable-backgrounding-occluded-windows` 等を付与）。ワークスペースは `templates/project-default` の複製
  （`ws` には ffmpeg の testsrc で作った動画 1・静止画 1 を置いた。`ws2` は空）
- `scripts/measure.mjs <label> [左パネル幅]` — 両面でトラック・つまみ・ボタンの矩形 / computed style / 折れ・はみ出し・横スクロールを記録
- `scripts/motion.mjs` — 実クリックでの切り替え（rAF ごとの computed transform・途中フレームのスクショ）、左右キー、reduced-motion のエミュレート、
  再読込・別プロジェクトを開き直した直後（新しい文書の先頭からサンプラを仕込む）、回帰（検索・カテゴリ・素材カード）→ `motion.json`
- `scripts/reopen-align.mjs` — ライブラリ面で左パネルを畳んで開き直す間、rAF ごとに つまみ left と「ライブラリ」ボタン left を記録 → `panel-reopen-align.json`

## 幅（左パネル = アクティビティバー 49px 込み。ウィジェット幅はその −49px）

| 記録 | 左パネル / ウィジェット | ボタン間の隙間 | つまみ = アクティブ側 | 折れ | はみ出し（scrollWidth/clientWidth） | 横スクロール |
|---|---|---|---|---|---|---|
| before-default | 213.67 / 164.67 | 4px | —（枠線方式） | なし | なし（72/72） | なし |
| after-default | 214 / 165 | **0** | OK | なし | なし（74/74） | なし |
| before-260 / after-260 | 259.76 / 210.76 → 260 / 211 | 4 → **0** | OK | なし | なし | なし |
| before-360 / after-360 | 360.2 / 311.2 → 360 / 311 | 4 → **0** | OK | なし | なし | なし |
| before-164 | 164.32 / 115.32 | 4px | — | なし | **省略記号**（68/48・59/48） | なし |
| after-164 | 164 / 115 | **0** | OK | なし | **省略記号**（62/49・53/49） | なし |

既存コメントの「パネル幅 164px」はウィジェット幅（= 新規 user-data の既定幅）に相当し、そこでは折れ・はみ出しなし。
左パネル 164px（ウィジェット 115px）では BEFORE も AFTER も省略記号になる（枠外にははみ出さない）。

## モーション（`motion.json`）

- computed: `transition-property: transform` / `transition-duration: 0.28s` / `transition-timing-function: cubic-bezier(0.32, 0.72, 0, 1)`、ラベル `color 0.16s, font-weight 0.16s, opacity 0.16s`
- 実クリック プロジェクト → ライブラリ: 途中値のフレーム 12 枚、動き出しから到達（±0.5px）まで約 200ms（曲線の末尾 0.5px 未満は除く）。
  90ms 時点の translateX = 62.3px（`motion-1-mid-slide.png`）。戻りも途中値のフレーム 12 枚（`motion-3-mid-slide-back.png`）
- 左右キー: → でライブラリ・フォーカスもライブラリへ、← でプロジェクトへ。フォーカスリング `solid 2px`（アクセント色）・`:focus-visible` true
- reduced-motion: `transition-property: none` / `0s`、ラベルも `none`。切り替えは途中値 0 フレーム。エミュレート解除で transform 0.28s に戻る
- 再読込（ライブラリ面から）・別プロジェクト `ws2` を開き直し・`ws` に戻す: いずれも新しい文書（timeOrigin が変わる）、面はプロジェクトに戻り、
  最初のフレームから translateX 0・transition 0s、途中値なし
- ライブラリ面で左パネルを畳んで開き直す: パネル展開アニメ（49 → 149 → 214px）中も、全フレームで つまみ left = 「ライブラリ」left（`allAligned: true`）。
  寸法変化の直後は transition 0s に落ちて 2 フレーム後に 0.28s へ戻る

## 回帰

- ライブラリ面: 検索欄 `ライブラリを検索`、カテゴリ 20、`bgm` で検索結果 9 行（`motion-6-regression-catalog-search.png`）
- プロジェクト面: 検索欄 `プロジェクト内を検索`、素材カード 2 枚（`motion-6-regression-materials.png`）
- 実クリックの当たり判定: 5 回ともねらったボタン（つまみは `pointer-events: none`）
