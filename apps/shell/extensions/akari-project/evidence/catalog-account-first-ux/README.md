---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-08-09
---

# catalog-account-first-ux L1 検証手法・証跡

タスク: `2026-08-09-catalog-account-first-ux`（カタログ面の空状態を一般ユーザー向けに —
アカウント第一の見せ方 + 開発者向けフォルダ選択の格下げ）の実機検証記録。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。依存追加なし
（Node 22+ 組み込みの `fetch`/`WebSocket`/`http` のみ）。`cdp-lib.mjs` は
`catalog-root-fix`（同リポ・別タスク）と同じ共有ヘルパー（様式踏襲・中身無改変）。
`widget-lib.mjs` は本タスク専用の DOM フック集（`akari-role-buckets-widget.tsx` の
現行実装を実際に確認して書いた — widget 内遷移が `role="tab"` ではなく
`data-akari-open-catalog` / `data-akari-back-to-materials` の実ボタンであることは
このタスクで裏取りした。旧 catalog-root-fix 期の role="tab" 前提のヘルパーは
現行の widget にはもう当てはまらない）。

### 「ローカル catalog/ 未設定」の作り方（cwd 操作ではなく明示 preference）

このリポの dev 配置では `resolveCatalogRoot()` の `__dirname` 起点上方探索が
（`process.cwd()` をどこに変えても）このリポ自身の `catalog/` を必ず拾ってしまう。
`catalog-root-fix/scenario2-picker.mjs` が確立した手法をそのまま踏襲し、
`akari.catalog.root` に存在しないパス（bogus path）を本番 `PreferenceService.set(...,
User scope)` 経由で明示的に書き込むことで、`resolveCatalogRoot()` の
「preferenceRoot 設定時はそれだけを検証し、フォールバックしない」契約により
確実にローカル 0 件にした。

### resolver（アカウントの素材）の到達可否の作り方

`packages/asset-resolver` はカタログ取得元を環境変数 `AKARI_ASSETS_CATALOG`
で差し替えられる（`env.mjs`）。

- **到達可（run1）**: 環境変数を未設定のまま起動 → 既定の本番 URL
  `https://akari-oss.app/assets/catalog.json` へ実フェッチ（実測 348 件 = still 160 +
  audio 188。2026-08-09 時点で本番稼働中と確認済み）
- **遮断（run2 前半）**: `AKARI_ASSETS_CATALOG=http://127.0.0.1:39217/catalog.json` を
  起動時に設定し、そのポートに何も listen させない → fetch が ECONNREFUSED で確実に失敗
  （`packages/asset-resolver/src/catalog.mjs` の `loadCatalog()` はキャッシュも無ければ
  例外を投げ、`akari-project-service.ts` の子プロセスが非 0 終了 →
  `getAssetCatalogView().resolver.status === 'failed'` になることを事前に単体コマンドでも
  検証済み）
- **遮断解除（run2 後半）**: 同じポートで `local-catalog-server.mjs`
  （検証用の最小 HTTP サーバー。依存追加なし）を起動し、3 件の合成カタログ JSON を返す →
  「再試行」で resolver 由来のカードが混ざることを実測
- `AKARI_HOME` は `run1`/`run2` それぞれ専用の隔離ディレクトリを都度指定
  （`~/.akari` を一切汚染しない。catalog-cache.json のフォールバックが偶発的に効いて
  「遮断」の再現性を壊すことも防ぐ）

## 実機起動・隔離

`catalog-root-fix` と同じ手順（`THEIA_CONFIG_DIR` による User スコープ設定の完全隔離 +
`--user-data-dir` + 隔離ワークスペース）。ワークスペースは `templates/project-default/`
を一時ディレクトリへコピーし `.akari/intake.json`（`status: "submitted"`）でホーム
ゲートを解放。run1 のワークスペースには ffmpeg 生成の実 2 秒動画
（`assets/regression-clip.mp4`）と実 1x1 PNG（`unorganized-shot.png`）を追加し、
素材タブ回帰の実測に使った。

### CDP 合成クリックが効かない要素（実測で判明・回避策）

