---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-08-09
---

# paid-assets-one-view L1 検証手法・証跡

タスク: `2026-08-09-paid-assets-one-view`（有料素材を 1 ビューに出す — カタログへの有料メタ掲載
+ 購入済みの取得経路）の実機検証記録。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。`cdp-lib.mjs` / `widget-lib.mjs` は
`catalog-account-first-ux`（同リポ・別タスク）の共有ヘルパーをそのまま再利用（様式踏襲・中身無改変）。
`run-paid-badges.mjs` は本タスク専用の検証スクリプト（一時作業ディレクトリに置き、本ディレクトリには
ログ・スクショだけ残す）。

### dev ストアとの結線

- ストアリポ（`akari-video-store` の `task/2026-08-09-paid-assets-one-view` ブランチ）で
  `worker/` を `npm run setup`（migrate + seed + r2:seed）→
  `wrangler dev --port 8788 --var FAKE_STRIPE:1` で dev 起動
- `tools/publish-free.mjs` を実行（`--no-media` 無し）→ `data/assets-catalog.json` に有料 3 件が
  メタのみで載る → `worker/tools/upload-free.mjs` でローカル R2（`akari-store-free`）へ反映
- 有料 3 件の zip 実体は `worker/tools/publish-paid.mjs` で最小フィクスチャ payload
  （`validate-asset.mjs` を通る scene3d 構成）をローカル R2（`akari-store-paid`）へ入稿
- 疑似購入: dev-only スクリプトで magic link ログイン → `POST /api/store/checkout` →
  `checkout.session.completed` を HMAC 署名して webhook へ POST（test/e2e.mjs と同じ手法。
  FAKE_STRIPE はチェックアウト画面だけ）→ `POST /api/store/tokens` でアプリトークン発行
  （`phone-pro-titanium` だけ購入済みにし、他 2 件は未購入のまま残す）
- Electron 起動時の env で resolver をこの dev ストアへ向ける:
  `AKARI_ASSETS_CATALOG=http://localhost:8788/assets/catalog.json`・
  `AKARI_HOME=<隔離ディレクトリ>`（`store-credentials.json` に上記トークンを事前配置。
  UI のデバイスコード接続フローは経由せず、CLI 検証と同じ「トークン貼り付け」形で結線）

### スクリーンショットの見やすさ調整

既定ウィンドウ高（668px）だと素材パネルの有料カードが 1 枚しか同時に見えないため、
`Emulation.setDeviceMetricsOverride`（CDP 標準 API。ソース変更なし）でビューポートを
1400×2000 に広げてからスクリーンショットした。DOM 状態・属性値の実測（`run-log.json`）は
このビューポート変更の前後で変わらない。

## 実測結果

`run-log.json` に生ログ。要点:

| 商品 | 実測 state | badge 表示 | badge title（tooltip） | アクションボタン |
|---|---|---|---|---|
| `phone-pro-titanium`（購入済み・未取得） | `available` | `✓ 購入済み` | `購入済み（未取得）` | `使う`（有効・クリックで resolveAsset） |
| `laptop-slim-aluminum`（未購入） | `locked` | `¥2,980` | `¥2,980 未購入` | `¥2,980 で購入 — ストアを開く`（クリックでブラウザに `http://localhost:8788/lab/asset.html?id=laptop-slim-aluminum` を開く） |
| `app-icon-squircle`（未購入） | `locked` | `¥1,200` | `¥1,200 未購入` | `¥1,200 で購入 — ストアを開く` |

- カタログ件数: 352 件中、scene3d 検索フィルタで有料 3 件（+ 無料 scene3d 系があれば混在）に絞込み
- console.error / unhandledrejection: 0 件
- スクリーンショット: `01-scene3d-paid-badges.png`（既定ウィンドウ高。¥1,200 バッジが実際に見える）、
  `01-scene3d-paid-badges-full.png`（ビューポート拡張後。3 枚とも同時に見える）

## 回帰確認（CLI 経由。実機 GUI とは別に確認済み）

同じ dev ストア + 隔離 `AKARI_HOME` で `packages/asset-resolver/bin/akari-assets.mjs` を直接実行し、
無料素材（`bg-asteroid-belt`。still カテゴリ）の `fetch` が引き続き成功することを確認した
（本ディレクトリには残さず、report.md に実測ログを記載）。

## 隔離・後片付け

- Electron・`wrangler dev` はいずれも実 PID を指定して kill（広いパターンマッチは使わない）
- 検証用ワークスペース・隔離 `AKARI_HOME`・`THEIA_CONFIG_DIR`・dev-buy 用スクリプトはすべて
  一時作業ディレクトリに置き、検証後に削除。リポジトリにはコミットしていない
- `~/.akari` は一切変更していない
