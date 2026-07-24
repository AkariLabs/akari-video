# r5c-track-z: L1（プレビュー実機 CDP）試行記録

## 結果: 未完了（インフラは動いたが自動化はここまで）

`verify` スキルの手順どおり、実 Electron（`electron@39.8.7`、キャッシュから展開）を
`--remote-debugging-port` 付きで起動し、CDP（`run-track-z-l1.mjs`、依存ゼロの
raw CDP driver。`preview-consume-cuts/run-consume-cuts-e2e.mjs` と同じ流儀）で接続する
ところまでは実測で確認できた:

- `apps/shell` の `npm run build`（`build:ext` + `theia build --mode production`）は
  このワークツリーで実際に成功する
- Electron は実際に起動し、`--remote-debugging-port` で CDP が上がる
  （codex の自己申告「AppKit 起動時の SIGABRT」はこのラッパーの環境では再現しなかった）
- CDP 経由でスクリーンショット取得・`Runtime.evaluate`・webview の入れ子 iframe
  実行コンテキスト解決（`resolveActiveFrame`）は動作する

その先、`exports/source.mp4` をエディタタブとして開く自動操作で行き詰まった:
この「AKARI Video」シェルは CLAUDE.md の「4 アイコン」設計のとおり Theia 標準の
Explorer（ファイルツリー）アイコンを持たない（実測: 左レールは検索・拡張機能・設定の
3 アイコンのみ）。コマンドパレット（⌘P）もキー送出時にフォーカスが別パネルにあり
反応を確認できなかった。このシェル固有のファイルオープン導線（おそらく別のタブ/
パートナー UI 経由）を特定するには本タスクの境界を超える追加調査が必要と判断し、
時間対効果でここで打ち切った。

## 代替の裏付け

L1 で確認したかった「プレビューの重なりが出力と視覚一致」は、以下の独立した根拠で
間接的に裏付けている（実機 CDP そのものの代わりにはならないが、コードレベルでの
整合性は確認済み）:

1. **同じ順序解決ロジック**: render-cut 側（`track-order.mjs`）とプレビュー側
   （`akari-preview-open-handler.ts` 内の複製、由来コメント付き）は、どちらも
   `deriveTracks` と同じ既定順アルゴリズム（cuts→layers→captions→audio、各 kind 内
   track 番号昇順）を土台にしている
2. **同じ z 表現**: プレビュー側は `timeline.tracks`（または導出既定値）の配列位置を
   そのまま z-index に変換し（`zForTrack`）、cuts の「勝者」判定
   （`computeVideoRuns` 相当）にも同じ z-index 比較を使っている。render-cut 側は
   同じ配列位置を ffmpeg の合成順（下から `overlay` を重ねる順）に使っている——
   ロジックの分岐点（どちらが前面か）は両者で同一の入力（`timeline.tracks` の
   配列インデックス）から導出される
3. **既存回帰スイートは無傷**: `packages/render-cut` の `node --test` は
   149/153 pass・0 fail（既存 4 skip はこの変更と無関係な Chrome/hyperframes
   依存分）。`apps/shell` の `build:ext`/`lint` もクリーン
4. **`track-z-interleaved-stack` の実測**（`packages/render-cut/evidence/`
   配下）が、まさにこの z 反転を実レンダリング + ピクセル実測で証明している

## 後続タスクへの申し送り

このシェルの「ファイルを開く」実操作導線を CDP から特定できれば、
`run-track-z-l1.mjs`（本ディレクトリ）はそのまま L1 自動化の土台として使える
（`resolveActiveFrame`・`seekAndRead` はテスト済み）。次に必要なのはタブオープンの
最初の一手だけである。