`Input.dispatchMouseEvent` による座標クリックは通常の React `onClick` ボタン
（カテゴリチップ・接続ボタン・開発者リンク行の小トグル等）には問題なく効くが、
以下の 3 種は反応しないことを実測で確認した。いずれも `element.click()`
（native DOM click）に切り替えることで確実に発火する（React 側は `isTrusted` を
問わないため、実クリックとの製品挙動の差は無い）:

1. 24×24px の絶対配置円形ボタン（カタログ音源試聴トグル）
2. `<details><summary>` の native トグル（開発者向け折りたたみ）
3. 開発者向けパネル内の「フォルダを選ぶ」ボタン

`widget-lib.mjs` はこの 3 箇所だけ `.click()` を使い、他は `cdp-lib.mjs` の
`realClick`（座標クリック）のままにしている。

## 実測結果

### run1 — リモート到達可 + ローカル未設定（L1-1 + 回帰一式）

| # | 項目 | 結果 |
|---|---|---|
| L1-1 | リモート到達可 + ローカル未設定 → リモート由来のカードが並ぶ | 実測 `itemCount=348`（=本番カタログ実数と一致）。全件 `data-akari-catalog-item-state` に `cached/available/locked` のいずれかを持つ（resolver-origin であることの直接証跡）。`01-remote-cards.png` |
| L1-1 | 内部語が画面のどこにも出ない（開発者折りたたみ閉） | `document.body.innerText` に「カタログの場所が未設定」「akari.catalog.root」のいずれも**含まれない**ことを実測 |
| — | アカウント第一見出し + 件数の小表示 | 見出し「このアカウントで使える素材 — 無料 + 購入済み」+「カタログ 348 件」を実測。`01-remote-cards.png` |
| L1-4 | 一覧表示中でも開発者向け導線（小リンク）に到達できる | クリックで開発者パネル出現（`akari.catalog.root` の表記を含む）、再クリックで閉じて内部語も消えることを実測。`02-developer-link-row-open.png` |
| 回帰 | カタログ検索 | 「コーヒー」で 348→2 件（`still/br-coffee-beans`, `still/br-coffee-pour`）に絞込み実測 |
| 回帰 | カテゴリチップ | `audio` で 188 件に絞込み実測。`03-category-audio.png` |
| 回帰 | 音源試聴（resolver origin のみ） | トグルで再生状態フラグが `true` になることを実測（試聴ボタンは native click 必須 — 上記「CDP 合成クリックが効かない要素」参照） |
| 回帰 | 素材タブ（ドロップゾーン・実素材カード・未整理） | ドロップゾーン健在・`regression-clip.mp4`（ffmpeg 生成の実動画）カード表示・`unorganized-shot.png`（実 PNG）を未整理として実測。`04-materials-tab-regression.png` |
| 回帰 | ストア接続/切断 UI 遷移 | `disconnected → pending`（接続ボタン）→`disconnected`（キャンセル）を実測。`05-store-connection-regression.png` |
| 品質 | console.error/unhandledrejection | 0 件（`run1-log.json` 末尾） |

### run2 — リモート遮断 + ローカル未設定（L1-2・L1-3・L1-4 + ローカル動詞回帰）

