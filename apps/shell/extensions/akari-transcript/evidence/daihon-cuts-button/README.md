# evidence/daihon-cuts-button — 台本パネル「カット候補へ（n / m）」ボタンの L1 実測

task `2026-09-08-cuts-default-off-and-daihon-button` 指示 4（L1: ボタンの SS と
押下後にカットタブが前面の SS）の証跡。Electron + CDP（playwright-core `connectOverCDP`）で
実機観測した。ハーネス = `run-l1.mjs`（ラッパー所掌の検証専用スクリプト。製品ソースではない）。

## 走らせ方

```sh
# リポジトリ root で apps/shell をビルド済みにしておく（npm run build:ext && theia build）
AKARI_L1_OUT=/tmp/akari-l1-cuts-out \
  node apps/shell/extensions/akari-transcript/evidence/daihon-cuts-button/run-l1.mjs after 21995
```

ハーネスは隔離ワークスペースを自前で `mkdtemp` して組む（`templates/project-default` を複製し、
`edit.json` / `captions.json` / `.akari/sidecars/assets/take-01.mp4.analysis/cuts.json` を置く）。
`HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` はすべて一時プロファイル配下へ向けてあり、
実利用の `~/.theia` `~/.akari` `~/.config/akari-video` は読み書きしない。

fixture の `cuts.json` は 22 件の候補（`default_on` は**全部 false** — 本タスクの新既定）を持ち、
先頭 n 件だけ `on: true`。

## 実測（AFTER）

`measurements-after.json` の `steps[]` がそのまま観測値。

| 手順 | 観測 | 値 |
|---|---|---|
| ① 台本タブを前面 | `.akari-daihon-cuts` の textContent | **`カット候補へ（3 / 22）`** |
| | ヘッダの並び | `title, count, spacer, theia-button(字幕を作る), tpl, qc, silence, **cuts**` |
| | `currentRightTab` | `akari-daihon-widget` |
| ② ボタンを実クリック | `currentRightTab` | `akari-daihon-widget` → **`akari-cuts-widget`** |
| | カットパネル `[data-akari-cuts]` の可視 | `false` → **`true`**（台本は `true` → `false`） |
| ③ `cuts.json` を外から書き換え（ON 3 → 7） | ボタンの textContent | `カット候補へ（3 / 22）` → **`カット候補へ（7 / 22）`** |

- ①③ のクロップ: `after-01-daihon-header-crop.png` / `after-03-label-updated-crop.png`
- ② のクロップ（右ドック）: `after-02-cuts-front-crop.png` — 「カット」タブが前面、
  fixture の ON 3 件にチェックが入り、フッタが「切る 3 箇所・短くなる 1.2 秒」
- 全画面: `after-01-daihon-header.png` / `after-02-cuts-front.png` / `after-03-label-updated.png`
- 起動ログ: `after-log.txt`（`reachedReady: true` / `failedToStart: false`）

BEFORE は撮っていない（このボタンは新規追加で、変更前は `.akari-daihon-cuts` が DOM に
存在しないことが自明なため）。

## 地雷（このハーネスで踏んだもの）

1. **タブをクリックした直後の Theia ホバー（`div[popover="hint"]`）が右ドックの上に残り、
   直後のボタンクリックを横取りする**（`elementHandle.click` が
   「intercepts pointer events」で 8 秒タイムアウト）。ポインタを画面左へ逃がして
   2.5 秒待ってからボタンを押す（`away()`）。
2. **`captions.json` は `edited` / `speaker` / `sourceRef` が揃っていないと 1 行も出ない**
   （`normalizeCaption` が undefined を返し「N 番目の字幕は時刻または内容が不正なため
   表示しません」になる）。fixture では `speaker: null, sourceRef: null, edited: false,
   time_domain: 'source'` まで書く。
3. `.akari/sidecars/` 配下の `cuts.json` はワークスペース再帰 watch で拾える
   （③ が実測。台本側の `onDidFilesChange` は `base === 'cuts.json'` を relevant に含む）。

機械固有パスは `<WORKTREE>` / `<SCRATCH-WS>` / `<SCRATCH-PROFILE>` / `<TMP>` / `<HOME>` へ置換済み。
