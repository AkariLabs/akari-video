# evidence: small-cleanup（パートナーを「開くだけ」/ 中央寄せモジュール撤去 / `akari.catalog.root` の設定掲載）

L1（実機 Electron + CDP）の証跡。ハーネスは検証専用でプロダクトコードではない。

## 走らせ方

```bash
cd apps/shell && npm run build     # theia build --mode production + postbuild の再署名まで
node extensions/akari-shell-strip/evidence/small-cleanup/run-l1.mjs <ワークスペース絶対パス> after 21998 <出力ディレクトリ>
echo $?   # 0 = 全チェック PASS / 2 = どれかが FAIL
```

`HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` / `AKARI_HOME` / `AKARI_CREDENTIALS_FILE` は
毎回 `mkdtemp` の使い捨てプロファイルへ向ける（実利用の `~/.theia` `~/.akari`
`~/.config/akari-video` は読み書きしない）。Electron は detached にせず、計測後に PID 指名で kill する。
ログ・計測 JSON の絶対パスは `<WORKTREE>` `<HOME>` `<TMP>` `<WORKSPACE>` へ置換して書き出す。

## 何を測るか

| # | チェック | 中身 |
|---|---|---|
| 1 | `menu-has-partner-row` | 左「メニュー」の「ひらく」に「パートナー」行がある |
| 2 | `partner-tab-front-after-row-click` | その行を実マウスで押すと右ドックの前面が「パートナーを追加」になる |
| 3 | `onboarding-unchanged-after-row-click` | 押す前後で onboarding の状態が変わらない（`data-akari-flow-state` / `.dialogOverlay` の数 / `.dialogTitle` / CLI ターミナルタブの 4 点を同じ関数で採る） |
| 4 | `settings-tools-has-catalog-root-row` | 設定「道具」ページに `akari.catalog.root` のパス入力行（`aria-label` = カタログの素材フォルダ）がある |
| 5 | `settings-tools-has-folder-picker` | 同じページに「フォルダを選ぶ」ボタンがある |
| 6 | `catalog-row-not-covered-by-install-bar` | 一番下までスクロールした状態（sticky bar が実際に貼り付く最悪ケース）で、「選んだ道具をインストール」行とカタログ行の**縦の重なりが 0px**、かつラベル中心の `elementFromPoint` がラベル自身を返す |
| 7 | `begin-onboarding-does-change-state` | 対照。`akari.partner.beginOnboarding` を直接実行すると 3 と同じ観測点が確かに変わる（観測点が鈍感でないことの証明） |

## 実測（2026-09-09・production ビルド）

| 観測点 | 行を押す前 | 行を押した後 | 対照: `beginOnboarding` 実行後 |
|---|---|---|---|
| 右ドック前面タブ | 注釈 | **パートナーを追加** | パートナーを追加 |
| `data-akari-flow-state` | null | **null** | `working` |
| 開いているダイアログ数 | 0 | **0** | 1 |
| ダイアログ名 | （なし） | **（なし）** | `Claude Code CLI へ接続` |
| CLI ターミナルタブ | （なし） | **（なし）** | （なし） |

設定「道具」ページ（スクロール最下部・`scrollTop 476.5 / scrollHeight 1066 / clientHeight 590`）:

| 要素 | 矩形 |
|---|---|
| 「選んだ道具をインストール」行 | x 241 / y 490 / w 820 / h 67 |
| カタログのラベル | x 261 / y 569 / w 302 / h 15 |
| カタログの入力欄 | x 407 / y 561 / w 156 / h 30 |
| 縦の重なり | ラベル **0px** / 入力欄 **0px** |
| ラベル中心の `elementFromPoint` | `LABEL:カタログの素材フォルダ` |

`reachedReady: true` / `failedToStart: false`。全 7 チェック PASS（exit 0）。

## ファイル

| ファイル | 中身 |
|---|---|
| `run-l1.mjs` | ハーネス本体 |
| `measurements-after.json` | 上表の生データ（起動タイムライン・行一覧・矩形込み） |
| `after-log.txt` | Electron の起動ログ（パス置換済み） |
| `after-01-before-click.png` | 「パートナー」行を押す前（右ドック前面 = 注釈） |
| `after-02-menu.png` | 左「メニュー」の「ひらく」9 行 + ブラウザプレビュー |
| `after-03-after-click.png` | 行を押した直後（前面 = パートナーを追加・ダイアログ 0） |
| `after-04-settings-tools.png` | 設定ダイアログ「道具」ページ全体 |
| `after-04-settings-tools-section.png` | 同ページのカタログ行の一次証拠（切り出し） |
| `after-05-after-begin-onboarding.png` | 対照。`beginOnboarding` で接続ダイアログが出た状態 |

## ハマりどころ

- 道具チェックが揃うとページが伸び、カタログ行が折り返して画面外へ落ちる。矩形を測る前に
  `#akari-settings-tools` を最下部までスクロールすること（スクロールしないと
  `elementFromPoint` が viewport 外で `null` を返し、重なりの有無も判定できない）。
- `createActions(true)`（道具パネル下部の「選んだ道具をインストール」行）は
  `position: sticky; bottom: 0; z-index: 2; margin-bottom: -20px` + 不透明背景。
  この行より後ろに素の要素を append すると 20px 引き上げられて下に潜る（初回計測で実際に発生した）。
  カタログ行は `marginTop: 24px` + `position: relative` + `zIndex: 3` のブロックに包んで避けている。
- Lumino の `TabBar` は `mousedown` で切り替わるので `element.click()` では反応しない。実マウスクリックを使う。
