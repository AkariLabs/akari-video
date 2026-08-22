# 実 Electron L1 findings

## 証拠の扱い

5 症状の判定根拠は、実 Electron run `runs/2026-08-21T22-43-30-161Z` の `summary.json`、`observation.json`、`console.json`、実 DOM、スクリーンショットだけとする。この run は `status: PASS` で、5 症状すべてに `reproduced` または `not-reproduced` の判定がある。

`run-headless-cdp.mjs` は診断補助であり、製品の判定根拠には使わない。③の末尾に記す失敗時文言の潜在欠陥も、報告症状③の再現判定とは分離する。

## 判定表

| 症状 | 判定 | evidence run | 実 Electron の根拠 | 次の扱い |
|---|---|---|---|---|
| ② 字幕が出力プレビューに出ない | **reproduced** | `2026-08-21T22-43-30-161Z` | output 1.5で誤表示、output gap 3.5で消失 | `preview-caption-clock-unification` 起票材料あり |
| ③ 3Dが「3Dを読み込み中」で止まる | **not-reproduced** | `2026-08-21T22-43-30-161Z` | Runtime ready、fallback非表示、モデル200 | 報告症状の修正タスクは起票しない |
| ⑤ HTMLテロップの右側が切れる | **not-reproduced** | `2026-08-21T22-43-30-161Z` | 4時刻すべて `contentRight - clipRight < 0` | 現時点では起票しない |
| ⑥ テロップをタイムラインで選択できない | **reproduced** | `2026-08-21T22-43-30-161Z` | HTMLは成功、未焼成telopだけ実bundle例外 | ⑨と同じタスクへ統合 |
| ⑨ タイムライン更新時の`.split`エラー | **reproduced** | `2026-08-21T22-43-30-161Z` | 実通知一致、`at: 30 → 120`、実bundle stack | `unbaked-telop-selection-guard` 起票材料あり |

## 共通の再現手順

```sh
AKARI_INTERNAL_ASSETS_DIR=<ASSET_LIBRARY_ROOT> \
  node dev-fixtures/shell-field-report-repro/make-repro.mjs
node dev-fixtures/shell-field-report-repro/run-l1.mjs
```

`run-l1.mjs` は実 Electron PID を指定して終了し、隔離workspaceを削除する。各runの `summary.json` に5症状の判定と実値を保存する。

## ② 字幕が出力プレビューに出ない

### 判定

**reproduced**。

タイムライン側は字幕4件を正常に受理した。

```json
{
  "invalidCaptionWarning": false,
  "captionLaneEmpty": false,
  "captionIds": ["c-0001", "c-0002", "c-0003", "c-0004"]
}
```

実タイムラインDOMの字幕矩形:

| id | text | left | right | width | height |
|---|---|---:|---:|---:|---:|
| c-0001 | 残っている1本目の字幕 | 452.59375 | 476.03125 | 23.4375 | 32 |
| c-0002 | 出力gap数値の字幕 | 476.03125 | 499.46875 | 23.4375 | 32 |
| c-0003 | 削除区間をまたぐ字幕 | 499.4765625 | 569.8046875 | 70.328125 | 32 |
| c-0004 | 残っている2本目の字幕 | 569.8125 | 593.25 | 23.4375 | 32 |

c-0003だけが削除区間の前後を含む広い出力区間へ射影されており、タイムライン表示は出力軸である。

### 出力プレビューの実値

`actual` は `#caption-plate` から注入`style`文字列を除いた実字幕テキスト。

| name | outputTime | video.currentTime（source） | expected | actual | plate rect height |
|---|---:|---:|---|---|---:|
| first-retained | 0.5 | 2.5 | 残っている1本目の字幕 | 残っている1本目の字幕 | 291 |
| must-not-appear-before-gap | 1.5 | 3.5 | 空 | **出力gap数値の字幕** | 291 |
| cross-deletion-before | 2.5 | 4.5 | 削除区間をまたぐ字幕 | 削除区間をまたぐ字幕 | 291 |
| output-gap | 3.5 | 4.5 | 出力gap数値の字幕 | **空** | 0 |
| cross-deletion-after | 4.5 | 7.5 | 削除区間をまたぐ字幕 | 削除区間をまたぐ字幕 | 291 |
| second-retained | 5.5 | 8.5 | 残っている2本目の字幕 | 残っている2本目の字幕 | 291 |
| no-cue | 7.5 | 10.5 | 空 | 空 | 0 |

