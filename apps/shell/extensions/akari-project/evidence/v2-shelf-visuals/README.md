# V-2 棚の見える化 — L1

`apps/shell` をビルドした状態で `node run-l1.mjs before|after` を実行する。CDP ポートは既定 9551、`L1_CDP_PORT` で変更できる。Electron はスクリプトが直起動し、自分の PID だけを終了する。窓は 1280×800、左パネルは 360px に広げる。`before/` と `after/` にサニタイズ済み `observations.json` とスクリーンショットを保存し、JSON は書き込み後に読み直して検証する。

`before` は欠けている機能も観測値として残す。`after` は次を検査する。

1. LUT カードの `img` が `presets/luts/<id>/preview.webp` を表示し、読み込み済み。
2. トランジションのカードに `preview.webp` の 3 コマ帯があり、ホバー中は `preview-strip.webp` の 5 コマ帯を CSS `steps` で再生する。`prefers-reduced-motion: reduce` では 3 コマで静止する。
3. ホームの詳細に「文字の見た目」の 1 行があり、押すと 1 ページの「スタイル / 動き / フォント」の 3 節が見える。フォントは実数 31 件で、各カードが読み込み済み `img` または文字の代替表示を持つ。`catalog/font/<id>/preview.png` のある 18 件は必ずその画像が読み込まれている。
4. 一時プロジェクトの `captions.json` に文字を 1 行置き、`akari.annotations.open` でタイムラインを開く。`akari.timeline.seek` で 1 秒に進め、その文字の帯をクリックして選択する。フォントカードの右クリック「選択中に当てる」を実行し、**該当行**の `text_style.font_family` の変更を確認する。`edit.json` はこの字幕ファイルを参照する。
5. テキストアニメのカードの見本文字がホバーで `element.animate` を再生し、`getAnimations().length > 0` になる。
6. ホーム、詳細を開いた状態、「文字の見た目」のページでライブラリ全体の `textContent` を記録する。「スタンプ」は各画面で 0 件、ホームと詳細には「イラスト」がある。

撮影はホーム、ホーム詳細、LUT、トランジションのホバー、「文字の見た目」の上端・動き・フォントの各節、テキストアニメのホバー、適用後のプレビューを含む。撮影前に画面上の絶対パスを伏せる。

## 次の実装で付けるセレクタ

| 対象 | 属性 |
|---|---|
| LUT の絵 | `[data-akari-lut-preview] img` を既存 `[data-akari-catalog-preset-item="lut/<id>"]` の中に置く |
| トランジションの帯 | 既存 `[data-akari-library-transition="<id>"]` の中に `[data-akari-transition-strip] > [data-akari-transition-frame]` を 3 個、ホバー用に `[data-akari-transition-hover-strip]` を置く |
| 文字の棚 | ホーム `[data-akari-library-details]` に `[data-akari-library-text-look-row]` を 1 行。ページ `[data-akari-library-text-look-page]` の中に `[data-akari-text-look-section="style"]`、`motion`、`font` を順に置く |
| フォント | 各カードに `[data-akari-font-card="<id>"]`。見本があれば `img`、無ければ `[data-akari-font-fallback]` |
| テキストアニメ | 既存 `[data-akari-catalog-preset-item="textanim/<id>"]` の見本文字に `[data-akari-textanim-sample]` を付ける |
| 適用メニュー | フォントカードの右クリックで既存 `[data-akari-context-menu] [data-akari-context-item="apply"]` を使う |

`stamps` はデータのカテゴリキーのままにして、ホームタイルと詳細の画面語だけを「イラスト」にする。スクリプトは build と Electron 起動の前提となる重い枠の取得を行わないため、実行するラッパーが共通運用の枠を管理する。

当初の契約はフォント 32 件だったが、参照カタログの実数は `meta.json` が 31 件、`preview.png` が 18 件。見本の無い 13 件のうち 6 件は別の `previewUrl` の画像を表示し、残りは文字で代替表示する。L1 は `catalog/font` の画像・その他の画像・代替表示の出どころをそれぞれ記録する。
