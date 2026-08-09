# preview-first-frame-and-space 検証記録

タスク: `2026-08-09-preview-first-frame-and-space`。「プレビューが開いた瞬間に 0 秒の絵を出す」
「スペースキーで再生/停止」の実機（Electron + CDP）検証記録。

## 手法

`docs/e2e-method`（同拡張内の先行検証群 `evidence/preview-audio-wiring` 等）が確立した二重
iframe 到達法（外側 `webview/index.html` ターゲットへ直接 CDP 接続 → `Page.getFrameTree` +
`Runtime.executionContextCreated` で内側 `active-frame` の実行コンテキストを特定）を踏襲。
`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` を隔離ワークスペース
（`ffmpeg -f lavfi testsrc2`/`color=blue` で生成した 5 秒の小さい実 mp4 2 本 + `edit.json` v1
2 ソース 2 カット）に対して直接起動し、`puppeteer-core`（本体 `apps/shell/node_modules` を
読み取り専用参照）で外側ウィンドウの Quick Open、生 CDP クライアントで内側 `active-frame` の
DOM/`<video>` 状態を直接読んだ。

- `run-first-frame-space-e2e.mjs`: 最初に書いた一括スクリプト（フォーカス誘導・quick-open・
  canvas 転写・スペーストグル・cuts 切替を一気通貫でやろうとしたもの）。**canvas 転写は
  `SecurityError: The canvas has been tainted by cross-origin data` で失敗する**
  （`#preview-video` の `src` はアプリ内部の配信オリジン経由で、同一ドキュメント内の
  `<canvas>.getImageData()` からは cross-origin 扱いになるため）ことが分かった記録として残す。
  司令塔の事前計測（`document.createElement('video')` を使った素の bare page テスト）が
  canvas 転写で実測できたのは、bare page 側でこの配信オリジン制約を踏んでいなかったため
  （本番の webview 内では踏む）
- `check-visibility.mjs`: 上記の反省を踏まえた単機能版。quick-open でファイルを開き、
  `#preview-video` の `readyState`/`computedStyle`（特に `visibility`）を直接読む
- `final-checks.mjs`: スペーストグル・テキスト入力中ガード・`cuts[].src` 切替の回帰確認

## 発見した原因（実機で特定済み）

`#preview-video` 自体は最初から正しく `readyState=4`（デコード完了）まで到達している
（司令塔の事前計測と一致）。しかし **`applyInitialPosition()` の一回性フラグが早期に
立ってしまい、`enterSegment(0)` が一度も呼ばれないまま `visibility: hidden` に固定される**
競合状態が実機で確認できた。

`previewBootstrapScript()` には `rebuildSegments()` + `applyInitialPosition()` を呼ぶ経路が
2 つある:

1. `video.addEventListener('loadedmetadata', ...)`: `video.duration` が確実に既知になった
   後に走る「正しい」経路
2. `Promise.all([captionFontReady, window.akari.runtime.mount(summary), sfxDurationsReady]).then(...)`:
   `loadedmetadata` を待たない。単体プレビュー（`EMPTY_SUMMARY`、オーバーレイ処理が
   ほぼ無い）はこの Promise チェーンが速く解決するため、**`loadedmetadata` より先に
   解決することがある**

修正前の `applyInitialPosition()`:

```js
const applyInitialPosition = () => {
    if (initialPositionApplied) return;
    initialPositionApplied = true;               // ← ここで即座にフラグが立つ
    if (Number.isFinite(initial.initialSeekTime)) {
        seekTimelineTime(initial.initialSeekTime);
    } else if (segments.length > 0) {             // ← このときまだ 0 件ならここへ来ない
        outputTime = segments[0].outStart;
        enterSegment(0);                            // ← 一度も呼ばれない
    }
};
```