c-0002の宣言区間は`[3, 4)`。それがoutput 1.5 / source 3.5で表示され、output 3.5では表示されない。プレーン字幕のプレビュー当たり判定がsource時計を見ていることを実値で確認した。

### 真因

`apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts`:

- `renderCaption` 定義: **7752**
- source時計の取得: **7754** `video.currentTime`
- cueに`resolvedTimeline`があるかの判定: **7755**
- gapを無条件で`null`にする分岐: **7757–7758**
- `resolvedTimeline`がないときsource時計を当たり判定へ渡す箇所: **7759**

実測との対応:

- output 1.5では`video.currentTime = 3.5`。プレーンc-0002の`[3,4)`にsource時計でヒットするため誤表示する。
- output 3.5ではactive segmentがgapなので、7757–7758で字幕を無条件に`null`へ落とす。

### gap時に`video.currentTime = 4.5`のままになる理由

これはドライバ固有の副作用ではない。ドライバは実`#seek`へinputイベントを送り、製品の`seek` listener **8372–8375**を通る。そのlistenerは`seekTimelineTime` **7176–7197**を呼ぶ。

gapへシークすると:

- `timelineToSource` **7161–7174**は`{ kind: 'gap' }`を返す。
- `seekTimelineTime`はoutputTimeを3.5へ更新して`enterSegment`を呼ぶが、source時刻は代入しない（**7187–7195**）。
- `enterSegment`のgap分岐 **7061–7075**はvideoを停止・非表示にするが、`video.currentTime`を変更しない。

したがって4.5保持は製品のgap処理どおりであり、ドライバの誤シークではない。gapには対応するsourceフレームがないため、この保持値単独を別バグとは判定しない。字幕が消える直接原因は、保持値ではなく`renderCaption`のgap無条件null分岐である。

### 起票材料: `preview-caption-clock-unification`

- 目的: タイムラインと出力プレビューが同じ正規化済みoutput字幕区間を使い、gapを含む期待区間で字幕が一致するようにする。
- literalな指示:
  1. preview読込層で全字幕cueに明示的な時刻domainを確定し、render層へはoutput区間だけを渡す。render時に数値からdomainを推測しない。
  2. source-domain cueはカットmapでoutput区間へ射影する。output-domain cueは宣言output区間を保つ。現契約で区別できない場合は、実装前にdomain語彙を明示する最小契約を定める。
  3. `renderCaption`は正規化済みoutput cueを`outputTime`だけで検索する。
  4. gapでも正規化済みcueが覆う場合は表示し、active segmentのkindだけで無条件に消さない。
  5. このfixtureの7時刻を回帰テストと実Electron CDPの両方で固定する。
- ファイル境界:
  - 所有: `apps/shell/extensions/akari-preview/**`、必要最小限の`packages/edit-store/**`
  - 編集禁止: `apps/shell/extensions/akari-annotations/**`、`packages/overlay-runtime/**`、skills、harness
  - schema変更が必要なら先に境界拡張を起票し、このタスクへ黙って混ぜない。
- 受け入れ条件:
  - 上表7点で`actual === expected`。
  - 表示時のplate heightは`> 0`、空時は`0`。
  - output gap 3.5でc-0002が表示され、output 1.5では表示されない。
  - 左右シークを繰り返しても一瞬だけ誤表示しない。
- 既存4タスクとの境界:
  - `preview-writeback-v2`とpreview extensionの所有が衝突するため、その合流後に派遣する。
  - `caption-subrow-output-space`はタイムラインの段割りであり、このpreview当たり判定は直さない。
  - `timeline-track-discipline`、`overlay-resize-anchor-drift`との直接衝突はない。

## ③ 3Dが「3Dを読み込み中」で止まる

### 判定

**not-reproduced**。この素材とこのbuildの実Electronでは正常にreadyへ到達した。

### 実値

```json
{
  "runtimeStatus": "ready",
  "fallback": {
    "text": "3D を読み込み中",
    "hidden": true,
    "display": "none",
    "rect": { "width": 0, "height": 0 }
  },
  "canvas": {
    "cssWidth": 517.3333129882812,
    "cssHeight": 291,
    "bufferWidth": 517,
    "bufferHeight": 291,
    "display": "block"
  },
  "render": {
    "calls": 22,
    "triangles": 37629,
    "points": 0,
    "lines": 0
  },
  "resource": {
    "initiatorType": "fetch",
    "responseStatus": 200,
    "durationMs": 321.79999999701977
  },
  "consoleErrors": 0,
  "modelNetworkErrors": 0
}
```

