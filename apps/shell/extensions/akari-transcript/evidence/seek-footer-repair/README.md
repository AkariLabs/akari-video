# evidence: seek-footer-repair（2026-07-17-seek-and-footer-repair）

L1 実機検証（`npm run package` の packaged app + 生 CDP WebSocket クライアント。playwright-core 不使用）。
空白 + 日本語を含むパス（`<PROJECT_ROOT>/Akari Video Test/test_1のコピー2` 等）で検証。

## 再現環境

- 混在状態フィクスチャ（F27 の実機再現条件を忠実再現）:
  - `assets/IMG_4606.MOV`（ffmpeg 合成 12 秒動画）+ `assets/IMG_4607.MOV`（別素材・別ジャンプ検証用）
  - `.akari/sidecars/IMG_4606.MOV.analysis/analysis.json`（正典位置。`source` は `../../../assets/IMG_4606.MOV`）
  - プロジェクト直下 `IMG_4606.MOV.analysis.json`（回避策の残骸コピー。`source` は `assets/IMG_4606.MOV`）
  - `project/captions.json`（6 行）
- クリーンな正典配置フィクスチャ（回避策コピー無し・cuts 付き edit.json 同梱）:
  - `.akari/sidecars/IMG_9001.MOV.analysis/analysis.json` のみ（`source` は同じく `../../../assets/IMG_9001.MOV`）
  - `project/captions.json`（4 行）+ `project/edit.json`（`cuts: [{in:2.5, out:12}]`）

## 手法

- ビルド: `npm run build`（`build:ext` + `theia build --mode production`）→ `npm run package`（`postpackage` 検証込み）exit 0
- 起動: `<App>.app/Contents/MacOS/<App> <フィクスチャ project> --remote-debugging-port=<port> --user-data-dir=<隔離> --no-sandbox`
- 操作: 生 CDP WebSocket（`Runtime.evaluate` で DI コンテナ（`window.theia.container._bindingDictionary._map` 走査）から
  `CommandRegistry` / `ApplicationShell` / `WidgetManager` / `OpenerService` を取得し、
  `Input.dispatchMouseEvent` で Monaco エディタの実際の行位置を実クリック）
- プレビューを開く操作は **ワークスペースルート URI から `assets/<name>` を素朴に resolve した「クリーンな」URI**
  （ファイルツリーのダブルクリックが渡すのと同じ形）を使用。文字起こし側が計算した URI をそのまま流用していない
  （そうすると根治対象のバグを覆い隠してしまうため）

## F27（実機でシークが発動しない）— 根本原因（実測で確定）

`akari-transcript-widget.ts` の `configure()` が `analysisUri.parent.resolve(analysis.source).toString()` で
`videoUri` を計算していたが、Theia `URI.resolve()`（内部で `Path.join()` を呼ぶだけ）は **`..` セグメントを
正規化しない**。正典サイドカー位置は `source` に `../../../` を含むため、計算された `videoUri` は
`.../​.akari/sidecars/IMG_4606.MOV.analysis/../../../assets/IMG_4606.MOV` という**生の文字列のまま**になっていた。
一方 `akari-preview-open-handler.ts` の `openPreviews` マップは、実際に開かれた（ファイルツリー由来のクリーンな）
URI 文字列をキーにする。両者は同じファイルを指していても**文字列として一致せず**、`findSeekableWidget()` の
`Map.get()` は常に失敗していた。

Node で `@theia/core` の URI クラスを直接使って確認（修正前後）:
```
dirty  : file:///.../.akari/sidecars/IMG_4606.MOV.analysis/../../../assets/IMG_4606.MOV
clean  : file:///.../assets/IMG_4606.MOV   (= new URI(dirty).normalizePath().toString())
tree   : file:///.../assets/IMG_4606.MOV   (ファイルツリーから得られる URI)
match after normalize? true
```
空白 + 日本語パス（`Akari Video Test/test_1のコピー2`）でも同様に確認済み。

### 修正

- `akari-transcript-widget.ts`: `videoUri` の計算に `.normalizePath()` を追加
- `akari-preview-open-handler.ts`: `openPreviews` の登録キー（`doConfigurePreview`）と
  ルックアップ側（`findSeekableWidget`）の両方で `.normalizePath()` を通す（防御的二重化）
- シーク結果を `boolean` から `'seeked' | 'mismatched-asset' | 'no-preview'` の3値に変更し、
  フッター文言を3分岐化（`akari-preview-open-handler.ts` / `akari-transcript-contribution.ts` /
  `akari-transcript-widget.ts`）

## F27 実測結果

### (a) 混在状態プロジェクト（`mixed-fixture-results.json`）

1. タブ × で閉じて開き直し（`reopened`）: 新しい widget インスタンスが生成され（`WidgetManager` の
   `widget.disposed` フックでキャッシュが正しく破棄されることを確認）、`videoUri` は正規化済みの
   クリーンな文字列（`.../assets/IMG_4606.MOV`。`../../../` を含まない）