経路 2 が先に解決すると、その時点の `rebuildSegments()` は `video.duration` 未確定（NaN/0）で
`segments = []` を作る。`applyInitialPosition()` は「何もしないまま」フラグを立てて終わり、
直後の `tick()`（同じ `.then()` 内で無条件に呼ばれる）が `applyCutsMuteState()` を実行し、
`segments[activeSegmentIndex]` が `undefined` であることから
`video.style.visibility = 'hidden'` を書き込む。後で `loadedmetadata` が発火して
`rebuildSegments()` が正しい 1 セグメントを作っても、`applyInitialPosition()` は
**すでに`initialPositionApplied === true`のため即 return** し、`enterSegment(0)`
（`video.style.visibility = ''` を書く唯一の経路）が二度と呼ばれない。ユーザーが再生ボタン/
スペースキーを押すと `startAnimation()` → `tick()` が回り出し、そこで初めて有効な `segment`
を見て `visibility` が復元される — これが「押すまで真っ黒」の実体。

出力プレビュー（`edit.json` 経由）は `overlays`/`captions`/素材解決などで経路 2 の
`window.akari.runtime.mount(summary)` にかかる処理が単体プレビューより重く、実測した
フィクスチャでは `loadedmetadata` が先に確定していたため症状が出なかった
（同じ競合状態は理論上どちらの経路にも存在する — 詳細は下記「実測結果」）。

## 修正

`apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts` の
`applyInitialPosition()` のみ変更（1 関数、フラグを立てるタイミングを「実際に
`enterSegment`/`seekTimelineTime` を呼べる」ことが確定してからに変更）:

```js
const applyInitialPosition = () => {
    if (initialPositionApplied || segments.length === 0) return;
    initialPositionApplied = true;
    if (Number.isFinite(initial.initialSeekTime)) {
        seekTimelineTime(initial.initialSeekTime);
    } else {
        outputTime = segments[0].outStart;
        enterSegment(0);
    }
};
```

`segments.length === 0` の間は関数を素通りさせるだけなので、経路 2 が先に解決しても
実害のある副作用（フラグの空振り）が起きない。経路 1（`loadedmetadata`）が後から
正しい `segments` で `rebuildSegments()` した直後に呼ぶ `applyInitialPosition()` が
今度こそ `enterSegment(0)` を実行し、`visibility` を復元する。

## 実測結果（前後比較）

実行ディレクトリ: `apps/shell/`。フィクスチャ: `ffmpeg -f lavfi` 生成の 5 秒 1280x720 mp4 2 本
（`testsrc2` / `color=blue`）+ `edit.json`（v1、2 ソース、`cuts:[{src:s1,0-2},{src:s2,0-2}]`）。
隔離ワークスペースは検証後に完全削除（コミット対象は本 README とスクリーンショット/ログのみ）。

### 修正前（`before/`）

- `01-raw-preview-before-play-BLACK.png`: 単体プレビューを開いた直後（play 未押下）。
  プレビュー領域が完全な黒。CDP 直接観測: `readyState: 4`, `videoWidth/Height: 1280/720`,
  **`visibility: 'hidden'`**, `opacity: '1'`, `zIndex: 'auto'`（デコード済みだが非表示）
- `02-output-preview-before-play.png`: 出力プレビュー（同じフィクスチャ）。このフィクスチャの
  タイミングでは競合状態が発生せず正常表示だった（後述「未確認事項」参照）
- `run-log.json`: canvas 転写が taint で失敗した記録、スペーストグルの実測値
  （`pausedBeforeSpace1: true → pausedAfterSpace1: false`）を含む

### 修正後（`after/`）

- `01-raw-preview-before-play-FIXED.png`: 同じ操作。プレビュー領域に実際のデコード済みフレーム
  （カラーバー）が表示される。CDP 直接観測: `readyState: 4`,
  **`visibility: 'visible'`**（修正前は `'hidden'`）、他の値は不変
- `02-output-preview-before-play.png`: 出力プレビュー。`visibility: 'visible'`,
  `zIndex: '-1'`（`enterSegment` 経由で明示的に負の z-index が付くが、visibility は
  正しく復元されており黒くならないことを確認）
