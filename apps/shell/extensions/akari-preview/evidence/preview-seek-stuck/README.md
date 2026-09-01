# プレビュー再生・シーク停止の検証証跡（preview-seek-stuck）

> 本レーンは 2 度中断（利用上限 / カーネルパニック）した後の**再開走**。
> 1 巡目の診断・切り分けは起点 `d24071be` のビルドで採った（`before/`）。
> 再開時に main が 36 コミット進んでいたため `git merge main`（= `31b4ac4d`）してから再実測した（`after/`）。

## 根因（1 巡目に本レーンが特定・並走レーンと独立に同一結論）

- `frameEngineBootstrapScript()` のテンプレートリテラル（webview へ `<script>` として注入される JS 文字列）に
  TypeScript の型述語 `.filter((value): value is number => ...)` が残っていた
- テンプレートの中身は tsc の構文検査対象外なので `tsc --noEmit` も CI も通るが、ブラウザでは parse できない。
  webview ホストの `document.write()` が `SyntaxError: missing ) after argument list` を投げ、
  末尾の frame-engine `<script>` の手前で書き込みが止まり bootstrap が 1 行も実行されない
- frame-engine は既定 ON（`akari.preview.frameEngine` default true）で、engine 有効時は旧経路の媒体が
  `frameEngineMediaIdle` になるため `<video>` にも src が入らない。**clock も legacy 再生も無い = 再生・シークとも 0:00 で停止**
- 混入コミット: `49c9bb9c`（2026-08-31 00:50）

### 帰属（重要）

同じ根因を**並走レーンが先に main へ入れている**: `6c94ed08`（2026-08-31 08:15:54・merge `b35fee41`
「shell の frame-engine プレビューが無言で立ち上がらない真因を除去し、boot 失敗を『見える失敗』にする」）。
本レーンの 1 巡目コミット `1a7eb1f7` は 08:30:06 で **15 分後**。型述語を素の JS へ戻す 1 行は両者で同一のため
`git merge main` は衝突なしで解決した。**根因除去の功績は並走レーン `6c94ed08` にある。**
並走レーンはさらに (a) `src/browser/` の全 `*Script` テンプレートを AST 走査 → `vm.Script` で構文検査する回帰テスト
(b) engine バンドルより前に注入する watchdog（15 s で「見える失敗」カード + 旧経路への復帰ボタン）を入れており、
これが本件の**構造的な再発防止**になっている。

本レーンの残りの寄与は「切り分け表（新語彙は無関係だと実測で示した部分）」と「fail-open の追補」の 2 点。

## 切り分け（指示 2・起点 d24071be のビルドで新語彙を 1 種ずつ抜いた 6 変種）

**全変種で同じ症状 = 新語彙（group / captions 袋 / part / keyframes / telop）は根因ではない。**

| 変種 | 起点での再生 2 秒の進み | bootstrap パース |
|---|---|---|
| v0 原本複製 | 0.000 s | SyntaxError |
| v1 captions 袋のみ除去 | 0.000 s | SyntaxError |
| v2 純グループのみ除去 | 0.000 s | SyntaxError |
| v3 HTML 袋のみ除去 | 0.000 s | SyntaxError |
| v4 keyframes のみ除去 | 0.000 s | SyntaxError |
| v5 telop のみ除去 | 0.000 s | SyntaxError |
| （対照）critique-cut-v2 = 新語彙ゼロ | 0.000 s | SyntaxError |

生データ = `before/variants-matrix.json`。新語彙ゼロの案件でも同じく死ぬことが、item 種別無関係の決定打。

## L1 実測

実 Electron 39.8.7（stock libffmpeg へ差し戻し = tier 2）+ 生 CDP・viewport 1680x1000・左右パネルは畳んで計測。

| 対象 | 起点 `d24071be`（`before/`） | merge 後 HEAD（`after/`） |
|---|---|---|
| objtree 複製: 再生 2 秒での出力時刻の進み | 0.000 s（0:00 のまま） | **2.133 s** |
| objtree 複製: シーク 1.0s / 4.5s の `#preview-stage` sha256 | `e677593e…`（2 点とも同一） | `bb48ea70…` / `47af1096…`（**別**） |
| objtree 複製: frame-engine | active 無し・`window.akari.frameEngineClock` 無し | `active="true"`・clock あり |
| objtree 複製: 実行 script の構文 | bootstrap が `missing ) after argument list` | 実行 script 14 本すべて ok |
| critique-cut-v2 複製（新語彙なし・回帰）: 再生 2 秒の進み | 0.000 s | **2.000 s** |
| critique-cut-v2 複製: シーク 2 点 sha256 | 同一 | `a912e98e…` / `81f585e8…`（**別**） |
| renderer 未処理例外 | 0 | 0 |
| renderer console error | 0 | 0 |