Runtime memoryはgeometries 22 / textures 4、containerはvisible、canvas矩形は517.3333×291。報告症状の真因は、この再現projectからは得られないため書かない。

### 報告症状の起票材料

このrunだけを根拠にした3D読込修正タスクは**起票しない**。実際の失敗projectで`runtime.status`、fallback DOM、model response、console stackが得られた場合に、そのstackから別途起票する。

既存4タスクのどれかで直るという根拠もない。

### 別項目: 失敗時文言が変わらない潜在欠陥

これは症状③の再現判定とは別である。製品ソースと失敗を誘発した診断補助観測から、失敗時にもfallback文言が`3D を読み込み中`のまま残る事実がある。診断補助は製品症状の判定根拠には使わない。

`packages/overlay-runtime/src/three-runtime.js`:

- `setFallback` **1428–1433**は表示・非表示だけを変更し、文言を変更しない。
- 非同期load失敗 **1788–1809**はstatusをerrorにして`setFallback(container, true)`を呼ぶ。
- 初期化失敗 **1820–1824**も同じfallbackを表示する。

起票候補 `three-fallback-error-state`:

- 目的: loading / ready / errorをDOMで区別し、error時に読み込み中と表示し続けない。
- literalな指示: 3状態を明示し、両失敗catchでerror文言と`data-akari-3d-status="error"`を設定し、元のError stackをconsoleへ保持する。valid GLB / load失敗 / renderer初期化失敗をテストする。
- 所有: `packages/overlay-runtime/src/three-runtime.js`とpackage内テスト。
- 受け入れ条件: error時に文言が`読み込み中`を含まず、ready時はfallback hiddenかつdisplay none。
- 境界衝突: `overlay-resize-anchor-drift`がoverlay runtime全体を所有するため、その合流後に派遣する。ほか3タスクとは衝突しない。

## ⑤ HTMLテロップの右側が切れる

### 判定

**not-reproduced**。titleの全文`パッケージ版書き出し検証`が全時刻でDOMにあり、全サンプルでcontent rightはclip rightを超えていない。

### 実値

全サンプルの共通値:

- container: left 36.328125 / right 553.6614379882812 / width 517.3333129882812 / height 291
- row: left 60.578125 / right 245.78750610351562 / width 185.20938110351562 / height 20.208328247070312
- title width 139.15963745117188 / height 14.550003051757812
- computed clipPath: `inset(8.33333% 59.5117% 84.7222% -4.6875%)`
- clipRight: 245.7875887626343

| localTime | title left | title right | contentRight | clipRight | contentRight - clipRight |
|---:|---:|---:|---:|---:|---:|
| 0 | 58.127864837646484 | 197.28750228881836 | 245.78750610351562 | 245.7875887626343 | -0.00008265911867511022 |
| 0.15 | 100.56993103027344 | 239.7295684814453 | 245.78750610351562 | 245.7875887626343 | -0.00008265911867511022 |
| 0.3 | 106.62786865234375 | 245.78750610351562 | 245.78750610351562 | 245.7875887626343 | -0.00008265911867511022 |
| 1.0 | 106.62786865234375 | 245.78750610351562 | 245.78750610351562 | 245.7875887626343 | -0.00008265911867511022 |

負値はclip内側のサブピクセル余白であり、切断ではない。真因は書かない。

### 起票材料

現時点では修正タスクを**起票しない**。実際の失敗projectで`contentRight - clipRight > 0.5px`が取れた場合のみ、条件付き候補`overlay-hit-clip-animation-refresh`を使う。

- 目的: animation seek後の実content矩形とclip境界を一致させる。
- literalな指示: 同じ4時刻でtitle/row/clipを測り、正の超過が確認できた場合だけhit-region同期位置を修正する。毎frameの全DOM走査は追加しない。
- 所有: `packages/overlay-runtime/src/overlay-runtime.js`、`interaction.js`、package内テスト。
- 受け入れ条件: 全時刻で`contentRight - clipRight <= 0.5px`、全文DOM保持、hit領域の実寸制約を非回帰。
- 境界衝突: `overlay-resize-anchor-drift`の合流後に派遣する。ほか3タスクとは衝突しない。

