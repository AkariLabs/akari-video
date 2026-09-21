---
layer: wiki
tier: 30_products
type: product
status: draft
updated: 2026-09-22
---

# asset-panel-pick-mode — L1 手順・証跡の雛形

このディレクトリは実行スクリプトのみを用意した状態。L1 は未実行であり、画像・計測値は実行時に生成する。
`cdp-lib.mjs` は `../left-panel-split/cdp-lib.mjs` の無改変コピー（Node 22 以降の組み込み API のみ）。
Electron の起動・listen・依存のインストールは行わない。

## 実行前提

ラッパー側で最新バンドルをビルドし、隔離ワークスペースを開いた Electron を CDP 付きで起動しておく。
ワークスペースの `assets/` に実画像 `a.png`、`b.png`、`c.png` と実動画 `clip.mp4` を配置する。
素材検索は空、通常のプロジェクト素材一覧でこれらが見える状態にする。

```sh
CDP_PORT=9222 node apps/shell/extensions/akari-project/evidence/asset-panel-pick-mode/run-l1.mjs
```

出力先は本ディレクトリ。`EVIDENCE_DIR=/absolute/path` で変更できる。
実行は `akari.generation.pickInto` を実際の CommandService から直接呼び、カードと完了ボタンは CDP の
`Input.dispatchMouseEvent`（`realClick` 1 回）で操作する。DOM の `.click()` や偽 service は L1 では使わない。

## コンテナとコマンドサービスの取得

Theia の `@theia/application-manager/lib/generator/frontend-generator.js` の `start()` が公開する
`window.theia.container` を使う。複数ウィンドウや splash がある場合は全 page target を探索する。
Inversify の実キーから `Symbol('CommandService')` を探し、未登録なら既存の
`akari-annotations/evidence/inspector-live-preview-sync/run-l1.mjs` と同様に
`executeCommand` / `registerCommand` を持つクラス（CommandRegistry）を解決する。
クラス名の minify に依存しない。親コンテナと dictionary の `traverse` もフォールバック対象。

起動完了後もコンテナが公開されない独自ラッパーの場合は、そのラッパーが公開する**実コンテナ**の式を
`THEIA_CONTAINER_EXPRESSION` へ指定する。存在しない別のグローバルを推測したり、サービスを偽装したりせず、
取得できなければ失敗と理由を `run-log.json` に記録する。

## 生成される証跡

| ファイル | 観測・判定 |
|---|---|
| `01-single-band.png` | single / accepts image の帯が表示される |
| `02-single-picked.png` | 画像 1 回クリックで `picked`、`paths: ['assets/a.png']`、帯消失 |
| `03-multi-badges.png` | 画像 2 枚に `@画像1`・`@画像2`、`完了（2）`、3 枚目は max で無効。その後完了で 2 パスを返す |
| `04-video-disabled.png` | 動画が `aria-disabled=true`、realClick 後も未解決・帯継続 |
| `05-escape-cancelled.png` | Esc で `cancelled`、帯消失 |
| `run-log.json` | PASS/FAIL、各シナリオの実測 ms・戻り値・札・aria-disabled・未解決判定、SS 一覧 |

失敗時もログを保存し、接続済みなら `99-failure.png` を保存する。Electron 自体は終了しない。

## 境界内の設計と選択イベントの接続

要求の正規化、accepts、足し引き、順序札、max、非同期 resolver とキャンセルは
`src/common/generation-pick.ts` の DOM 非依存状態機械で検証する。
ウィジェットから既存の `resolveCatalogMaterial` を注入し、実体化後のプロジェクト相対パスだけを返す。
既存の open・ドラッグ・右クリックはモード外で維持する。

「別のクリップの選択」は、annotations の `publishPrimaryPreviewSelection` が送出し preview も購読する
`akari.timeline.primarySelected` を素材ウィジェットで購読して接続する。イベント名は common の定数で
直書きミラーし、境界外のソースは変更しない。
正規化した `editUri` ごとに最後に見た選択を保持し、モード開始時にその写しを取る。
以後は common の純関数で開始時の `kind` + `id` と比較し、変化（null への解除も含む）で cancelled にする。
同じ選択・null の再送はキャンセルしない。未観測の editUri は選択なしとして比較する。
購読は dispose 時に解除する。ワークスペース変更、Esc、やめる、二重起動、hide、detach、close、dispose でもキャンセルする。

CSS は既存のウィジェットと同じ `try { require(...) } catch {}` 形式で読み込み、Node 単体テスト時の
CSS 読み込みエラーを許容する。

## 検証欄（ラッパー記入用）

- L1 実行日時・環境: 未実行
- L1 実測: `run-log.json` を参照（実行後）
- スクリーンショットの確認: 未実施

## ローカル L0（2026-09-22）

- `apps/shell`: `npm run build:ext` exit 0。
- `apps/shell`: `npm run lint` exit 0、error 0。既存の境界外 warning 1 件
  （`akari-companion-contribution.ts:265` の `_ignored` 未使用）は変更していない。
- `apps/shell/extensions/akari-project`: `npm test` は **452 / 452 pass**
  （既存 414 + 新規 38、fail / cancelled / skipped いずれも 0、最終実測 5173.095958 ms）。
- 追加修正後の初回全体実行は 451 / 452 pass。既存 `transcribe-cancel.test.mjs` の SIGKILL 後の
  プロセス消滅確認が 1 回失敗した。既存テストは変更せず全体を再実行し、上記 452 件すべて通過。
- `run-l1.mjs` は `node --check` 通過。`cdp-lib.mjs` は複製元とバイト一致。
- 既存テスト、lockfile、所有境界外のソースは無変更。L1 は未実行。
