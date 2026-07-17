# evidence: seek-and-image-open（2026-07-17-preview-seek-and-image-open）

L1 実機検証（Electron + CDP、生 WebSocket クライアント。playwright-core は不使用）。

## 手法

- ビルド: `npm run build`（`build:ext` + `theia build --mode production`）exit 0
- 隔離ワークスペース: `templates/project-default/` をコピーし、合成素材を追加
  （ffmpeg 生成の 640x360/10秒 SMPTE テストパターン mp4 + そこから抽出した 1 枚の jpg キーフレーム
  + 5 セグメントの合成 `*.analysis.json`）
- 起動: `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell> <隔離ワークスペース>
  --remote-debugging-port=<port> --user-data-dir=<隔離ディレクトリ> --no-sandbox`
- 操作: 生 CDP WebSocket クライアント（`Runtime.evaluate` / `Input.dispatchMouseEvent` /
  `Page.captureScreenshot`）。follow-open の代理実行として、実際にエディタ拡張パネルが使う
  `vscode.window.showTextDocument(uri, {preview, preserveFocus})` の実体経路である
  `CommandRegistry.executeCommand('vscode.open', <file URI 文字列>)`
  （`@theia/plugin-ext-vscode` 登録の実コマンド。`OpenerService.getOpener(uri)` →
  `opener.open(uri)` という、$tryShowDocument と全く同じ着地点に到達する）を CDP から直接実行
  （調査で判明した「follow-open は OpenerService 経由」という事実に基づく最小再現。
  タスク契約 §4 L1(b) の「調査 1 で特定した API 呼び出しを CDP から直接叩く」に対応）
- 入れ子 webview フレーム到達: `Page.getFrameTree` ではフレームが 1 個しか見えない場合があった
  （タイミング依存）。`Runtime.enable` 後に飛んでくる `Runtime.executionContextCreated` イベントの
  `auxData.frameId` を全件収集し、対象 URL に一致する `contextId` を選んで `Runtime.evaluate`
  することで、outer webview iframe → 内側コンテンツの実 DOM に到達した
  （画像は 2 階層目の execution context、動画プレビューも同様に 2 階層目で `<video>` に到達）
- DI コンテナへの到達: `window.theia.container._bindingDictionary._map` を走査し、
  `Symbol` 識別子は `.description` 一致、クラス識別子（`bind(X).toSelf()`）は
  `.prototype` のメソッド指紋一致で該当バインディングを特定（`OpenerService` は前者、
  `CommandRegistry` / `ApplicationShell` は後者）。プロダクトコードは一切変更していない
  （検証専用のブラウザコンソール操作）

## 測定結果

### F22（画像 OpenHandler）

1. `.akari/sidecars/clip/work/keyframe-0002.jpg`（11KB）を `vscode.open` 経由で開く直前・直後で
   `document.querySelectorAll('.dialogBlock, .theia-dialog-shell, .dialogOverlay').length` を計測
   → **開く前 0 件・開いた後も 0 件**（バイナリ警告ダイアログ不発生を実測）
2. 開いたタブのアイコンクラス: `codicon-file-media`（`AkariImageOpenHandler` が設定する値。
   テキストエディタ/動画プレビューのアイコンとは別物）と一致 → 新規ハンドラが実際に処理したことを確認
3. webview 内側フレームで `<img>` を実測: `naturalWidth=640, naturalHeight=360, complete=true`,
   `src` は `data:image/jpeg;base64,...`（14,899 文字）— 元動画と同じ解像度で正しく描画
   （スクリーンショット: `01-image-open-no-dialog.png`）
4. 非退行: 同じ手法で `assets/clip.mp4`（動画プレビュー本来機能）・`AGENTS.md`（テキスト/Markdown）を
   開き、いずれもダイアログ 0 件・想定どおりのタブが開くことを確認

### B（外部シーク受け口）

1. 合成 `captions.json` を「文字起こしから字幕を作成」ボタン（実 DOM クリック）で生成
   → 5 行のキャプション（`最初の…`〜`最後の…`セグメント、start=0/2/4/6/8秒）
2. `clip.mp4` プレビューを開いた状態で「三番目のセグメントです」行（start=4.0s）を実クリック
   → プレビュー webview 内 `<video>` の `currentTime` を実測 = **4**（`duration=10, readyState=4`）
   → transcript フッター文言 = `00:00:04.000 にプレビューをシークしました。`
   （スクリーンショット: `02-transcript-seek-success.png`。行 3 が選択状態）
3. プレビュータブを閉じた状態（`ApplicationShell.closeWidget` で実クローズ）で
   「四番目のセグメントです」行（start=6.0s）をクリック
   → フッター文言 = `00:00:06.000 を選択しました。プレビューを開くとここからジャンプできます。`
   （劣化通知に切り替わることを実測）
4. 誤ジャンプ防止の実測: `clip.mp4` プレビューを開いた状態で、`akari.transcript.seekRequested`
   コマンドを**一致しない `videoUri`**（存在しない別素材のパス文字列）で直接実行
   → 戻り値 `false`（フォールバックハンドラに委譲）、かつプレビューの `<video>.currentTime` は
   `0` のまま変化なし（誤ジャンプが起きないことを実測で確認。契約の判定方法どおり
   `videoUri` の厳密な文字列一致のみで判定している証跡）

## ファイル

- `01-image-open-no-dialog.png`: `keyframe-0002.jpg` を開いた直後のタブ状態（ダイアログなし）
- `02-transcript-seek-success.png`: 文字起こしパネルで行 3 を選択した状態
- 本 README（測定値のサマリ）

検証専用の隔離ワークスペース・生成素材（mp4/jpg/analysis.json）は本評価後に完全削除した
（リポジトリには含めていない）。