| # | 項目 | 結果 |
|---|---|---|
| L1-2 | 遮断 + ローカル未設定 → 一般向け失敗文言 + 再試行 | `data-akari-catalog-empty-kind="resolver-failed"`・本文「素材カタログを取得できませんでした。接続を確認して再試行してください。」・再試行ボタン実測。`11-resolver-failed-empty-state.png` |
| L1-2 | 内部語が画面のどこにも出ない（開発者折りたたみ閉） | 同上、実測で非該当を確認 |
| L1-3 | 空状態の開発者向け折りたたみを開く | `<details>` の `open` 属性が `true` になることを実測（native click 必須）。`akari.catalog.root` の表記が折りたたみ内でのみ出現することも確認 |
| L1-3 | 不正フォルダ選択 → 日本語の理由表示・preference 不変 | エラー文言「選んだフォルダーにカタログの内容が見つかりません（scene3d・overlay・still・audio・broll・font のいずれかのフォルダー、または INDEX.md が必要です）。」実測。preference 読み戻しが bogus path のまま不変であることも確認。`12-invalid-folder-error.png` |
| L1-3 | 実カタログ選択 → ローカル分のカード出現・preference 書き込み | 実カタログ（本リポ `catalog/`）選択後 `itemCount=61`（全件 `state==='local'` — resolver は遮断中のまま）。preference 読み戻しが選択パスと一致。`13-local-cards-after-picker.png` |
| L1-4 | ローカル分のみ表示中も、resolver 失敗の手がかりが見出し付近に残る | `data-akari-catalog-retry-inline` 実測（一覧が出ているため空状態の大きい案内は出ない中での唯一の手がかり） |
| L1-4 | 一覧表示中の開発者向け小リンクから到達できる | トグルで開発者パネルが出現/消滅（`akari.catalog.root` の値が選択済みパスを反映）することを実測 |
| 回帰 | origin='local' の「取り込む」「頼む」（変更していないことの確認） | 双方のボタン存在を実測。クリック後 console.error 件数の増分 0（`頼む` は quick-input 表示まで確認し Escape でキャンセル。既存挙動は無改修のため深い E2E は対象外） |
| L1-2 | 遮断解除（ローカル HTTP サーバー起動）→ 再試行 → resolver 由来のカードも並ぶ | `itemCount` 61→64（合成カタログ 3 件が加算）。新規 3 件が `state!=='local'`（resolver-origin）であることを実測。見出し付近の件数表示が「カタログ 3 件」（=resolver 自身の件数。マージ後の 64 とは別概念であることの直接証跡）に切替わり、`data-akari-catalog-retry-inline` が消えることも確認。`14-local-verbs-regression.png` / `15-merged-after-unblock.png` |
| 品質 | console.error/unhandledrejection | 0 件（`run2-log.json` 末尾） |

### run2-restart — 再起動後も有効（L1-3 永続の実証）

同一 `THEIA_CONFIG_DIR` / `--user-data-dir` で Electron を完全終了 → 再起動。
ピッカーには一切触れず:

- `pref.get('akari.catalog.root')` が選択済みパスのまま実測（`settings.json` を直接
  `cat` しても同じ値を確認）
- `itemCount=64`（ローカル 61 + resolver 3。resolver は再遮断中のはずだが
  `AKARI_HOME` を run2 と共有したままにしたため `catalog-cache.json` フォールバックが効き
  3 件がキャッシュから復元された——これは resolver 側の既存キャッシュ機構の副次的な確認で、
  本タスクの実装対象ではない）
- 空状態には戻っていない（`data-akari-catalog-empty-kind` 不在）ことを実測
- 内部語の非露出（開発者パネル閉状態）も再確認

`16-restart-persisted-cards.png`

## L0（単体テスト・静的検査）

- `npm run build:ext`: exit 0
- `npm run lint`: exit 0（既存の無関係な警告 5 件のみ。エラー 0）
- `apps/shell/extensions/akari-project` の `npm test`: **126/126 pass**
  （既存 123 件 + 新規 3 件: `deriveCatalogEmptyStateKind`〔件数>0 は resolver 状態に
  関わらず items・0 件+resolver 失敗→resolver-failed・0 件+resolver 成功→empty〕）

## 隔離・後片付け

各回、実 Electron プロセスは `ps aux` で確認した実 PID を指定して `kill -9`
（`pkill -f` の広いパターンマッチではなく個別 PID。他タスクの Electron プロセスと
混在する環境だったため機械的パターンマッチは危険と判断した）。全実行終了後、
`catalog-account-first-ux/apps/shell` を含む残存プロセスがゼロであることを確認済み。
検証用ワークスペース・隔離設定ディレクトリ・生成した実素材（動画/画像）・合成カタログ・
一時 HTTP サーバーはすべて検証後に完全削除し、リポジトリにはコミットしていない
（スクリーンショットと `run*-log.json`・検証スクリプトのみ本ディレクトリに残す）。

## 未確認事項

- Windows/Linux での再現性は未確認（macOS darwin-arm64 のみ）
- パッケージ版（electron-builder 出力）での再検証はしていない（開発ビルドでの検証）
- 「取り込む」「頼む」は本タスクで変更していないため、押下後にエージェント側へ実際に
  文脈パケットが届くところまでの深い E2E は対象外とした（ボタン存在・クリック後に
  console エラーが増えないことの回帰確認まで）
