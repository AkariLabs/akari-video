---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-08-03
---

# left-panel-split L1 検証手法・証跡

タスク: `2026-08-03-left-panel-split`（左パネル 2 分割 — 上 = 素材（+ カタログ入口）/
下 = できたもの。プランタブ撤去）の実機検証記録。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。`cdp-lib.mjs` は
`catalog-tab`（2026-07-25）の共有ヘルパーをそのまま複製（様式踏襲・中身無改変）。
依存追加なし（Node 26 組み込みの `fetch`/`WebSocket` のみ）。

1. `apps/shell` を `npm run build`（`build:ext` → `theia build --mode production`）でビルド
2. `templates/project-default/` を隔離ワークスペース（リポ外の一時作業場）へコピー。
   `.akari/intake.json`（`status: "submitted"`）でホーム側の gate を解放（本タスクの対象では
   ないが、副作用で他画面がブロックされないための保険）
3. フィクスチャを追加（元テンプレートは無改変）:
   - `exports/final-v1.mp4`・`exports/final-v2.mp4`: ffmpeg で生成した実 1 秒 mp4（青一色 +
     440Hz サイン波）。`touch -t` で mtime を意図的にずらし、新しい順ソートを検証可能にした
     （v1 = 2026-08-02 22:41、v2 = 2026-08-02 23:10）
   - `.akari/reports/edit-lint-report.html`: `<title>編集チェックレポート — L1 検証用</title>`
     付き（タイトル抽出の検証用、mtime 23:15 = 最新）
   - `.akari/reports/render-report.html`: `<title>` タグ**なし**（フォールバックでファイル名
     表示になることの検証用、mtime 19:00 = 最古）
   - `assets/interview.mp4`: 素材タブ（上段）の既存回帰確認用に 1 本
4. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離ワークスペース絶対パス> --remote-debugging-port=<port> --user-data-dir=<隔離dir>
   --no-sandbox` で直接起動
5. `run-l1.mjs` で CDP アタッチ → DOM 実測 + スクショ 6 枚

## 実機起動の地雷（今回新規に踏んだもの・透明性のため記録）

- **このマシンは検証中、他の並列レーン（同一 harness の別ワークツリー）が同時稼働しており
  `uptime` 実測で load average 79.59/67.32/55.81 という高負荷状態だった。** この状態で
  Electron を連続コールドスタートさせると、バックエンドは起動完了ログを出すのに
  `onDidInitializeLayout`（curation・widget 装着のフック）まで到達せず `.theia-preload`
  スプラッシュが表示されたまま停止する個体が複数回発生した（widget 探索が 25〜60 秒待っても
  見つからない/`Runtime.evaluate` 自体が 15 秒でタイムアウトする、の 2 パターン）。
  実装コード側の欠陥ではなく、CDP から見ても停止時刻以降ログが一切進まないため起動シーケンス
  自体の高負荷ストールと判断した。対策: (a) `waitFor` を「1 回の評価失敗で全体を諦めない」
  リトライに変更（例外を握りつぶして次のポーリングへ）、(b) 起動直後に `/json/list` の
  `title` が既に `"ホーム - <workspace>"` になっている個体を選んで生存確認してからアタッチ、
  (c) 新規プロセスを増やすより「既に生きている個体を使い回す」方を優先。この対応で
  1 回、全 8 フェーズが例外なく完走するクリーンな実行ログを取得できた（`run-log.json`）
- Lumino のタブバー DOM クラスがこの Theia バンドルでは `p-TabBar-tab` ではなく
  `lm-TabBar-tab`（新しめの Lumino 採用済み）。旧 `catalog-tab` 証跡のセレクタをそのまま
  複製したところ最初のクリックはズレなく成功していたのに判定側だけ「タブが開かなかった」
  という誤検知になった（`document.title` は実際には `edit-lint-report.html - <ws>` に
  変わっていた）。DOM 直接ダンプで気づき、全セレクタを `lm-` へ修正した

## 実測結果（詳細は `run-log.json` / スクリーンショット）

| # | 項目 | 結果 |
|---|---|---|
| 00-boot | 左パネルが 2 分割で見える（上 = 素材ヘッダー + カード + カタログ入口ボタン、下 =
  できたものヘッダー + カード）。D&D 用 `data-akari-dropzone` は widget 自身のノードに健在 | `00-boot-two-panes.png`。実測 `materialsHeaderVisible/outputsHeaderVisible/catalogBtnVisible/dropzonePresent` すべて `true`。`materialsTop=45.5px` / `outputsTop=379.2px`（モック比率 1.2:1 に対応する見た目の分割位置） |
| 01 | 素材タブ（既存機能）の回帰: assets/ の 1 件が変わらずカード表示 | `cardCount:1`、`assets/interview.mp4` |
| 02 | できたもの: exports/ 2 件 + .akari/reports/ の HTML 2 件、**新しい順**、`<title>` 抽出/フォールバック双方 | `01-outputs-list.png`。実測順序（新→旧）: `編集チェックレポート — L1 検証用`(23:15, `<title>`から抽出) → `final-v2.mp4`(23:10, 12KB) → `final-v1.mp4`(22:41, 12KB) → `render-report.html`(19:00, `<title>`無しのためファイル名フォールバック)。mtime ソート・タイトル抽出・フォールバックの 3 点とも実測どおり |
| 03 | 「＋ カタログから素材をさがす」→ widget 内遷移（タブではない） | `02-catalog-navigated.png`。`backBtnPresent:true`・`materialsCardsVisibleWhileInCatalog:0`（上段が完全にカタログへ差し替わる）・`searchInputPresent:true`・実カタログ 31 件検出（dev-layout 自動検出が引き続き機能）。**下段「できたもの」は遷移中も表示され続ける**（`outputsStillVisibleWhileInCatalog:4`）— 上下は独立していることを確認 |
| 04 | 「← 素材にもどる」で復帰 | `03-back-to-materials.png`。`materialsCardsVisible:1`・`catalogBtnVisibleAgain:true`。スクショは `00-boot-two-panes.png` と **バイト完全一致**（sha256 照合済み）— 遷移往復後も見た目が寸分違わず復元されることを確認 |
| 05 | できたもの: HTML レポートをクリック → 中央に開く | `04-report-opened-center.png`。クリック前後でタブ数 21→22、開いたタブに `edit-lint-report.html` が追加 |
| 06 | できたもの: mp4 をクリック → 中央に開く | `05-export-opened-center.png`。タブ数 22→23（`final-v2.mp4` タブ追加、動画プレイヤーアイコン付き）。レポートタブと共存 |
| 07 | 手動リフレッシュボタンの存在 | `refreshBtnPresent:true` |
| 08 | console error 累積 | `errCount: 0`（全フェーズ通じて 0 — 新規コードに起因する実行時エラーなし） |

## プランタブ撤去の確認

`akari-role-buckets-widget.tsx` から `TabId`（`'materials' | 'plan' | 'catalog'`）・
`renderTabBar()`・`renderEmptyTab()`・`activeTab`/`selectTab` を削除し、上段の内部遷移状態
`topView`（`'materials' | 'catalog'`）に置き換えた。「プランはここに入ります…」の固定文言
コードは削除済み（grep で該当文字列が残っていないことをビルド前に確認）。

## L0（静的検査）

- `npm run build:ext`: exit 0
- `npm run lint`（境界内ファイルのみ個別実行 — `extensions/akari-project/src/**` +
  `akari-shell-strip/src/browser/akari-activity-bar-curation.ts`）: **0 件**
- `npm run lint`（リポ全体）: **exit 1（境界外の既存不具合）**。`akari-preview/src/browser/
  akari-preview-open-handler.ts:5278` の `no-irregular-whitespace` が本タスク着手前から
  存在する既存エラーで、本タスクは当該ファイルを一切編集していない（`git diff --stat main --
  extensions/akari-preview` が空であることを確認済み）。境界外のため修正権限がなく、L0 の
  「exit 0」は境界内スコープでのみ満たしている

## 未確認事項

- Windows/Linux での再現性は未確認（macOS darwin-arm64 のみ）
- exports/ の巨大ファイル（数百 MB〜GB 級の実尺書き出し）でのサムネ生成レイテンシ・
  一覧表示の体感速度は未計測（今回は 1 秒・12KB のダミー mp4 のみ）
- `.akari/reports/` に非 HTML の視認証跡 PNG が大量に存在する場合の一覧除外ロジック
  （拡張子フィルタのみ）は机上確認のみで、実データでの目視はしていない
- FileService watch による自動更新検知（exports/ へファイル追加時の自動再読込）は
  コードレビューと `ensureMaterialsWatch` との対称実装確認のみ。実機での「Finder から
  ファイルを追加 → 自動反映」の目視クリックスルーはしていない（手動リフレッシュボタンの
  存在と動作は確認済みなので、実運用上の代替手段はある）
