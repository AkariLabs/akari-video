# 単体側の確認

- `node packages/edit-store/scripts/gen-types.mjs` と `npx tsc -b packages/edit-store packages/frame-engine apps/shell/extensions/akari-preview --pretty false`: exit 0。
- `node --test packages/schemas/test/photo-regions-schema.test.mjs packages/schemas/test/engine-capabilities.test.mjs`: 9 / 9 通過。
- `node --test packages/edit-store/test/photo-regions-v1.test.mjs`: 1 / 1 通過（検証・canonical の往復）。
- `node --test packages/frame-engine/test/photo-regions.test.mjs packages/frame-engine/test/photo-mask.test.mjs`: 12 / 12 通過（人物 1 の露出と背景のモノクロ、ぼかし、マスクのなめらかさ、書き出し用の範囲マスク参照を含む）。
- `node --test apps/shell/extensions/akari-annotations/test/photo-instance-hit.test.mjs apps/shell/extensions/akari-annotations/test/photo-panel-state.test.mjs apps/shell/extensions/akari-annotations/test/photo-response-state.test.mjs apps/shell/extensions/akari-annotations/test/photo-segmentation-fail-soft.test.mjs`: 8 / 8 通過（プレビューの候補ヒット、「自動」から人物 1 への切替・再押下で解除、追加後の選択状態、古い応答、補助なし、モデル取得失敗、候補キャッシュの分離）。
- `node --test apps/shell/extensions/akari-annotations/test/inspector-tab-model.test.mjs apps/shell/extensions/akari-annotations/test/ai-tab-shell.test.mjs apps/shell/extensions/akari-annotations/test/ai-transcribe.test.mjs`: 80 / 80 通過（編集タブの既存の節・表示語彙）。
- Swift 3 ファイルの `swiftc -parse-as-library -swift-version 5 -typecheck`: exit 0。
- `swiftc -parse-as-library -swift-version 5 apps/shell/native/photo-sam-server.swift apps/shell/native/photo-sam-server.test.swift` で作った単体実行体: exit 0。ロジットを双線形で拡大してから二値化する結果と、EXIF 向きの付いた写真の寸法を確認。
- 変更した拡張ソースの個別 eslint: exit 0。
- `npx tsc -p apps/shell/extensions/akari-annotations/tsconfig.json`: exit 2。変更していない読み上げ 2 箇所と声の複製 2 箇所の `Uint8Array<ArrayBufferLike>` / `ArrayBuffer` 型不一致のみ。今回のファイルの診断は 0 件。
- `node --test packages/edit-lint/test/fieldreport-bundle.test.mjs`: 2 / 2 通過。スキーマ側と同梱用の対応表を byte 一致に同期。
- Electron の起動、theia build、拡張全体ビルド、GPU / OSR の実書き出しはこの単体側では実行していない。L1 はラッパー側の検証対象。

## 2 往復目の回帰修正後

- `npx tsc -b packages/edit-store packages/frame-engine` → `npm run bundle:webview --prefix packages/edit-store`: exit 0。`npx tsc -b apps/shell/extensions/akari-preview`: exit 0。
- 失敗していた edit-store の `cut-audio-split-vocab` / `geometry-normalization`: 23 / 23 通過。既存 70 fixture の canonical バイト互換も通過。
- 失敗していた frame-engine の `timeline.test.mjs`: 32 / 32 通過。
- preview の caption 系 5 ファイル: 56 / 56 通過。cut の pointer リスナーを caption ハーネスの切り出し範囲外へ移した。
- `node --test test/*.test.mjs`（edit-store）: 976 / 976 通過。
- `node --test test/*.test.mjs`（frame-engine）: 604 件中 598 通過・4 スキップ・2 失敗。失敗は既知の `preview-audio-supply` の音声 2 件だけ。
- `node --test test/*.test.mjs`（schemas）: 533 件中 532 通過・1 スキップ・失敗 0。
- `node --test test/*.test.mjs`（edit-lint）: 348 / 348 通過。
- preview は検証用に `npm run bundle:frame-engine --prefix apps/shell/extensions/akari-preview` で生成物を再生成してから `node --test test/*.test.mjs`: 1528 / 1528 通過。再生成前の `frame-engine-preview` は追跡 bundle と変更した source の byte drift で失敗した。生成物はソースの成果物に含めない。
- `npx tsc -b apps/shell/extensions/akari-annotations`: exit 1。診断は変更していない読み上げ 2 箇所・声の複製 2 箇所の既知の型不一致だけ。新規診断 0。
- `node --test test/*.test.mjs`（akari-annotations）: 再実行で 2373 件中 2370 通過・3 失敗。失敗は vendored ffmpeg 不在の実 widget、vendored ffprobe 不在の frame RPC、既知の media-cache-waveform の 3 件。初回実行では時間制限を測る `ai-still-routes` が追加で 1 件失敗したが、単独実行と全体再実行では通過した。

## L1 実機指摘への修正後

- 写真をプレビュー上で選ぶ間と消しゴムでなぞる間だけ、選択枠に入力用クラスを付ける。通常時の `pointer-events: none` を維持し、選択枠の CSS 優先順位とクリック・ホバー・ブラシの入口を単体テストで固定。窓から消しゴムへ移る際もブラシの十字カーソルを保持。
- 背景エリアは前景の候補 PNG をそのまま確定し、region の `invert: true` だけで反転。人物 1 の露出と背景のモノクロが別々の画素に掛かることを、窓と widget が使うパッチ生成の純関数を通して確認。背景透過の「人物以外」は合成時の反転を維持。
- 窓の座標をインスペクターの矩形から決め、`left` と `right: auto` を明示。右側の矩形へ収まることを単体テストで確認。LUT の選択肢は共通の表示名関数を使い、同梱カタログの名前との一致を確認。背景透過の適用後は窓を維持して「適用しました」を表示。
- `npx tsc -b packages/edit-store packages/frame-engine apps/shell/extensions/akari-preview --pretty false`: exit 0。
- `npx tsc -b apps/shell/extensions/akari-annotations --pretty false`: 既知の読み上げ 2 箇所・声の複製 2 箇所の型不一致のみ。今回変更したファイルの診断 0 件。
- 写真の入力モード・選択パッチ・配置・LUT 表示名と関係する preview / annotations / frame-engine / edit-store の 7 ファイル: 35 / 35 通過。LUT カタログ名の同期テストを追加後、annotations の関係 2 ファイル: 19 / 19 通過。
- preview `node --test test/*.test.mjs`: 1529 / 1529 通過。
- annotations `node --test test/*.test.mjs`: 2375 件中 2372 通過・3 失敗。既知の vendored ffmpeg 不在、vendored ffprobe 不在、media-cache-waveform のみ。最後に足した LUT 同期テストは単独で通過。
- edit-store `node --test test/*.test.mjs`: 検証用の `npm run bundle:webview --prefix packages/edit-store` による再生成後、976 / 976 通過。再生成前は追跡 bundle のバイト差で supply-chain の 1 件が失敗した。
- frame-engine `node --test test/*.test.mjs`: 604 件中 598 通過・4 スキップ・既知の音声 2 件のみ失敗。
- 変更した拡張ソース 6 ファイルの個別 eslint: exit 0。`git diff --check`: exit 0。
- 最後のカーソル保持修正後、preview 個別 tsc・関係 2 テスト・該当ソースの eslint と `git diff --check` はすべて通過。
- Electron と theia build は単体側では起動していない。生成物は検証用に再生成し、追跡差分を戻した。L1 側では再生成してから実機確認する。
