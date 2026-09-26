# ライブラリの 2 枚重ねカード — L1 実機観測の証跡

タスク: `2026-09-27-library-tile-cards`（検証票）
対象コミット: `f373fe33`（2 枚重ねカード）/ `9cc4bba5`（素材パネルの修正）
手触りの正本: 内部リポの検収済みモック（第 5 稿・2026-09-27 オーナー検収）

実機（Electron + CDP）を隔離ワークスペースで起動し、computed style を数値で読み、
画面を撮って確かめた記録。再現手順は `run-l1.mjs` / `run-regression.mjs` の冒頭コメント。

## L0（基準線・実測）

| 項目 | 結果 |
|---|---|
| `npm run build:ext`（tsc -b・11 拡張） | exit 0 |
| `npm run lint`（eslint） | exit 0 / **0 errors**・1 warning（`akari-companion` の既存 `_ignored`・本件と無関係） |
| `extensions/akari-project` の `npm test` | exit 0 / **tests 675・pass 675・fail 0**・duration 7064ms |
| `npm run build`（theia build --mode production） | exit 0 / 約 11 秒 |

## L1 で数えたこと（`measurements.json` が全文）

台座の transform は computed の行列から角度・拡大・平行移動へ分解した値。
`tx` は `translateX` の % を px へ解決したものなので、カードの一辺（幅 400px のパネルで 90.83px）で割って % に戻せる。

| 見るもの | 期待（モック） | 実測 |
|---|---|---|
| 裏 `.akari-tile-back` 平常 | `translateX(6%) rotate(4deg) scale(.93)` | `rotate 4.000°` / `scale 0.9300` / `tx 5.450px` = 6.00% |
| 裏 `.akari-tile-back` ホバー | `translateX(18%) rotate(15deg) scale(.9)` | `rotate 15.000°` / `scale 0.9000` / `tx 16.349px` = 18.00% |
| 表 `.akari-tile-front` 平常 | 変形なし | `transform: none` |
| 表 `.akari-tile-front` ホバー | `rotate(-11deg)` | `rotate -11.000°` / `scale 1.0000` |
| `transition-property` | transform を含む | `transform, box-shadow` |
| 所要 | 320ms 前後 | `0.32s`（box-shadow は `0.3s`） |
| 曲線 | `cubic-bezier(0.32, 0.72, 0, 1)` | `cubic-bezier(0.32, 0.72, 0, 1)` |
| `prefers-reduced-motion: reduce` | 実質無効 | `transition-duration: 1e-05s`（= 0.01ms）。表裏とも開き切った値（15° / -11°）へ即座に到達 |
| タイル数・並び | 16 枚・`LIBRARY_PRIMARY_TILES` の宣言順 | 16 枚。テキスト → 図形 → イラスト → 画像 → 動画 → BGM → SFX → オーバーレイ → 3D・アバター → LUT → トランジション → エフェクト → モーション → マイスタイル → ひな形 → セット |
| 段の区切り | `[data-akari-library-tile-rule]` が 3 本・見出しの文字 0 個 | 区切り 3 本 / 区切りの文字数 0 / **見出しの文字数 0** |
| 1 枚あたりの台座 | 裏 1 枚 + 表 1 枚 | 全 16 枚が `.akari-tile-back` 1・`.akari-tile-front` 1（台座は合計 32 枚） |
| SVG の `id` 重複 | 2 枚のあいだで重複しない | 重複 0 件（1 枚あたり 12〜18 個の id を持つが、どのタイルも衝突なし） |
| 近日タイル | ホバーに反応しない | 5 枚（イラスト・エフェクト・モーション・マイスタイル・ひな形）が `disabled`。ホバーしても裏 4.000° / 表 `none` のまま |

## L1 で見たこと（画像で判断）

- **裏のカードが沈んでいない**（第 4 稿が棄却された点）: 裏の外接矩形の中心 y は
  平常 `303.41px` / ホバー `303.41px` で **差 0.00px**（カードの一辺は 90.83px）。
  `04-tile-hover.png` でも高さが動かずに右へ開いている
