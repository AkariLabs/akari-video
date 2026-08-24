# caption-inline-edit — L1 実機検証記録（字幕本文のダブルクリック編集）

出力プレビューの字幕をダブルクリック → contenteditable でその場編集 →
Enter/フォーカス喪失で captions.json の該当 cue の text だけへ書き戻す機能の
実機（production ビルド Electron + raw CDP）検証。

## 実測内容（run-log.json / run-log-restart.json）

| 項目 | 実測 |
|---|---|
| baseline | t=1.0 で c-0001「こんにちは世界」・t=2.8 で c-0002「触らない字幕」表示 |
| 編集開始 | 再生中に dblclick → contenteditable=true・focus 付与・**再生は自動一時停止** |
| Escape | 編集破棄 → 元の文字へ復帰・captions.json **バイト不変** |
| シークガード | 編集中に t=2.8 へシークしても編集継続（renderCaption ガード）・キャンセル後は現在時刻の cue を再描画 |
| Enter 確定 | c-0001.text だけが変化（期待バイト列と**完全一致** = タイミング・他 cue・zone 不変） |
| zone 回帰 | captionWrite {zone:'top'} → {zone:'bottom'} 往復がテキスト保持のまま成功しコミット時バイト列へ復帰 |
| 空文字確定 | c-0002 が cue ごと削除（裁定: 空白のみ text は cue 削除）・plate 空表示 |
| 再起動永続 | アプリ再起動後も編集後テキスト表示・削除 cue は消えたまま |
| render-cut パリティ | 書き出しフレーム t=1.0 に編集後の文字が焼け（07-render-frame-t1.0.png）、削除 cue の t=2.8 は字幕なし（08-...png） |

## 再現手順（プレースホルダ表記）

1. fixture 準備: `node scripts/prepare-fixture.mjs <workspace>`
   （project/ に 4 秒の lavfi mp4 + v2 edit.json + 2 cue の captions.json を生成）
2. production ビルド済み Electron を起動:
   `<apps/shell>/node_modules/electron/dist/.../Electron ../emphasis-render/electron-e2e-entry.cjs <workspace> --remote-debugging-port=<port> --user-data-dir=<workspace>/userdata --no-sandbox`
   （`THEIA_CONFIG_DIR=<workspace>/config`）
3. `node scripts/run-l1.mjs <port> <workspace> <evidenceDir>`
   （developer mode を設定パネルから有効化 → explorer で project/edit.json を
   ダブルクリック = 出力プレビュー直接オープン → 全フェーズ実測）
4. Electron を kill → 再起動 → `node scripts/run-l1-restart.mjs <port> <workspace> <evidenceDir>`
5. `edit-lint` PASS 後 `render-cut <workspace>/project --out <workspace>/project/exports/out.mp4`
   → ffmpeg で t=1.0 / t=2.8 のフレームを抽出し焼き込みを視認

## 備考

- webview 内フレーム到達は emphasis-render / preview-transport-zoom と同じ
  二重 iframe 貫通（executionContextCreated × frameId 突合）
- 素材（raw）プレビューではなく **edit.json を開いて出力プレビューを直接開く**
  （AkariOutputPreviewOpenHandler canHandle=1200）
- 編集対象 cue の特定は「対象時刻の cue が plate に表示されるのを確認してから
  dblclick → editText を検証」のリトライ型（転送系の再描画とのレースを排除）
- スクリーンショットは Electron の制約（iframe ターゲットへの
  Page.captureScreenshot 不可）により main ページから取得
