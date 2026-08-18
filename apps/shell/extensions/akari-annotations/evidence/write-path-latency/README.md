# evidence: write-path-latency（編集操作の臨界経路から lint 子プロセス・git commit・二重 reload を外す）

task `2026-08-18-shell-write-path-latency` の L1 実測記録。**codex ラッパーレーンのラッパー自身が
計測・検証した**（実装は codex、計測スクリプトと実測はラッパー所掌）。

## 計測の定義

`scripts/measure-move-latency.mjs`（生 CDP・依存ゼロ。`../../timeline-tracks/scripts/cdp-lib.mjs` を再利用）が
実マウスイベント（`Input.dispatchMouseEvent`）でタイムライン上のクリップを水平に 140px ドラッグし、
次の 4 点をレンダラ内で測る。

| 指標 | 定義 |
|---|---|
| `t0` | 実 pointerup がレンダラへ配送された瞬間（`window` の capture リスナで採取） |
| `domMs` | 当該クリップ要素の `style.left` が変わったのを検出した rAF |
| `paintMs` | その次の rAF（= 変更後フレームの描画完了時点）。**受け入れ条件「150ms 未満」の値** |
| `settleMs` | strip への DOM 変異が 700ms 途切れるまで（保存後の後段処理まで含む総鎮静時間） |

各 run は `edit.json` の `cuts[0].at` が実際に変わったことをファイル側でも確認している
（`editBefore` / `editAfter`）。方向は run ごとに反転させ、画面外へ流れないようにしている。

## 環境

- BEFORE = merge-base `7bdd84da` の tree を `git archive` で取り出した独立ツリーを
  `npm run build`（production・browser/node/electron とも 0 errors）したもの
- AFTER = 本ブランチの worktree を同じ `npm run build` したもの
- どちらも隔離 `--user-data-dir` + `THEIA_CONFIG_DIR` + `--no-sandbox` で Electron を直接起動
  （`verify` スキル L1 の手順）
- ワークスペースは実プロジェクト `fieldtest/2026-08-12-vision-v0-firstrun`（273MB・120MB の実撮素材つき）
  の**コピー**を毎回作り直し、scaffold と同じく `git init` + 初回コミット済みにしてから使う
  （契約の真因 §2「scaffold が必ず git init するので commit 経路が常に発火する」を再現するため）
- 導線はホーム画面の「編集データ（edit.json）」カードのダブルクリック。これでプレビュー webview と
  タイムラインの両方が開くので、オーナー実機と同じ構成になる

## 実測値（pointerup → 描画完了, ms）

| パス | BEFORE (7bdd84da) | AFTER (本ブランチ) |
|---|---|---|
| cold pass（開いた直後の 5 回） | min 652.3 / **median 1058.6** / max 1696.1 | min 35.0 / **median 64.8** / max 216.7 |
| warm pass（続けて 8 回） | min 583.4 / **median 617.5** / max 768.3 | min 48.0 / **median 51.3** / max 114.9 |
| `settleMs`（warm median） | 736.4 | 30.7 |
| 13 回の移動で作られた git コミット | **13**（`クリップを移動` ×13） | **0** |

- 生ログ: `before-cold-5runs.json` / `before-warm-8runs.json` /
  `after-cold-5runs.json` / `after-warm-8runs.json` / `after-cold-5runs-session2.json`
- AFTER は合計 21 run のうち **20 run が 150ms 未満**。150ms を超えたのは
  「アプリ起動後の最初の 1 回」だけ（session1 = 216.7ms）。同じ条件の別セッション（session2）では
  最初の 1 回も 112.1ms で、2 回目以降は 35〜60ms に落ち着く
- 参考: この実プロジェクトに対する `edit-lint` CLI 単発の所要は 0.374s。AFTER の median 51.3ms は
  lint 1 本の所要より短い = lint が臨界経路に居ないことが時間の側からも確認できる

## lint 子プロセス・git commit が経路から消えていることの確認

- `packages/edit-store/src/write-gate.ts` と生成済み `lib/write-gate.js` に
  `execFile` / `spawn` / `child_process` が**一つも残っていない**（静的確認）。
  lint はプロセス内 `lintProject()` の動的 import 実行になった