## ⑥ テロップをタイムラインで選択できない

### 判定

**reproduced**。HTML overlayと未焼成telop layerで実機差が出た。

### HTML対照の実値

`simple-html`:

```json
{
  "attempt": 1,
  "hitItemId": "simple-html",
  "selected": ["simple-html"],
  "inspectorClipName": "simple-html",
  "runtimeExceptionCount": 0
}
```

`chapter-tag`は2回目で成功:

```json
{
  "attempt": 2,
  "hitItemId": "chapter-tag",
  "selected": ["chapter-tag"],
  "inspectorClipName": "chapter-tag",
  "runtimeExceptionCount": 0
}
```

`native-telop`は3回すべて同じ結果:

- kind: `layer`
- class: `akari-annotations-strip-layer akari-annotations-strip-layer-baked`
- hitItemId: `native-telop`
- selectedは直前の`chapter-tag`のまま
- inspector clip nameも`chapter-tag`のまま
- 各回で`Runtime.exceptionThrown`
- 計装した実引数typeは`undefined`

実bundle stack:

```text
TypeError: Cannot read properties of undefined (reading 'split')
    at lfn.pathBaseName (file://<WORKTREE>/apps/shell/lib/frontend/bundle.js:7932:23799)
    at prototype.pathBaseName (<anonymous>:17:29)
    at lfn.snapshotForSelection (file://<WORKTREE>/apps/shell/lib/frontend/bundle.js:7932:21429)
    at lfn.pushSelectionSnapshot (file://<WORKTREE>/apps/shell/lib/frontend/bundle.js:7932:19569)
    at lfn.applySelection (file://<WORKTREE>/apps/shell/lib/frontend/bundle.js:7932:5327)
    at HTMLDivElement.<anonymous> (file://<WORKTREE>/apps/shell/lib/frontend/bundle.js:7937:25468)
```

### 真因

`packages/edit-store/src/internal-model.ts`:

- 未焼成telopのdeclarationへ`src: item.source.baked`を置く箇所: **694–700**。bakedなしなのでsrcはundefined。
- そのdeclarationをlegacy layer viewへ運ぶ箇所: **969–976**。

`apps/shell/extensions/akari-annotations/src/browser/akari-annotations-widget.ts`:

- no-drag pointerupから`applySelection`を呼ぶ箇所: **6317**
- `applySelection`定義: **1441**。selection代入 **1454**、snapshot push **1455**、DOM class適用 **1456**。
- `pushSelectionSnapshot`定義: **2072**、snapshot呼出 **2092**。
- `snapshotForSelection`定義: **2106**、layer.srcを`pathBaseName`へ渡す箇所 **2168**。
- `pathBaseName`定義 **2250**、`.split`実行 **2251**。

例外はDOM class適用1456より前に発生するため、選択とインスペクターが前素材のまま残る。実stackとソースが一致する。

### 起票材料: `unbaked-telop-selection-guard`

- 目的: 未焼成telop layerを選択でき、pathを捏造せず安定したclip nameを表示できるようにする。
- literalな指示:
  1. 未焼成telop snapshotではsrcをoptionalとして扱う。
  2. clipNameはnon-empty src、なければpreset、なければidの順で決める。
  3. inspectorのためだけにfake pathやbaked cacheを作らない。
  4. HTML overlay / baked telop / unbaked telopを比較する単体テストを追加する。
  5. 実Electronでnative-telopのselected id、inspector clip name、例外0件を確認する。
- ファイル境界:
  - 所有: `apps/shell/extensions/akari-annotations/src/browser/akari-annotations-widget.ts`、`timeline-selection-model.ts`、extension内テスト。
  - 編集禁止: preview extension、overlay runtime、edit-store、schemas、skills、harness。
- 受け入れ条件:
  - 1回のクリックでselected idが`native-telop`。
  - inspector clip nameが`ref3_name_rounded`または`native-telop`。
  - `Runtime.exceptionThrown`と計装errorが0件。
- 既存4タスクとの境界:
  - `timeline-track-discipline`と`caption-subrow-output-space`が同じwidgetを所有する。両者の既定順に従い、両方の合流後に派遣する。
  - `preview-writeback-v2`、`overlay-resize-anchor-drift`とは直接衝突しない。

### 独立項目: chapter-tag初回クリックの選択ずれ

