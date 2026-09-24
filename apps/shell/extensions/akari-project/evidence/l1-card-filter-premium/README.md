# ライブラリのカード（顔 + 名前 + ⋯）・情報カード・ライセンスの窓・右クリック・フィルター・促しのシート — L1 証跡

## 採取方法

- `apps/shell` を `npm run build` した開発ビルドの Electron を `run-l1.mjs` が直接起動する（`node run-l1.mjs before|after`）。
  `HOME` / `AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` / ライブラリの置き場 / カタログは一時ディレクトリ（名前に `libcanvas-l1` を含む）。CDP ポート 9544
- fixture（`run-l1.mjs` の `fixture()`）:
  - 置き場の素材 5 件 = 画像 2（自分の / 素材サイト CC0）・SFX（自分の）・BGM（素材サイト CC BY 4.0・CREDIT.txt あり）・B-roll（素材サイト CC BY-NC 4.0）
  - カタログ 3 件 = Lab のプレミアム 2（画像 ¥2,980 / BGM ¥1,480・未購入 = locked）・Lab の無料 1（未取得）
  - マイスタイル 1 件（オレンジの見出し）。リポ同梱の `catalog/`（ローカル索引）も一緒に並ぶ
- 画面は 1280×800・左パネル幅 360。全体のスクリーンショットでは、ホーム画面のプロジェクトの場所の表示を `…/project` に置き換えてから撮った（ローカルの絶対パスを残さないため）。
  `before/dots-menu.png` と `before/right-click-menu.png` は同じ理由で上 330px に切り詰めた
- 暗い・明るいのテーマ切り替えは ThemeService の `setCurrentTheme`（通常の設定経路）

## BEFORE（変更前 b76f1275 相当のカード）

| 記録 | 観測 |
|---|---|
| `before/cards-image.png` ほか | カードにカテゴリ文字・タグ・`licenseSpdx`・＋・使う・¥価格バッジ。プレミアムは `¥2,980` のボタンでドラッグ不可（`draggable=false`） |
| `before/dots-menu.png` / `right-click-menu.png` | ⋯ は置き場の素材だけ（4 件中 2 件）・項目は「Finder で場所を見る / ライブラリから消す」の 2 つ。プレミアムの右クリックは何も出ない |
| `before/mystyle.png` | マイスタイルは 1 列の大きなカード + 部品の札 + 4 つの操作ボタン |
| `before/observations.json` の `sourceRow` | 検索の上に出どころの 1 行（全部 / 自分の / 素材サイト / Lab） |

## AFTER（`after/observations.json` の実測）

| 観測 | 記録 | 結果 |
|---|---|---|
| カード | `cards-image.png` / `cards-bgm.png` / `cards-broll.png` / `list-image.png` / `cardChecks` | 4 件とも本文は名前だけ（ライセンス・タグ・回数・＋・使う・¥ なし）・全件に ⋯。王冠はプレミアムの 1 件だけ。取得状態の印 = cached 2 / remote 1。出どころの 1 行は 0 件 |
| ⋯ = 情報カード | `info-card.png` / `infoCard` / `infoKeywordsAll` | 周りを暗くして押したカードだけ残す（spotlight 1）。名前・作成元・「この作成元の素材をもっと見る」・無料 + ⓘ・ライセンス名・キーワード 5 個 → すべて表示で 7 個・操作の入口（プレイヘッドに置く / 取り込むだけ / ★） |
| ⓘ = ライセンスの窓 | `license-dialog.png` / `licenseDialog` / `creditCopied` | CC BY の BGM:「クレジットを書けば使えます」+ ✓ / ! / ✓ の箇条 + 詳しくはこちら + クレジットをコピー（クリップボード = CREDIT.txt の 1 行） |
| 右クリック = 操作のメニュー | `right-click-menu*.png` / `menuPlaceable` / `menuPremium` / `menuLabFree` / `menuMyStyle` / `menuTextStyle` | 置き場の素材 6 項目・プレミアム「Lab で見る（¥2,980）/ プレイヘッドに置く / ★ / 情報を見る」・マイスタイル 6 項目・テキストスタイル 3 項目 |
| ★ | `favoriteSaved` | 右クリックの ★ で `AKARI_HOME/library-favorites.json` に key が入る |
| フィルター | `filter-popover.png` / `filterPremium` / `filterCommercialCached` / `filterBadge` / `filterFavorite` / `filterFavoriteOwn` | 料金 › プレミアム = 1 件 / 商用 OK × 取得済み = 1 件・件数の座布団 2 / 状態 › ★ = 1 件 / ★ × 自分の = 0 件 |
| 促しのシート | `premium-prompt.png` / `premiumPrompt` / `premiumNotPlaced` / `premiumPromptByCommand` | プレミアムを「プレイヘッドに置く」→ シート・edit.json は不変。コマンド `akari.library.showPremiumPrompt` からも同じシート |
| プレミアムのドラッグ | `premiumDragPayload` | `draggable=true`・dragstart のミラーの payload に `locked: true, price: 2980` |
| 明るいテーマ | `*-light.png` | カード・情報カード・ライセンスの窓・右クリック・フィルター・促しのシート・マイスタイル |

受け口（タイムライン / プレビュー）で locked の payload を促しのシートへ分岐するのは別票。本票はドラッグが始まり payload に locked が載るまで。