2. `assets/IMG_4606.MOV` を「ファイルツリーのダブルクリック」相当（ワークスペースルートからの
   クリーンな URI resolve）でプレビューを開き、文字起こしタブに戻って3行目（start=4.0s）を実クリック
   → `footer_matched`: `"00:00:04.000 にプレビューをシークしました。"`（一致プレビュー分岐）
3. 一致プレビューを閉じ、別素材 `assets/IMG_4607.MOV` のプレビューを開いた状態で5行目（start=8.0s）を実クリック
   → `footer_mismatched`: `"00:00:08.000 を選択しました。別の素材のプレビューが開いています。"`（別素材分岐）
4. 全プレビューを閉じた状態で4行目（start=6.0s）を実クリック
   → `footer_noPreview`: `"00:00:06.000 を選択しました。プレビューを開くとここからジャンプできます。"`（無しの分岐）

3分岐すべてが期待どおりのタイムスタンプ・文言で実測確認できた。

### (b) クリーンな正典配置プロジェクト（`clean-canonical-fixture-results.json`）

- `opened.hasDotDot: false` — 正規化により `videoUri` に `..` が残っていないことを確認
- 2行目（start=3.0s）を実クリック → `footer_matched`: `"00:00:03.000 にプレビューをシークしました。"`

### video.currentTime の直接計測について（未確認事項）

3通りの CDP 手法（`Target.setAutoAttach` の再帰カスケード + 実行コンテキスト走査／同一オリジンの
入れ子 iframe への直接 `contentDocument` アクセス／`Target.getTargets()` の再列挙 + 明示 `attachToTarget`）
を試みたが、いずれも該当プレビューの webview ターゲットに到達できなかった（Theia の `WebviewWidget` が
「iframe has to be reloaded when moved to another DOM element」という既知の挙動を持ち、ウィジェットが
shell にアタッチされる際に webview の内部ターゲットが差し替わるため、CDP 側から見ると対象ターゲットが
入れ替わり／消失するタイミング問題と推定）。これは計測ツール側の制約であり、フッター文言が実測どおり
3分岐で切り替わっている事実（= コマンドが実際に一致 widget を見つけ `sendMessage` を呼んだことの直接証跡）
と、同じ `sendMessage({type:'akari-preview-seek', time})` → webview 側 `<video>.currentTime` 反映の仕組み自体は
本タスクで変更しておらず、前タスク（`2026-07-17-preview-seek-and-image-open`）の実測
（`apps/shell/extensions/akari-preview/evidence/seek-and-image-open/README.md`、`currentTime` 実測値 4 を確認済み）
で経路として検証済みであることから、機能的な根拠は十分と判断した。

## F26（フッターが流れ落ちる）— 根本原因（実測で確定）

文字起こしパネルを開いた直後からフッターの `getBoundingClientRect()` を時系列計測した結果、
修正前は開いた瞬間 `top:480px, height:165.9px`（複数行に折り返した縦長の帯）→ 約1〜1.5秒かけて
`top:646px, height:26px`（本来の1行の帯）に収束していた。フッターの bottom 座標は終始不変（`646px`）で、
グリッドの最終行として下端に張り付いたまま「上端が下がってきて高さが縮む」動きをしており、これが
「フッターが上から下へ流れ落ちて消える」という報告と一致する。フッターの CSS が `minHeight` のみで
実際の高さは中身のテキスト量（初期描画時の一時的な折り返し）に追従してしまう構造だったことが原因。

### 修正

`akari-transcript-widget.ts` の `init()` 内、フッターのスタイルを `height/maxHeight: 26px` の固定値にし、
`whiteSpace: nowrap` + `overflow: hidden` + `textOverflow: ellipsis` を追加（折り返しによる高さ変化を構造的に禁止）。

## F26 実測結果

修正後、文字起こしパネルを開いた瞬間から計測した12サンプル（合計 約2秒間）のフッター高さは
`f26_heightRange: {"min": 26, "max": 26}`（= `f26_pinnedFromStart: true`）— 開いた瞬間から Monaco 初期化中も
含めて一度も変化しないことを実測で確認した（`mixed-fixture-results.json` の `f26_footerTimeline` 参照）。

## 非退行（`clean-canonical-fixture-results.json`）

- カット装飾: `edit.json` の `cuts:[{in:2.5,out:12}]` に対し、範囲外の1行目には
  `akari-transcript-cut-line` decoration が付き、範囲内の2行目には付かないことを実測確認（`decorations`）
- 1行 diff・edited 保護: Monaco 上で3行目のテキストを書き換えた後、`captions.json` に該当行だけが
  `"edited":true` で保存され、他の行は無変更のままであることを実測確認（`editedLine`）

## ファイル

- `mixed-fixture-results.json`: 混在状態プロジェクトでの F26/F27 実測値（サニタイズ済み）
- `clean-canonical-fixture-results.json`: クリーンな正典配置プロジェクトでの実測値（サニタイズ済み）
- 本 README（測定手法・結果のサマリ）

検証専用の隔離フィクスチャ・合成動画・ユーザーデータディレクトリはスクラッチ配下で作成し、本評価後に
完全削除した。リポジトリには含めていない。