chapter-tagのattempt 1は、クリック直前の実値が次のとおりだった。

```json
{
  "rectTop": 751.5234375,
  "rectBottom": 783.5234375,
  "centerY": 767.5234375,
  "hitItemId": "chapter-tag",
  "selectedAfter650ms": ["laptop-3d"],
  "inspectorClipName": "laptop-3d",
  "runtimeExceptionCount": 0
}
```

attempt 2は同一矩形・同一hitItemIdで`chapter-tag`を正常選択した。観測にはpointerdown/pointerup時点のevent.target、選択同期イベントの順序、650ms内の中間selectionがないため、単なる再レイアウトか製品の選択同期raceかを**判定できない**。ただし矩形とpre-click hitが2回で同一なのに結果だけ異なるため、製品側の初回選択raceの疑いは残る。

起票候補 `timeline-html-first-click-selection-race`:

- 目的: HTML overlayの1回目クリックが別レーン素材へ化ける可能性を切り分ける。
- literalな指示: pointerdown/pointerupのclient座標・event.target item id、`applySelection`直後、preview→timeline selection同期イベント、最終selected idを時系列で記録する。chapter-tag / simple-htmlを各20回交互にクリックする。
- ファイル境界: 調査時は`apps/shell/extensions/akari-annotations/**`と`apps/shell/extensions/akari-preview/**`を読み取り。修正所有は真因側の一方だけに限定する。
- 受け入れ条件: 20/20回でpointer target、selected id、inspector clip nameが一致し、別レーンへ移らない。
- 境界衝突: 調査は`timeline-track-discipline`、`caption-subrow-output-space`、`preview-writeback-v2`の合流後に派遣する。`overlay-resize-anchor-drift`とは衝突しない。

## ⑨ タイムライン更新時の`.split`エラー

### 判定

**reproduced**。

### 実値

```json
{
  "beforeAt": 30,
  "afterAt": 120,
  "notice": "タイムラインを更新できません: Cannot read properties of undefined (reading 'split')",
  "selected": ["native-telop"],
  "pathArgumentType": "undefined"
}
```

実DOMでは移動後のnative-telopに選択枠があり、同時にtimeline内noticeと右下エラー通知が表示された。ドラッグ書き込み自体は成立し、その後のreloadで失敗している。

実bundle stack:

```text
TypeError: Cannot read properties of undefined (reading 'split')
    at lfn.pathBaseName (file://<WORKTREE>/apps/shell/lib/frontend/bundle.js:7932:23799)
    at prototype.pathBaseName (<anonymous>:17:29)
    at lfn.snapshotForSelection (file://<WORKTREE>/apps/shell/lib/frontend/bundle.js:7932:21429)
    at lfn.pushSelectionSnapshot (file://<WORKTREE>/apps/shell/lib/frontend/bundle.js:7932:19569)
    at lfn.reloadEdit (file://<WORKTREE>/apps/shell/lib/frontend/bundle.js:7933:16258)
    at async lfn.commitEditMutation (file://<WORKTREE>/apps/shell/lib/frontend/bundle.js:7937:1655)
    at async lfn.commitEditV2Drag (file://<WORKTREE>/apps/shell/lib/frontend/bundle.js:7937:47915)
    at async lfn.commitDrag (file://<WORKTREE>/apps/shell/lib/frontend/bundle.js:7937:42540)
```

### 真因

⑥と同じundefined layer.srcである。`commitDrag`定義 **7109** は非captionを`commitEditV2Drag`へ渡す **7116–7117**。`commitEditV2Drag`定義は **7178** で、書き込みをawaitする箇所は **7292**。書き込み後、`reloadEdit`定義 **3163** からselection snapshotを再構築する **3219** へ進み、`snapshotForSelection:2106`、`pathBaseName(layer.src):2168`、`path.split:2251`で落ちる。`commitEditV2Drag`のcatchは **7296–7299** で実DOM通知へ変換する。

### 起票材料

⑥と同じ`unbaked-telop-selection-guard`へ統合する。別タスクにすると同じファイル・同じ根へ二重修正を入れるため起票しない。

追加の受け入れ条件:

- 実dragでraw v2 `at`が変わり、reload後も保持される。
- `タイムラインを更新できません`通知が出ない。
- reload後もnative-telopが選択され、clip nameがnon-empty。
- 実bundle stackに`.split`例外がない。

派遣順と境界衝突は⑥と同じ。