- 音符（BGM）の符頭が符幹から離れていない → `09-art-bgm.png`
- エフェクトの玉と光条が重なってボヤけていない（中心の玉と 8 本の光条が離れている）→ `09-art-fx.png`
- 幅 164px でラベルが折れない・はみ出さない・横スクロールが出ない →
  16 枚すべて 1 行（折り返し 0）・タイルの幅から出る label 0・`scrollWidth 150 == clientWidth 150`。
  長いラベル 6 枚（オーバーレイ / 3D・アバター / トランジション / エフェクト / モーション / マイスタイル）は
  モックどおり `text-overflow: ellipsis` で省略される。幅 400px（`scrollWidth 385 == clientWidth 385`）では
  **省略 0 件・折り返し 0 件**

## 回帰（`regression.json` が全文）

| 確かめたこと | 実測 |
|---|---|
| テキストのタイル → プレイヘッドに文字 → Cmd+Z 1 手で戻る | キャプション 0 → 1 → **Cmd+Z 1 回で 0** |
| 画像のタイル → 一覧が開く | カタログ 161 件・パンくず「← ライブラリ / 画像 / 161」・戻るとホーム |
| BGM のタイル → 一覧が開く | カタログ 124 件・同上 |
| 近日は押せない | 5 枚とも `disabled` + `aria-disabled="true"`。押してもホームのまま |
| BGM カードのタイムラインへの D&D が 1 回通る | `audio/bgm-glitchpop-135` を投下 → 項目 `{cut:1}` → `{audio:1, cut:1}` |
| 詳細は「文字の見た目」「マイ」だけ・主要タイルと重複しない | 見出し 2 つちょうど。主要タイルのラベルと重なる行 0 件 |
| プロジェクト面が従来どおり | 素材カード 2 枚・「…」メニューが開く（「素材をまとめる…」）・Lint「1 件」 |

## 画像

| ファイル | 中身 |
|---|---|
| `00-window-default.png` | 既定幅のウィンドウ全体 |
| `01-library-home-default.png` | ライブラリ面のホーム全体（既定幅 = パネル 164.91px） |
| `02-tile-normal.png` | タイル 1 枚の平常（4 倍） |
| `03-tile-opening.png` | 開く途中（裏 13.454°→13.957°・表 -9.454°→-9.957°。CSS トランジションを 1/10 の速さで流して掴んだ） |
| `03b-tile-opening-late.png` | 開く途中の後半（裏 14.732°→14.839°） |
| `04-tile-hover.png` | 開いた状態（裏 15° / 表 -11°） |
| `05-library-home-hover.png` | ホバー中のホーム全体 |
| `06-width-164.png` | パネル幅 164px |
| `07-width-400.png` | パネル幅 400px |
| `08-reduced-motion.png` | `prefers-reduced-motion: reduce` をエミュレートした状態 |
| `09-art-text/bgm/sfx/fx/motion.png` | 絵の検分（4 倍） |
| `10-tiles-400.png` | 幅 400px のタイル全景 |
| `11-soon-hover.png` | 近日タイルにホバーしても開かない |
| `20-timeline-after-undo.png` | 文字を置いて Cmd+Z で戻したあとのタイムライン |
| `21-bgm-list.png` | BGM の一覧 |
| `22-timeline-after-bgm-drop.png` | BGM を D&D したあとのタイムライン |
| `23-library-details.png` | 詳細（文字の見た目 / マイ の 2 つだけ） |
| `24-project-face-menu.png` | プロジェクト面・「…」メニュー・Lint・タイムライン |
| `25-project-face.png` | プロジェクト面 |

## 申し送り（直していない差分）

1. **ラベルの字の大きさ**: モックは `font-size: 11.5px` 固定、実装は `font-size: .72em`（パネルの 13px 基準で
   実測 **9.36px**）。モックのパネルは 320 / 400px 幅で、実機の既定幅 164.91px より広い。
   実装値は周りのパネル文字（`.72em` / `.75em`）と揃っているので、意図した選択に見える。
   本票の手順 3〜5 の確認項目ではないため**変えていない**（勝手に値を変えない規律）。
   モックへ合わせるならオーナー裁定が要る
2. **ホームの下の余白**: モックの `.panel-body` は `padding: 2px 8px 16px`、実装の
   `[data-akari-library-home]` は `2px 8px 12px`（下 4px 少ない）。同じく手順 3〜5 の対象外
3. **詳細の「スタイル・動き・フォント」の行**（`LibraryTextLookRow`）は幅 164px で文字が
   縦に折れる（`23-library-details.png`）。主要タイルではなく本票のファイル境界の外なので触っていない
