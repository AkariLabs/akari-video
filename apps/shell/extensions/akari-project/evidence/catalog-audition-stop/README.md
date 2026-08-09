---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-08-09
---

# catalog-audition-stop L1 検証手法・証跡

タスク: `2026-08-09-catalog-audition-stop`（カタログ試聴に「必ず止められる」を作る —
常設再生バー + 面外クリック/遷移で自動停止）の実機検証記録。

## 実装した停止経路（`stopCatalogAudio()` 1 箇所に集約）

- 常設バー（`data-akari-catalog-audio-bar`）の停止ボタン
- カタログ面内クリック（`renderCatalogTab` ルート要素の `onClick`）— 再生ボタンと
  常設バー自身は `event.stopPropagation()` で除外
- `selectTopView()` が `'catalog'` から離れるとき（「← 素材にもどる」）
- widget の `onAfterHide`（タブ切替等で非表示になったとき）
- 既存の dispose 時 pause は無改修のまま維持

## 設計判断（受入条件の文言から導いたもの）

1. **検索欄はクリック起点の「面外クリック」から除外した**（`renderCatalogControls` の
   `<input>` に `onClick={event => event.stopPropagation()}` を追加）。
   受入2「再生中に検索語を入れて再生中カードをフィルタアウト → バーは残る → 停止できる」は、
   検索欄をクリックしてフォーカスした瞬間に停止してしまうと成立しない
   （「フィルタアウトされても止める手段が残る」という本タスクの動機そのものを検証できなくなる）。
   検索欄以外（カード・見出し・カテゴリチップ・「取り込む」「頼む」等）は面外クリックの対象のまま。
2. **カテゴリチップの切替は「切替自体で停止する」実装を選んだ**（受入3で明示的に許容された
   二択のうち後者）。チップは普通の `<button>` で `stopPropagation` していないため、
   本実装のクリック検知に自然にバブリングして停止する。実測（下記 L1-3）で確認済み。

## 実機起動・隔離

`verify` スキル L1 節の手順どおり:

- `npm run build`（`build:ext` + `theia build --mode production`）でフロントエンド/
  バックエンド/electron を実ビルド
- `templates/project-default/` をスクラッチの一時ディレクトリへコピーし、
  `.akari/intake.json`（`{"status":"submitted"}`）でホームゲートを解放
- `THEIA_CONFIG_DIR` + `--user-data-dir` を検証専用の隔離ディレクトリに固定し、
  `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
  <隔離ワークスペース絶対パス> --remote-debugging-port=9333 --user-data-dir=<隔離dir>
  --no-sandbox` で直接起動（`theia start` / Playwright `_electron.launch()` は不使用）
- resolver（アカウントの素材）到達可否は環境変数で差し替えず、既定の本番カタログを
  そのまま使用（2026-08-09 時点で稼働中・実測 409 件、うち audio 188 件 —
  `catalog-account-first-ux` の run1 と同じ状態。mediaUrl は origin='resolver' の
  audio カードのみが持つため、実試聴の検証にはこの状態が必要）
- CDP ヘルパーは `catalog-account-first-ux/{cdp-lib.mjs,widget-lib.mjs}` を無改変で再利用
  （本ディレクトリにもコピーを同梱 — 同リポ内の相対 import のため）。24×24 円形の音源
  試聴トグルは同 README の既知の癖どおり `element.click()` で発火させた
- 検証専用スクリプト: `audition-stop.mjs`（本ディレクトリ）。widget 内部の
  `catalogAudioElement`（`new Audio()` で DOM 未接続のため `document.querySelector('audio')`
  では見えない）へは `window.theia.container._bindingDictionary` から ApplicationShell の
  コンストラクタ関数を特定し（production ビルドはクラス名を minify するため `k.name` では
  引けない — `k.prototype.getWidgetById` の存在で特定した）、`shell.getWidgetById(...)` 経由で
  実インスタンスの `.paused` を直接読んで実測した（受入5の「`<audio>` の paused=true を実測」
  に対応する唯一の経路）