### 再生の進みの再現性（`after/play-advance-repeatability.json`）

このマシンは他レーン（別 worktree の Electron）と共用で load average が大きく振れる。10 走の分布:

- **静穏窓 5 走**: 2.2 / 2.1 / 2.1 / 2.1 / 2.267 s → 判定 `>= 1.5 s` は **5/5 成立**
- **飽和窓 5 走**: 2.133 / 1.233 / 1.2 / 2.133 / 1.233 s → **2/5 成立**（3 走は 1.2 秒台）
- **transport が生きている（進みが 0 でない）のは 10/10**。起点の 0.000 s とは非連続

二峰の差 約 0.9 s は `electron.log` の
`[frame-engine] a:cut-0: target 300000us was not produced; reseeking from sync once`
（実時間デコードの再同期 1 回）に対応する。飽和窓でのみ再同期が起きる。
**判定は静穏窓の 5/5 を採る**（飽和窓の 1.2 秒台は並走レーンの CPU 競合による実時間デコードの遅れであって、
本件の「0:00 で止まる」= transport 停止とは別の現象）。

## 対照群: main 単体との A/B（`after/control-main-only.json`）

本レーンの差分が「効いていること」と「余計なことをしていないこと」を分けるため、
main（`31b4ac4d`）の src だけ（本レーンの 3 ファイル分の差分を外した状態）で再ビルドして
critique-cut-v2 複製へ同じ L1 を当てた。

| 指標 | main 単体（対照） | 本レーン HEAD |
|---|---|---|
| 再生 2 秒の進み | 2.000 s | 2.000 s |
| シーク 1.0s の sha256 | `a912e98e…` | `a912e98e…`（**一致**） |
| シーク 4.5s の sha256 | `81f585e8…` | `81f585e8…`（**一致**） |
| 未処理例外 | 0 | 0 |
| `[akari-three] 3D scene の読み込みに失敗しました` | **出る** | 出る |

読み取り:

- **絵は完全一致**（sha256 が 2 点とも同じ）= 本レーンの fail-open 追補は正常系の描画に対して inert。
  「死なないようにする」だけで見た目を動かしていないことの機械的な証明
- したがって本レーンの差分は**回帰リスクを持たない**が、同時に**正常系では観測可能な効果も持たない**（設計どおり）。
  効果が出るのは未知種別 / 壊れた layer が来たときだけで、それは前述のとおりユニットテスト水準で固定している
- `[akari-three]` の 3D 読込エラーは **main 単体でも出る** = 本レーンの持ち込みではない。
  捕捉済みで `unhandledExceptions` は 0、再生・シークは継続する。**別票候補として申し送る**

## fail-open の追補（指示 3・本レーンの寄与）

原則 = 描けない・知らない種別は「描かないだけ」で再生・シーク・他の描画は続行する。

- `src/common/preview-items.ts` の `collectItems`: 未知の `source.kind` を全バケットでスキップし、
  同じ読込につき警告 1 回だけに集約（`PreviewItemWarningState` を呼び出し側で共有）。
  併せて `caption`（単数）を既知種別として明示 — v2 スキーマ上は妥当（`edit-v2.ts:127`）なのに
  従来の switch に無く、既知入力で無駄な警告が出ていた
- `src/common/frame-engine-layer-supply.ts`（新規）+ `frameEngineBootstrapScript()` への `toString()` 注入:
  `summary.layers` の非オブジェクト要素だけを警告 1 回で落としてから frame-engine に渡す。
  壊れた 1 要素が engine 評価中に例外を投げて clock ごと止めるのを防ぐ。
  **src 無しの layer は総尺に効くのでそのまま通す**（落とすと尺が縮む）

### fail-open の証明水準について（正直な限定）

