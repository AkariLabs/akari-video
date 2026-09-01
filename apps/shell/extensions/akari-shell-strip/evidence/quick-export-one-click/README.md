---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-09-01
---

# quick-export-one-click L1 検証手法・証跡

書き出しボタンの 1 クリック化（8 問ウィザード撤去・既定 `--engine auto`・GUI から
legacy を消す・完了表示にエンジンと OSR 転落理由を出す）の実機検証記録。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + 生 CDP）に従う。依存追加なし
（Node 22+ 組み込みの `fetch` / `WebSocket` のみ）。`cdp-lib.mjs` は
`evidence/quick-export`（2026-07-25）の共有ヘルパーを中身無改変で複製。
`harness.mjs` は本タスク用に新設し、既存の `launch.mjs` / `scenario-helpers.mjs`
から次の 3 点を変えている:

1. Electron 実体をリポジトリ直下の `node_modules/electron`（`apps/shell` 配下には無い）から取る
2. `THEIA_CONFIG_DIR` を走行ごとに隔離し、`PreferenceScope.User` の書き戻し先
   （`settings.json`）を実ファイルで観測できるようにする
3. quick-pick が「出ないこと」を測る否定プローブ `quickInputProbe()`
   （`.quick-input-widget` の `display` / `visibility` / 実寸を 1 回読む）と、
   ラベルだけを読む `progressLabels()`（セクション全文だとボタン名や `<style>` 文字列に埋もれる）

### 環境

- `apps/shell` を `npm run build`（`build:ext` → `theia build --mode production`）でビルド
- `apps/shell` の build は `node_modules/electron` の `libffmpeg.dylib` を非プロプライエタリ版へ
  差し替えるため、**stock 版（`H264 Decoder` 1 件・2,160,944 B）を main-ops から原子的に戻し**、
  `path.txt` を書いて OSR / GPU の tier 2 経路を成立させてから ad-hoc 署名し直した
- ワークスペースは内部リポ `fieldtest/2026-08-29-critique-cut-v2` を `/tmp/qeoc/` へ複製（原本不変）。
  複製から `.akari/render.json` と `exports/final.mp4` だけを削除する
  （`exports/packaged-verify.mp4` は edit.json の `sources` から参照されているので消すと lint が error になる）

| ワークスペース | 内容 |
|---|---|
| `/tmp/qeoc/ws-a` | 素の複製（GPU 適格）。シナリオ A + C |
| `/tmp/qeoc/ws-b` | `overlays/ineligible-frame.html`（`<iframe>` を含む）を v-overlay トラックの 130..180 フレームへ追加した複製。シナリオ B |
| `/tmp/qeoc/ws-d` | 素の複製。シナリオ D |

`<iframe src="about:blank">` は render-cut の未宣言アセット検査
（`render-inputs.mjs#assertNoUndeclaredHtmlAssets`）に落ちて書き出しごと止まるため、
同じ `embedded-context` 条件を踏む `<iframe src="data:text/html,…">` を使った
（適格性判定 `eligibility.mjs` の `embedded-context` は `<iframe|object|embed` のタグ出現だけを見る）。

## 実測結果

| シナリオ | 受け入れ条件 | 結果 |
|---|---|---|
| A（`scenario-a-oneclick.mjs`） | L1 (a) 質問ゼロ | `a-00`〜`a-04`.png / `scenario-a-run-log.json`。書き出しボタン押下後 **1 秒間隔 5 回すべて `.quick-input-widget` は DOM に現れない**（`{present:false, visible:false}` × 5）。書き出し中ラベル = `書き出し中（planned）（GPU で書き出し中）`（50% → 100%）。完了ラベル = **`書き出し完了（GPU）`**、`.akari/render.json` の `provenance.engine === "gpu"` / `warnings: []` / 成果物 `exports/final.mp4` sha256 `d99bac1119e2ab74d96d0428b0bf32196f5ee098bf905dcb24acd07c51f69914`。**成功時トースト 0 件**（静か）。console error 0 |
| C（同スクリプト後半） | L1 (c) 上書きしない | `a-05`.png。`exports/final.mp4` がある状態で 2 回目を押す → quick-pick 0 回のまま `exports/final-2.mp4` が生成され、**`final.mp4` の sha256 は不変**（`d99bac11…` → `d99bac11…`）。`exports/` = `.gitkeep` / `final-2.mp4` / `final.mp4` / `packaged-verify.mp4` |
| B（`scenario-b-ineligible.mjs`） | L1 (b) 不適格の可視化 | `b-00`〜`b-02`.png / `scenario-b-run-log.json`。書き出し中ラベル = `書き出し中（planned）（OSR で書き出し中）`。完了ラベル = **`書き出し完了（OSR — GPU 不適格: ineligible-frame: embedded-context）`**。同文のトーストが **ちょうど 1 回**。`provenance.engine === "osr"` / `provenance.osr.provenance.launcher_tier === 1`（tier 3 の legacy 転落ではない）/ `warnings[0] === "GPU export is ineligible; using OSR: overlay:ineligible-frame:embedded-context"`。console error 0 |
| D（`scenario-d-detailed.mjs`） | L1 (d) 詳細設定 + エージェント経路の非退行 | `d-00`〜`d-08`.png / `scenario-d-run-log.json`。「詳細設定で書き出す…」の quick-pick は **画質 → エンコーダ → fps → 出力先 → 実行方法 の 5 問 + 「この設定を既定にしますか」の 1 問だけ**（6 問目のあとは quick-input が非表示に戻る）。全 placeholder / 全行ラベルに `エンジン` `legacy` `解像度` `lint` `出力ファイル名` `OSR` `v2（` のいずれも出現しない。実行方法 =「エージェントに任せる」→ 既存どおり **`パートナー未接続。右側の「パートナーを追加」パネルから接続してください`** のトースト（依頼パケット注入経路の無退行）。「既定にする」= はい → `THEIA_CONFIG_DIR/settings.json` に `{"akari.export.quality":"light","akari.export.encoder":"videotoolbox","akari.export.fps":30,"akari.export.outputDirectory":""}`。その保存済み既定のまま主ボタンを押すと質問ゼロで完走し `書き出し完了（GPU）`・`ffprobe` 実測 1920x1080 / 30fps / 330 frames / h264+aac。console error 0 |
| 非退行（lint FAIL 中断） | 決定論 / 非退行 | 初回試走（fixture 準備の誤りで `references.files` が error になった走行）で、実機が **`lint NG — 書き出しを中断しました` + バッジ `lint 3 件` + `lint レポートを開く`** を出して render-cut を起動しないことを実測。fixture を直したあとは全走行で lint pass |
| 隔離・後片付け | — | 全 4 起動で `assertNoOrphans`（Electron main の PID から辿る子孫プロセス木 + user-data-dir 文字列マッチ）が `{ok:true}` |

## 未確認事項

- Windows / Linux は未確認（macOS darwin-arm64 のみ）。`buildQuickExportEncoderChoices` の
  win32 / linux 分岐と preference の enum は L0 の単体テストどまり
- 出力先 quick-pick の「フォルダを選ぶ…」（ネイティブフォルダダイアログ）は CDP から
  操作できないため未検証。既定（`exports/` 直下）と保存済み既定の 2 経路のみ実測
- fps を edit.json の宣言と違う値（例 24fps）に設定すると render-cut v2 が
  `v2 の出力 fps は宣言が正本です…` で拒否する。これは既存の v2 方針
  （`packages/render-cut/src/plan.mjs:100`）で本タスクの非ゴール。GUI 側は
  拒否メッセージをそのまま失敗表示に出す（従来どおり）