- 検索語の入力は物理クリックを介さず、`input.focus()` + native value setter +
  `dispatchEvent(new Event('input'))` で行った（設計判断1と対になる検証方法）

## 実測結果（`audition-stop-log.json` 全文）

| # | 受入項目 | 実測 |
|---|---|---|
| 1 | 再生 → 常設バー出現（タイトル一致）→ バーの停止ボタン → 停止・バー消滅 | `playing1=true` → バーのテキストに `"再生中: After the Rain"` を含むことを実測 → 停止後 `bar.present=false` かつ `<audio>.paused=true`（`01-audio-bar-playing.png` / `02-after-bar-stop.png`） |
| 2 | 検索でフィルタアウト → バーは残る → 停止できる | フィルタ後もカードは非表示 (`afterSearchVisible=false`) だがバー健在・`<audio>.paused=false`（まだ再生中）を実測。バーの停止ボタンで `paused=true` に（`03-bar-remains-after-search-filter.png`） |
| 3 | カテゴリ切替（audio→still）→ バーで停止 or 切替自体で停止（どちらでも可） | **切替自体で停止する実装**を確認: 切替直後に `<audio>.paused=true`（`04-category-switch-outcome.png`）。スクリプトは「まだ再生中ならバーで止められること」も分岐で担保しているが、本実装では常にこの分岐に入らず切替時点で停止済みだった |
| 4 | 面内の他の場所（見出し領域）をクリック → 停止 | クリック後 `<audio>.paused=true`・バー消滅を実測（`05-stopped-by-outside-click.png`） |
| 5 | 「← 素材にもどる」で離脱 → `<audio>` paused=true | 離脱前 `paused=false` → 離脱後 `paused=true` をプロセス側（widget 実インスタンス経由）で実測（`06-materials-after-leaving.png`） |
| 回帰 | 別カード再生で前カードが止まり切り替わる | `aPlaying=false, bPlaying=true` を実測 |
| 回帰 | 同じカード再クリックでの停止（既存挙動） | 再クリック後 `playing=false` を実測 |
| 回帰 | origin='local' の「取り込む」「頼む」 | 両ボタン存在・クリック後 console.error 増分 0 を実測 |
| 回帰 | カタログ検索（既存機能） | 409→0 件（存在しない語）に絞り込まれることを実測 |
| 回帰 | still カードへの無影響 | still 160 件中、音源トグル 0 件（意図どおり非表示） |
| 品質 | console.error / unhandledrejection | 実行全体で 0 件 |

## L0（静的検査）

- `cd apps/shell && npm run build:ext`: exit 0
- `npm run lint`: exit 0（既存の無関係な警告 5 件のみ、エラー 0）
- `apps/shell/extensions/akari-project` の `npm test`: 131/131 pass（既存分のみ。
  停止ロジックは React state + `HTMLAudioElement` に密結合しており、実益のある形で
  純関数へ切り出せなかったため新規単体テストは追加していない — task.md が明示的に
  許容する「無理なら省略可」に従った）

## 隔離・後片付け

Electron プロセスは `ps aux` で確認した実 PID（ルート + Helper 群 7 プロセス）を
個別に `kill -9`（`pkill -f` の広いパターンマッチは使用せず）。検証後、全プロセスの
終了をプロセス一覧の再確認で確認済み。隔離ワークスペース・隔離設定ディレクトリは
スクラッチ領域のみに作成し、リポジトリにはコミットしていない
（スクリーンショット・ログ・検証スクリプトのみ本ディレクトリに残す）。

## 未確認事項

- Windows/Linux での再現性は未確認（macOS darwin-arm64 のみ）
- パッケージ版（electron-builder 出力）での再検証はしていない（開発ビルドでの検証）
- カテゴリチップ切替時、まだ再生中のまま常設バーで止める分岐（受入3の許容範囲内の別実装）は
  本実装では発生しなかったため、その分岐そのものは実行はされたが「バーからの停止」経路は
  この回では通っていない（受入1・2で同じバー停止ボタンの経路は別途実測済み）