v2 スキーマは `source.kind` を `media/html/telop/filter/group/captions/caption` の 7 種に**厳格に限定**する
（`packages/edit-store/src/edit-v2.ts:568` が他を throw する）。したがって未知種別は
**正規の edit.json 経路では `collectItems` まで到達しない** — 検証は `readInternalEdit` の段で止まり、
main の `reloadEdit` エラー表示（`d24071be`）が notice を出す。
`default:` 分岐は「スキーマが 8 種目を受け入れたのにプレビューの射影がまだ知らない」将来互換のための防御であり、
**実案件 fixture では e2e 再現できない**。よって固定はユニットテスト水準で行っている
（`test/preview-items.test.mjs` の既知 7 種で無警告 / 未知種別のみ 1 回警告、
`test/frame-engine-layer-supply.test.mjs` の非オブジェクト除去と src 無し保持）。
契約の「知らない種別で再生が止まらないことをテストで固定」はこの水準で満たしている。

## 既存の構文ガードは存在していたが CI で走っていなかった（申し送り）

- `test/` には webview テンプレート（`hostAdapterScript` / `previewBootstrapScript` /
  `frameEngineBootstrapScript`）の `vm.Script` 構文検査が 1 巡目時点で既にあった
- 起点 `d24071be` で akari-preview の `npm test` は 455 件中 4 件 fail、うち 2 件がこの構文ガードだった
- `.github/workflows/ci.yml` の apps/shell L0 ジョブは `build:ext` と `lint` だけで **`npm test` を走らせていない**ため、
  この RED はマージを止められなかった（= v0.1.29 が壊れたままタグされた）
- **merge 後 HEAD では akari-preview 493/493 全緑**（並走レーンの修正で 4 件の赤が解消済み）
- CI に所有 package の `npm test` を足すかどうかは本契約のファイル境界外（`.github/**` は編集禁止）なので
  **申し送りに留める**

## ファイル構成と再現手順

### ファイル構成

- `scripts/run-l1.mjs` — 生 CDP で main window に接続 → 素材パネルの `edit.json` カードをダブルクリック →
  出力プレビュー webview の active-frame へ接続 → 左右パネルを畳む → 再生ボタンを実クリックして
  2 秒間の `#seek` の進みを測る → `#seek` を 1.0s / 4.5s の位置で実クリックし `#preview-stage` を clip してスクショ →
  **実行される** inline script を `new Function` でパース検査 → console / `exceptionThrown` / `Log.entryAdded` を集計
- `scripts/launch-l1.sh` — Electron を CDP 付きで起動し READY を待って `run-l1.mjs` を回す
- `scripts/make-variants.mjs` — 切り分け用 6 変種の生成（原本は読み取りのみ）
- `before/` — 起点 `d24071be` ビルドでの objtree / critique の L1 ログとシーク 2 点のスクショ、`variants-matrix.json`
- `after/` — **merge 後 HEAD**（`31b4ac4d` 取り込み後）での同じ一式 + `play-advance-repeatability.json` + `electron-main-stderr.md`（`*-electron.log` は `.gitignore` の `*.log` で追跡外のため抜粋を md 化）

### 再現手順

1. リポジトリルートで `npm install --ignore-scripts` し、`apps/shell` で `npm run build`
2. `node_modules/electron` の libffmpeg を stock 版へ戻して ad-hoc 再署名する
   （`apps/shell` の build が `@theia/ffmpeg` で非プロプライエタリ版へ差し替えるため。戻さないと H.264 が復号できない）
3. `bash scripts/launch-l1.sh <案件ディレクトリ> <出力先> <ラベル> [ポート]`

### 注意

- 計測時はプレビューペインを広げること。ペイン幅が狭い（実測 413px）と `#time-label` が `#play-toggle` の上に重なって
  再生ボタンをクリックできない（`run-l1.mjs` は左右のサイドパネルを畳んで 1138px 以上を確保する）。
  これはプレビュー transport の別件のレイアウト問題で本修正の対象外（**申し送り**）
- `run-l1.mjs` の構文検査は `type` 属性を見て**実行される script だけ**を対象にする。
  `<script type="application/json" data-akari-3d-scene>`（critique-cut-v2 の 3D オーバーレイが持つデータ島）を
  `new Function` に通すと必ず `Unexpected token ':'` になり、本物の SyntaxError と見分けが付かなくなるため。
  再開走の初回計測でこの偽陽性を踏んだので、検査側を直して `nonJsScriptsSkipped` として明示するようにした
- 証跡の絶対パスは `<WORKTREE>` / `<SCRATCH>` / `<TMPDIR>` へ置換済み（governance の tracked-file leak scan 対応）
