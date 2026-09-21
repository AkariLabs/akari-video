# インスペクター節の折り畳み L1 証跡

`templates/project-default` を隔離ディレクトリへコピーし、ffmpeg で生成した 3 秒の MP4 を
2 本の映像クリップとして配置する。実 Electron に CDP で接続し、タイムラインのクリップと
「変形」の見出しを `Input.dispatchMouseEvent` でクリックする。外部 API は使用しない。

既存の依存関係と、今回の変更を含む `apps/shell` の production build が必要。
Node の組み込み WebSocket を使用する（Node 22 以降）。依存の追加インストールは不要。

```sh
cd apps/shell
npm run build
node extensions/akari-annotations/evidence/inspector-section-collapse/scripts/l1-inspector-section-collapse.mjs
```

- `FFMPEG=/path/to/ffmpeg` で差し替え可能。未指定なら
  `packages/media-bin/vendor/darwin-arm64/ffmpeg`、存在しなければ PATH の `ffmpeg` を使う。
- CDP ポートの既定は 22214。`--port=22215` などで変更できる。
- Electron は環境変数 `ELECTRON` を優先し、未指定なら `apps/shell/node_modules` → リポ root の `node_modules` の順に実体を探す。どちらにもなければ明確なエラーで終了する。
- Electron 起動方式・preload 待ちは `../inspector-generation/scripts/` に準拠。
  ウィンドウが隠れた際の requestAnimationFrame 停止による preload 待ちを防ぐため、`--disable-renderer-backgrounding` / `--disable-backgrounding-occluded-windows` / `--disable-background-timer-throttling` と CDP の `Emulation.setFocusEmulationEnabled`（`enabled: true`）を指定する。
  `cdp-lib.mjs` は同ディレクトリの手本をコピーしたもの。
- `AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` とプロジェクトはすべて
  `runs/l1-*/` に隔離する。本物の `~/.config/akari-video` / `~/Akari` は使用しない。
  detached 起動はせず、終了時はこの実行で起動した Electron の PID だけを停止する。
  隔離ディレクトリは終了時に削除する。強制中断で残った `runs/` はコミット対象外。

検査と成果物:

1. 1 本目を選択し、情報タブへ実クリックで切り替える。「情報」節が初期状態で
   `hidden` / `display: none` / 高さ 0 であることを `info-tab-initial` として計測し、
   textContent に `a.mp4` を含むことも検査する。動画タブへ実クリックで戻し、「変形」の表示を待つ。
2. 開いた「変形」を `before.png` に撮影し、実クリックで閉じた後に
   `display: none` / 高さ 0 を検査して `after-collapsed.png` に撮影する。
3. 再クリックで `display: grid` と正の高さに戻ること。
4. 再び閉じ、2 本目 → 1 本目と選択しても閉じた状態が維持されること。
   クリップの選択クラスと「時間」節の body に含まれる出力位置
   （1 本目 `00:00:00.000` / 2 本目 `00:00:03.000`）で、選択先の描画完了も確認する。
5. 最後に「変形」を開いて戻す。

`results.json` は各段階の全節の見出し・hidden 属性・計算済み display・実測高さ・
aria-expanded、assert の成否、終了処理を記録する。パスは `<WORKTREE>` / `<HOME>` /
`<TMP>` に置換する。失敗時は非ゼロで終了し、可能なら `failure.png` と計測値を残す。
成功時の 2 枚と失敗画像は、再実行時に古いものを削除する。

ソース調査では JS による hidden 付与は `appendSection` / `appendAdjustPreviewSection` の
section-body と、比較ボタン `akari-inspector-adjust-compare` のみ。
前者は共通の `[hidden]` 規則で修正し、後者は display 指定がないため追加修正不要。

構文・静的テストのみを実行する場合:

```sh
node --check extensions/akari-annotations/evidence/inspector-section-collapse/scripts/cdp-lib.mjs
node --check extensions/akari-annotations/evidence/inspector-section-collapse/scripts/l1-inspector-section-collapse.mjs
npx tsc -b extensions/akari-annotations
node --test extensions/akari-annotations/test/inspector-section-collapse.test.mjs
```

このディレクトリのスクリプト作成・構文検査だけでは L1 合格を意味しない。
ラッパーが実 Electron を実行して生成した results.json と画像が L1 の証跡となる。
