# evidence: timeline-surface-v1（タイムライン面 v1・Wave 15a）

L1 検証（パッケージ相当ビルド + 生 CDP 実操作）の証跡。フィクスチャはオーナー実プロジェクト
（`test_1のコピー2` 相当）の複製を土台に、cuts 3個・overlays 2個・字幕短文/長文混在となるよう
`edit.json` を加筆したもの（`captions.json`/`review.json` は元の内容のまま。オリジナルは
複製元に一切書き戻していない）。動画は実際の素材（26.3秒・実文字起こし付き）。

検証環境: `npm run build`（production, 0 errors）でビルドしたバンドルを、隔離
user-data-dir + `--remote-debugging-port` で起動した Electron に対し、`playwright-core` の
`chromium.connectOverCDP` でアタッチし、実際の pointerdown/pointermove/pointerup をディスパッチ
して操作した（座標はレンダリング後の DOM `getBoundingClientRect()` から取得した実測値）。

## スクリーンショット対応表

| ファイル | 内容 | 対応する受け入れ条件 |
|---|---|---|
| 01-lanes-overview.png | ルーラー・クリップ帯（C1/C2/C3ラベル）・字幕帯（本文常時表示）・オーバーレイ帯（idラベル）・注釈ピンが一望できる状態 | L1-1, L1-2 |
| 02-clip-trim-drag-ghost.png | クリップ右端ドラッグ中。半透明のゴースト（破線枠）が実データと分離して表示され、実矩形は動いていない | L1-3, ゴースト規約 |
| 03-clip-reorder-result.png | クリップ本体ドラッグで配列順を入れ替えた直後。各クリップの source 秒位置は不変のまま、C1/C2/C3のラベル（=配列順）だけが再割当てされている | L1-4（データ層） |
| 04-caption-move-result.png | 字幕本体ドラッグ後。フッターに「字幕のタイミングを調整しました」 | L1-5 |
| 05-overlay-move-result.png | オーバーレイ本体ドラッグ（start移動）後 | L1-6 |
| 06-overlay-resize-result.png | オーバーレイ右端ドラッグ（duration変更）後 | L1-6 |
| 07-snap-guide-and-ghost-mid-drag.png | ドラッグ中の縦スナップガイド線（プレイヘッドと異なる色）とゴーストの共存 | L1-7 |
| 08-escape-cancel-no-change.png | ドラッグ中に Esc → ゴースト消滅・データ無変更（プレーンクリックとして時刻選択のみ発生） | L1-8（Esc） |
| 09-undo-result.png | 「元に戻す」クリック直後。直前の書き戻しが1件戻り、ボタンが再度無効化 | L1-8（undo） |
| 10-right-click-annotation-popup.png | タイムライン上を右クリックした位置にその場でテキスト入力ポップアップが出現 | 指示§4 |
| 11-right-click-annotation-added.png | ポップアップから注釈を追加した直後。ピンと一覧に反映 | 指示§4 |
| 12-resize-narrow.png / 13-resize-wide.png | ビューポート幅を 904px→684px→1584px と変えても各レーンが破綻しない | L1-10 |
| 14-microclip-rejected-warning.png | 0.15秒未満になるクリップトリムを試みて拒否・警告表示（データ無変更をコミット履歴で確認） | 操作共通規約（微小クリップ拒否） |
| 15-trim-fix-verified.png | 修正後の右端トリムで `in` フィールドが完全に不変（後述） | L1-3（diff精度） |

## 実測 diff（git show の抜粋。フィクスチャのローカル git 履歴より）

クリップ右端トリム（`out` のみ変更、`in` はバイト単位で不変）:

```diff
   "cuts": [
     { "in": 7.690022123893805, "out": 15 },
-    { "in": 17.0, "out": 24.0 },
+    { "in": 17.0, "out": 25.248048780487807 },
     { "in": 1, "out": 7.164424778761062 }
   ],
```

字幕本体ドラッグ（`start`/`end` が同じ delta（+1.08s）で移動・`edited: false→true`・他行は無変更）:

```diff
-  {"id":"c-0002","start":5.22,"end":8.28,"text":"頑張っておりました",...,"edited":false},
+  {"id":"c-0002","start":6.3,"end":9.36,"text":"頑張っておりました",...,"edited":true},
```

字幕端ドラッグ（`start` のみ変更・`end` 不変）:

```diff
-  {"id":"c-0003","start":8.28,"end":13.88,...},
+  {"id":"c-0003","start":7.406681415929203,"end":13.88,...},
```

クリップ順序入れ替え（配列順のみ変更・各要素のテキストは不変のまま位置移動）:

```diff
   "cuts": [
-    { "in": 1, "out": 7.164424778761062 },
     { "in": 7.690022123893805, "out": 15 },
-    { "in": 17.0, "out": 24.0 }
+    { "in": 17.0, "out": 24.0 },
+    { "in": 1, "out": 7.164424778761062 }
   ],
```

オーバーレイ移動（`start` のみ）/ 尺変更（`duration` のみ）:

```diff
-      "start": 10.0,
+      "start": 11.455530973451328,
       "duration": 4.0,
```
```diff
       "start": 11.455530973451328,
-      "duration": 4.0,
+      "duration": 5.164469026548673,
```

いずれも auto-git により操作1回につきコミット1個（`git log --oneline` で
`クリップをトリム` / `クリップの順序を入れ替え` / `字幕のタイミングを調整` /
`オーバーレイを移動` / `オーバーレイの尺を変更` が個別コミットとして記録されることを確認）。

## 発見した不具合と修正（往復2回目で対応済み）

`trimCutInSource`（`src/common/edit-store.ts`）が当初、ドラッグしていない側のフィールドも
無条件に `JSON.stringify()` で再書き込みしていたため、元の表記が `17.0` のような値だと
`17` に整形し直され、diff に無関係な変更として出てしまう不具合を実測で発見した
（`{"in": 17.0, "out": 24.0}` を右端だけトリム → `{"in": 17, "out": 25.24...}` になり `in` も
diff に乗った）。`readNumberProperty` で現在値を読み、`next* !== current*` のときだけ
該当トークンを書き換えるよう修正し、同じ操作を再実行して `in` がバイト単位で不変のまま
`out` だけが変わることを確認した（`15-trim-fix-verified.png` + 上記 diff）。
