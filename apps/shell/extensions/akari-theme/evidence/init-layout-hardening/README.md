# evidence/init-layout-hardening — L1 実機観測（2026-09-08）

タスク `2026-09-08-init-layout-hardening`（`onDidInitializeLayout` の横断硬化）の
L1（Electron + CDP 実機観測）の記録。**コードとテストの編集は codex、検証・計測・
本ディレクトリの作成はラッパー（Claude）**。

## 着手前の読解 — `onDidInitializeLayout` を実装する 8 箇所

Theia 1.73.1 の `FrontendApplication.initializeLayout()` は、これらを
**try/catch も timeout も無しに直列 await** する。1 つが reject すれば起動が止まり、
1 つが返ってこなければ永遠にローディングのままになる。

| # | ファイル | await していたもの | 失敗時の扱い（BEFORE） | 所要の見込み |
|---|---|---|---|---|
| 1 | `akari-annotations/…/akari-annotations-contribution.ts` | なし（同期） | 同期例外がそのまま Theia へ伝播 | 同期・数 ms |
| 2 | `akari-partner/…/akari-partner-contribution.ts` | storage 読取 → widget 生成 → 端末復元 | 伝播 | **上限なし**（端末復元次第） |
| 3 | `akari-shell-strip/…/akari-activity-bar-curation.ts` | なし（同期） | 伝播 | 同期・数 ms |
| 4 | `akari-shell-strip/…/akari-bottom-panel-curation.ts` | `shell.closeWidget()` | 伝播 | **上限なし** |
| 5 | `akari-shell-strip/…/akari-right-panel-curation.ts` | なし（同期） | 伝播 | 同期・数 ms |
| 6 | `akari-surfaces/…/akari-home-contribution.ts` | widget 生成 → **`widget.start()`** → activate | 伝播 | **上限なし**（実測 3.5 秒・フレーク 1 回観測） |
| 7 | `akari-theme/…/akari-shell-card-layout.ts` | なし（同期） | 伝播 | 同期・数 ms |
| 8 | `akari-transcript/…/daihon/akari-daihon-contribution.ts` | 台本 / カットの生成・attach | 既に try/catch + `configure` は fire-and-forget | 生成待ちは上限なし |

> 契約が挙げていた 9 ファイルのうち `akari-menu-contribution.ts`（`onStart` のみ）と
> `akari-home-widget.tsx`（コメントで言及しているだけ）は `onDidInitializeLayout` を
> 実装していない。代わりに一覧に無い `akari-bottom-panel-curation.ts` が実装していたため、
> 「実装している全箇所」= 上の 8 箇所を対象にした。

AFTER はこの 8 箇所すべてを `guardInitLayout(name, fn, { timeoutMs = 2000 })`
（`akari-theme/src/browser/init-layout-guard.ts`）で包み、home は
`widget.start()` の await をやめて attach → activate を先に済ませ、start を
fire-and-forget にした。

## 走らせ方

```sh
cd apps/shell && npm run build     # build:ext + theia build --mode production + postbuild(resign-electron)
# ワークスペースは templates/project-default のコピー（/tmp）。第 1 引数 '-' でワークスペース無し
node run-l1.mjs <ワークスペース絶対パス|-> <ラベル> <CDP ポート> <出力ディレクトリ>
```

`run-l1.mjs`（ラッパーが検証用に書いたハーネス。製品コードではない）は
`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` に
`<apps/shell> [<ワークスペース>] --remote-debugging-port=<port> --user-data-dir=<一時> --no-sandbox`
を渡して起動し、`playwright-core` の `chromium.connectOverCDP()` でアタッチする。
`HOME` / `THEIA_CONFIG_DIR` / `AKARI_HOME` / `AKARI_CREDENTIALS_FILE` はすべて毎回の
一時プロファイルへ向けているので、実利用の `~/.theia` / `~/.akari` /
`~/.config/akari-video` は読み書きしていない。`readyMs` は **プロセス spawn から
起動ログに `to 'ready'` が現れるまで**の実測ミリ秒。計測後に Electron を SIGKILL し、
孤児（ppid=1）が残っていないことを `ps` で確認済み。

