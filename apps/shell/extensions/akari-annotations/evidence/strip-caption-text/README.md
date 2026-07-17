# L1 検証証跡 — strip-caption-text（字幕本文の常時表示）

パッケージ版 `AKARI Video.app`（`npm run package` 実成果物・postpackage GREEN 441MB）を
隔離 user-data-dir + remote-debugging で起動し、captions を短文/長文/近接重なりで持つ
フィクスチャ（動画 + edit.json[cuts] + captions.json + review.json[注釈1件]）に対して
生 CDP で実操作した際のスクリーンショット。

| ファイル | 内容 |
|---|---|
| 01-widget-full.png | 注釈ウィジェット全景。ストリップに字幕本文が常時表示（ホバー不要）。cut 帯・青い注釈ピン・プレイヘッド・一覧・フッターが共存 |
| 02-strip-crop.png | ストリップ拡大。短文「短い字幕」「二番目の字幕」は完全表示、長文は帯からはみ出して表示（省略なし・クリップは帯の右端のみ） |
| 03-after-click.png | ストリップ実クリック後。プレイヘッドが 50% へ移動、フッターが「00:00:05.100 を選択しました。…」に変化（クリックシーク非退行） |
| 04-strip-crop-final.png | クリック後のストリップ拡大（字幕本文表示は維持） |
| 05-after-resize-narrow.png | ビューポート幅を狭めた後の全景（Theia 再レイアウト後も破綻なし） |
| 06-strip-crop-narrow.png | 狭幅時のストリップ拡大。字幕本文は開始時刻に紐づいたまま全数表示 |

## 実測値（CDP 実測）

- セグメント数: caption=4 / captionText(可視要素)=4 / cut=2 / pin=1
- 字幕テキスト要素: opacity=1・top=26px・height=16px・z-index=1・全数 visible=true
- 長文字幕の描画幅 ≈ 856px（ストリップ幅 ≈ 904px を超えてはみ出し = 要件どおり）
- クリック: playhead 0% → 50%、footer が既定文言 → シーク文言へ遷移
- 幅変更: stripW 904 → 504 でも字幕テキスト 4 件すべて visible=true（allVisible=true）
- L0: build:ext exit 0 / lint exit 0
