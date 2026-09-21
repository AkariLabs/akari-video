---
layer: wiki
tier: 30_products
type: product
status: draft
updated: 2026-09-22
---

# asset-panel-pick-mode — L1 手順・証跡

`run-log.json` と PNG 5 枚は 2026-09-22 の実 Electron / CDP 検証の記録（PASS）。
以下の手順で再実行し、画像・計測値を更新できる。
`cdp-lib.mjs` は `../left-panel-split/cdp-lib.mjs` の無改変コピー（Node 22 以降の組み込み API のみ）。
`run-l1.mjs` 自体は Electron の起動・listen・依存のインストールを行わない。

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

## 保存済み証跡（再実行で更新）

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

## 保存済み L1 の実測

`run-log.json` の開始時刻は **2026-09-21T17:20:58.063Z**（JST 2026-09-22 02:20:58）。
macOS の隔離ワークスペースを開いた実 Electron に CDP ポート 9531 で接続し、
実コンテナの CommandService symbol を解決、コマンド登録済みを確認。全体 **8583 ms / PASS**。

- single: **2706 ms**。実クリック 1 回で `picked` / `assets/a.png`、帯消失。
- multi: **2811 ms**。`@画像1`・`@画像2`、`完了（2）`、上限で3枚目は無効。
  完了時のパスは `assets/a.png`、`assets/b.png` の順。
- accepts: **2837 ms**。動画は `aria-disabled=true`、クリックしても未解決。
- escape: **169 ms**。`cancelled`、帯消失。
- スクリーンショットは上表の `01-single-band.png`〜`05-escape-cancelled.png` が保存済み。
  ログには主観的な目視検収の結果は含まれない。

この記録は既存の single / multi / accepts / Esc の検証結果。
右インスペクターからの再押下取消は `akari-annotations/evidence/inspector-generation/` の
追加 step 14–15 で検証する。既存のログを今回の追加実装の実測として扱わない。

## ローカル L0（2026-09-22）

- `apps/shell`: `npm run build:ext` exit 0。
- `apps/shell`: `npm run lint` exit 0、error 0。既存の境界外 warning 1 件
  （`akari-companion-contribution.ts:265` の `_ignored` 未使用）は変更していない。
- `apps/shell/extensions/akari-project`: `npm test` は **452 / 452 pass**
  （既存 414 + 新規 38、fail / cancelled / skipped いずれも 0、最終実測 5173.095958 ms）。
- 追加修正後の初回全体実行は 451 / 452 pass。既存 `transcribe-cancel.test.mjs` の SIGKILL 後の
  プロセス消滅確認が 1 回失敗した。既存テストは変更せず全体を再実行し、上記 452 件すべて通過。
- `run-l1.mjs` は `node --check` 通過。`cdp-lib.mjs` は複製元とバイト一致。
- 上記 L0 は先行実装時の記録。L1 の実測は前節と `run-log.json` を参照。
