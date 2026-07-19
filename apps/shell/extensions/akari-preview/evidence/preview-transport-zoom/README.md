# preview-transport-zoom — 検証記録

対象: `apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts`
（transport 2 行化 + ズーム/パン/ミニマップ + 全画面）。

## 結論

- **L0: PASS**（build:ext / lint / build / package すべて exit 0・実測）
- **L1: PASS**（Electron 実機 + CDP。受け入れ条件 1〜9 全項目を実測、スクショ 8 枚 + 実測値ログ）
- 実装ラウンドでは一度 L1 BLOCKED と判定されたが、検収で根本原因を特定して解消した（下記「L1 が最初に BLOCKED になった経緯」）。

## L0 — 静的・機械的（PASS）

worktree で以下を実測（すべて exit 0）:

```
cd apps/shell
PYTHON=/usr/bin/python3 npm install --no-workspaces
npm run build:ext   # tsc -b 8 拡張
npm run lint        # eslint extensions/*/src/**/*.{ts,tsx}
npm run build       # production: [build/browser]/[build/node]/[build/electron] とも 0 errors
npm run package     # electron-builder --dir + verify-asar-contents
```

## L1 — 実機観測（PASS・全項目実測値付き）

検証ドライバ: 本ディレクトリの `run-transport-zoom-e2e.mjs`
（`docs/e2e-method/` の二重 iframe 貫通手法 + 実 CDP 入力。受け入れ条件 1〜9 を全自動観測）。

fixture: 24fps / 20 秒の動画 + edit.json（`output.fps: 24`、overlay `cap-a`）+ captions.json。
**workspace 直下に `.akari/` ディレクトリが必須**（無いと起動しない — 下記デッドロック参照）。

| # | 期待値 | 実測 |
|---|---|---|
| 1 | transport 2 行（上段シーク全幅 / 下段中央 5 ボタン + 右端ズーム・全画面） | `01-transport-two-rows.png`。center=[skip-back, frame-back, play-toggle, frame-forward, skip-forward] / right=[zoom-toggle, fullscreen-toggle] |
| 2 | 1 コマ送り/戻し = 1/fps ± 0.005 | fps=24: +0.0416660 / −0.0416670（期待 0.0416667）。t=0 / t=duration でクランプ確認 |
| 3 | ±10 秒 ± 0.05・クランプ | +10.000 / −10.000。0 / 20.0 でクランプ確認 |
| 4 | 再生中の 1 コマ送りで一時停止 | playing→click→paused=true を実測 |
| 5 | 200% ズーム + ミニマップ + パン + 100% リセット | transform `scale(2)`、minimap viewport 50%×50%、ドラッグで viewport left 25%→35% / transform `translate(-20%, -19.994%)`、リセットで `scale(1)`・pan 0・minimap 非表示。`02〜04-*.png` |
| 6 | ctrl+wheel ズーム | `scale(1)`→`scale(7.38906)`（連続 wheel）。`05-ctrl-wheel-zoom.png` |
| 7 | ズーム時に字幕・オーバーレイが同倍率追従 | zoom 200% で video / overlay-stage の rect が同一サイズ（1372×771.75）に一致。`06-zoom-200-captions-overlay.png` |
| 8 | 全画面トグル | **widget 最大化 fallback 経路で動作**（webview 内 `requestFullscreen()` は Theia の iframe sandbox が拒否 → `akari-preview-fullscreen-fallback` message → ホスト側 `ApplicationShell.toggleMaximized(widget)`）。maximized false→true→false を実測。`07/08-fullscreen-*.png` |
| 9 | 回帰 | シークバー矢印キー 10→10.005 / Space 再生トグル（blur 後）/ 外部シーク message → 12.5 ちょうど / `run-inspector-writeback-e2e.mjs` SUCCESS（edit.json `--color: #ffcc00`→`#00c853` 書き戻し） |

## L1 が最初に BLOCKED になった経緯（起動デッドロックの根本原因）

実装ラウンドの L1 で「Electron 起動がどの経路でも完走しない（`.workspace` が描画されない）」
事象が発生し、無改変 checkout でも再現したため一度「環境要因」と結論した。
検収で minified bundle の `FrontendApplication.measureContribution` にログを注入して起動を追跡し、
真因を特定した:

- **akari-project の `onStart()` が、workspace に `.akari/` が無く同意記録も無い場合、
  `await this.messages.info(プロジェクト同意プロンプト)` でユーザー回答を待つ。
  通知 UI はシェル attach 後にしか描画されないため、`startContributions()` が永遠に完了しない
  = 永久スピナー。**
- L1 fixture が `.akari/` 無しで作られていたため 100% 再現していた。負荷・レース・RPC 喪失は無関係
  （調査中に観測された plugin-paths RPC の挙動は red herring）。
- fixture に `.akari/` を置くと 3 秒で起動完了する。
- この起動デッドロック自体はプロダクトバグとして別タスクで根治する（onStart から同意フローを
  ready 後へ遅延させる）。

## 検収時修正（2 件）

1. **プロダクト 1 行**: ズーム popup の「外側クリックで閉じる」document リスナーを
   capture 段登録に変更。パン開始（zoom>1.05 の wrapper pointerdown）の
   `stopPropagation()` に外側クリック検知が殺され、ズーム中に popup が閉じられなくなる
   契約逸脱を修正（L1 実測で発見）。
2. **検証ドライバ**: 未走行だった初版の不備を修正 — 右ゾーン判定 selector（popup 内の
   プリセットまで数えていた）/ ツリー展開のシングルクリック化 + リトライ / eval 15 秒
   タイムアウト / fullscreen 遷移後の webview CDP 再接続 / Space 送信前の blur /
   DOMRect の数値直列化。

## 再現手順（次回の L1 用）

```sh
cd apps/shell
# node_modules が無ければ: PYTHON=/usr/bin/python3 npm install --no-workspaces
npm run build
mkdir -p <SCRATCH>/workspace/.akari <SCRATCH>/userdata <SCRATCH>/config   # ← .akari が必須
# fixture（動画 + edit.json + captions.json + overlays/cap-a.html）を <SCRATCH>/workspace/exports/ に配置
THEIA_CONFIG_DIR=<SCRATCH>/config \
  node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  "$(pwd)" <SCRATCH>/workspace \
  --remote-debugging-port=9333 --user-data-dir=<SCRATCH>/userdata --no-sandbox
node extensions/akari-preview/evidence/preview-transport-zoom/run-transport-zoom-e2e.mjs \
  9333 <SCRATCH>/workspace exports/sample.mp4 <evidenceDir>
```