- `commitIfOwnRoot` の呼び出しは 2 箇所（注釈作成 = 承認ゲート記録 / キャンバス記録）だけになり、
  どちらも `git add -- <契約ファイル>` のパス明示。編集 RPC 側 `commitWrite` は `false` を返す no-op
- 上表「13 回の移動で作られた git コミット」= BEFORE 13 / AFTER 0 が同じことを実測側から示す

## lint error 時の警告 + 巻き戻し（受け入れ条件）

`scripts/check-lint-warning.mjs`。外部書き込みで `source.path` を実在しないパスへ変え
（= `references.files` が severity error）、その状態で通常のクリップ移動を 1 回行う。結果は
`lint-warning-and-undo.json`:

- フッター: `保存後の検証で問題が見つかりました: [references.files] source.path does not resolve to a regular file`
- 巻き戻し導線: ボタン「直前の編集を元に戻す」が**有効**で表示される
- そのボタンを押すと `cuts[0].at` が 13.5 → 0（移動前の位置）へ戻る
- 判定: **PASS**（`warningShown` / `undoAffordanceShown` / `moveApplied` / `undoRestored` すべて true）

## 保存バイト等価（受け入れ条件）

`scripts/byte-equivalence.mjs`（出力 `byte-equivalence.txt`）。merge-base の
`packages/edit-store/lib/edit-store.js` と本ブランチのそれを同一プロセスへ読み込み、
実プロジェクトの `edit.json` と宣言済みトラックつき fixture に対して

- prune なしの移動 4 ケース + `trackState` つき 1 ケース: 旧 `moveCutInSource` と
  新 `moveCutAndPruneTracksInSource(..., [])` の全文が**バイト一致**
- prune ありの移動: 旧経路（移動を書く → reload → 空宣言を消す、書き込み 2 回）と
  新経路（1 回の書き込みへ畳む）の最終全文が**バイト一致**
- prune 要求されたトラックがまだ使用中なら消さない（旧経路と一致・`prunedTracks` は undefined）

計 7 ケース **BYTE-EQUIVALENCE: PASS**。

## 再現コマンド

```sh
# 1) production ビルドの Electron を隔離起動
cd apps/shell
THEIA_CONFIG_DIR=<iso> node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  <apps/shell 絶対パス> <プロジェクトコピー絶対パス> \
  --remote-debugging-port=9338 --user-data-dir=<iso> --no-sandbox

# 2) 遅延計測（cold 5 回 → 続けて warm 8 回）
node apps/shell/extensions/akari-annotations/evidence/write-path-latency/scripts/measure-move-latency.mjs \
  9338 <プロジェクトコピー> <出力.json> --runs 5

# 3) lint error 時の警告 + 巻き戻し
node apps/shell/extensions/akari-annotations/evidence/write-path-latency/scripts/check-lint-warning.mjs \
  9338 <プロジェクトコピー> <出力.json>

# 4) 保存バイト等価（旧 lib と新 lib を並べて比較）
node .../scripts/byte-equivalence.mjs <旧 lib/edit-store.js> <新 lib/edit-store.js> <実 edit.json>
```

## 計測中に踏んだ実地の教訓

- **worktree の `node_modules` が元リポへの symlink だと、`@akari-video/*` は元リポの
  `packages/` へ解決される**（`node_modules -> ../../akari-video/node_modules`。この worktree 群の既定配置）。
  この状態では shell を起動しても *worktree 側の* edit-store / edit-lint は一切走らず、
  before/after の比較が成立しない。本タスクでは `node_modules` と `apps/shell/node_modules` を
  worktree ローカルの実ディレクトリ（APFS clonefile コピー）へ差し替えてから計測した。
  最初の計測はこれに気づく前のもので、元リポ側の未コミット edit-lint を叩いていたため
  6.2〜8.6 秒という別物の数字が出ていた（本 README の表からは除外している）
- タイムラインはコマンドパレット（F1 →「タイムラインを開く」）では開かないことがある。
  ホーム画面の edit.json カードのダブルクリックが確実で、かつプレビュー webview も一緒に開くので
  実機構成に近い