> `npm run build` の `postbuild`（`resign-electron.mjs`）を飛ばして `theia build` だけ実行すると
> Electron の署名が壊れたままで起動が exit 134 になる。必ず `npm run build` で通すこと。

## 3 シナリオ

| ラベル | 内容 |
|---|---|
| `valid` | `templates/project-default` のコピー + 妥当な `edit.json` |
| `broken` | 同上だが `edit.json` が途中で切れた壊れた JSON |
| `nows` | ワークスペース引数なし + 空の隔離 `THEIA_CONFIG_DIR`（＝復元するワークスペースが無い） |

## 実測 — BEFORE（main 2c1603f3）/ AFTER（本ブランチ）

**同一マシン上の他プロセス負荷でドリフトするため、A/B を交互に実行**した
（`lib` / `src-gen` の 2 つのビルド成果物を退避しておき、1 回ごとに入れ替える）。
`ab<N>-<before|after>-<シナリオ>` が交互実行の記録。

| 反復 | シナリオ | BEFORE `readyMs` | AFTER `readyMs` | 差 |
|---|---|---:|---:|---:|
| 1 | valid | 12560 | 8620 | −31.4% |
| 1 | broken | 8865 | 7842 | −11.5% |
| 1 | nows | 8064 | 5660 | −29.8% |
| 2 | valid | 7334 | 6101 | −16.8% |
| 2 | broken | 6595 | 5399 | −18.1% |
| 2 | nows | 5809 | 5422 | −6.7% |
| 3 | valid | 7437 | 6458 | −13.2% |
| 3 | broken | 7570 | 6343 | −16.2% |
| 3 | nows | 5999 | 5660 | −5.7% |

中央値: valid 7437 → 6458（**−13.2%**）/ broken 7570 → 6343（**−16.2%**）/
nows 5999 → 5660（**−5.7%**）。**9 組すべてで AFTER が BEFORE 以下**であり、
受け入れ条件「AFTER の起動所要が BEFORE より悪化しない（±10% 以内）」を満たす。

- **BEFORE / AFTER とも 3 シナリオすべてで `ready` 到達**（`reachedReady: true`・
  `preloadVisible: false`・`Failed to start the frontend application.` は 0 件）
- AFTER では **3 シナリオすべてで guard が実際に発火**している:
  `[akari-surfaces] layout initialization timed out after 2000ms; continuing in background`。
  home（widget 生成 + activate）が 2 秒を超えてもレイアウト初期化はそこで打ち切られて
  先へ進み、home 自体は打ち切られずに続行して attach される（`homeAttached: true`）。
  これが本タスクの狙い — **重い拡張が layout を待たせない**という構造保証の実機証拠
- AFTER でも 4 タブ（パートナーを追加 / 台本 / カット / 注釈）・home・注釈パネルは
  BEFORE と同じく全て attach 済み（`measurements-ab3-after-*.json` 参照）

### ドリフトの記録（交互実行を採った理由）

先に AFTER を 4 回連続 → その後 BEFORE を 4 回連続、という順次実行で測ったところ
AFTER が約 2 倍遅く見えた（`measurements-after-*.json` / `measurements-before-*.json`）。
交互実行に切り替えると同じビルドで逆転したため、**この差はビルドではなく
計測時間帯のマシン負荷**（同一マシンの別 worktree で走っていた Electron を含む）である。
順次実行の生データも比較のため残してある。

## ファイル

| ファイル | 何を示すか |
|---|---|
| `run-l1.mjs` | 上記を再現するハーネス（検証専用・製品コードではない） |
| `measurements/measurements-ab<1-3>-<before\|after>-<シナリオ>.json` | **交互 A/B の実測**（`readyMs` / `reachedReady` / タブ・widget の attach 状態 / guard の警告） |
| `measurements/measurements-<before\|after>-<シナリオ>-r<1-4>.json` | 順次実行の生データ（上記「ドリフトの記録」） |
| `ab3-<before\|after>-<シナリオ>.png` | 交互 A/B 反復 3 のスクリーンショット |
| `ab3-<before\|after>-<シナリオ>-log.txt` | 同上の起動ログ（リポの `.gitignore` が `*.log` を弾くため拡張子は `.txt`） |