- `03-raw-preview-after-space-play.png`: スペースキーで再生開始した直後のスクリーンショット
- `04-output-preview-cut-switched.png`: 出力プレビューで再生 → cut1(`s1`)→cut2(`s2`) の
  境界を越えて `<video src>` が実際に切り替わった直後のスクリーンショット

### スペースキー

`previewBootstrapScript()` にはスペーストグルの `keydown` リスナ自体は
**Wave 14（2026-07-18、commit `418bd80`）から既に存在**しており、`isEditable()` ガード
（`input`/`textarea`/`contentEditable` フォーカス時は無視）も実装済みだった。契約冒頭の
「webview 内の keydown リスナは Escape 系のみ」という前提は、本ブランチの実ソース
（`b8e50e8` 時点）には当てはまらないことを実機で確認した（司令塔の計測が別ビルド/別時点を
見ていた可能性がある）。実機で以下を確認（前後比較。数値は変更前後で同一 — この経路は
無改造なので変化しない想定通り）:

- 単体プレビュー: webview へフォーカスしてスペース押下 → `paused: true → false`
- 単体プレビュー: テキスト入力欄（`<textarea>`）にフォーカス中はスペースを押しても
  `paused` は変化しない（`pausedBeforeTypingProbe === pausedAfterTypingProbe`）
- 出力プレビュー: 同様にスペースで `paused` がトグルすることを確認
- 拡張ホスト側 `TOGGLE_OUTPUT_PREVIEW_PLAYBACK_COMMAND` とこの webview 内ハンドラは
  別経路（前者はタイムラインからの明示呼び出し、後者は webview 自身の `keydown`）であり、
  同一操作で両方が同時に発火する経路が無いため二重発火は起きない
  （コードレビューで確認。実機では「webview にフォーカスしてスペース」のみを検証した）

### 回帰

- `cuts[].src` 切替（v1 マルチソース）: cut1(`s1`) 再生 → 境界(t=2.0)で `<video src>` が
  `s1` の配信 URL → `s2` の配信 URL へ実際に切り替わり、そのまま `s2` を再生継続、
  総尺（`cuts[].out - in` の合計 = 4.0 秒）付近で自動停止することを確認（無改造の経路のため
  想定通り。修正した `applyInitialPosition()` は初回のみの関数であり、この切替ロジック
  （`enterSegment`/`applySegmentSource`）自体には触れていない）
- L0: `npm run build:ext` / `npm run lint` いずれも exit 0（`lint` の警告 5 件は変更前から
  存在する無関係ファイル — `LayerPerspective`/`readdir`/`rm`/`symlink`/`writeFile` の
  未使用インポート）

## 未確認事項

- **出力プレビュー側でこの競合状態を実機再現できていない**: 今回のフィクスチャ
  （2 ソース・オーバーレイ無し）では `window.akari.runtime.mount(summary)` の処理が
  `loadedmetadata` より遅く終わり、症状が自然に発生しなかった。コード上は
  `applyInitialPosition()`/`rebuildSegments()` の呼び出し経路が単体プレビューと完全に
  共通のため理論的には同じ競合の余地があり、修正はその共通コードに対して行った
  （出力プレビュー専用の分岐を作っていない）。より重い overlays/captions を持つ
  edit.json、または低速な素材解決で発生しやすくなる可能性がある一方、今回はそこまでの
  再現には至らなかった
- **キャンバス転写による画素平均の実測**: 契約が明示した「canvas 転写の画素平均」は
  webview 内の cross-origin 制約で実行できなかった（上記「手法」参照）。代わりに
  `getComputedStyle(video).visibility` の直接観測 + スクリーンショットを一次証拠とした
- 実際のスピーカー出力・タイムライン側 `TOGGLE_OUTPUT_PREVIEW_PLAYBACK_COMMAND` との
  同時実行競合の実機確認（コードレビューでの確認のみ、二重発火を意図的に誘発する実機テストは
  未実施）
