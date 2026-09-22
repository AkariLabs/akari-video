[English](./README.md) | **日本語**

# 字幕ドラッグ・拡縮・回転 L1

ラッパーがビルドと Electron 実行を担当する。リポジトリのルートから修正前の bundle で `before`、修正後の bundle で `after` を実行する。

```sh
bash apps/shell/extensions/akari-preview/evidence/preview-caption-drag-rotate-v1/scripts/run-l1.sh before
bash apps/shell/extensions/akari-preview/evidence/preview-caption-drag-rotate-v1/scripts/run-l1.sh after
```

ランチャーは `preview-caption-handles-v1` の型を継承し、CDP ポート（既定 9768）の空き確認、隔離 fixture とプロファイルの用意、Electron 起動、自分のプロセスと一時ファイルの片付けを行う。既存 CDP ヘルパーを import し、実際のマウス入力を使う。`ELECTRON_BIN`、`AKARI_CDP_PORT`、`AKARI_FFMPEG` で上書きできる。fixture は 0.5 秒に重複字幕 2 件、3 秒に字幕 1 件を置き、既存の edit-lint ゲートで検査する。fixture だけの検査は `prepare-fixture.mjs <一時ワークスペース> --lint-only` を使う。

両モードは 7 ステップを記録する。c-0001 は scale 1.25 のあと Shift 回転を 2 回連続して 30 度にし、直後の本体ドラッグで位置だけを変える。c-0002 は拡縮直後の本体ドラッグ、c-0003 は本体ドラッグ直後の回転を調べる。各保存の応答とディスク反映を待ち、操作中の `akari-preview-captions-update` を観測する。観測器は受信 payload と受信時点のモデル値を記録する。次のハンドル操作や本体ドラッグの前に `window.akari.previewCaptions` と保存済みファイルを比較し、自然に stale かを記録する。既に追いついていた場合は、該当 cue のメモリ上の変形値だけを旧値へ戻す。表示 DOM と保存ファイルは変えず、元の競合と同じ stale model を作る。注入した場合は明示して記録し、自然発生とは扱わない。さらに `captionWrite` を透過的に包み、実際の送信 patch と呼び出し時点のモデル値を記録する。`before` は旧 `plateTransform` payload と値の消失、`after` は位置だけの payload と値の保持を要求する。異なる bundle、stale model 準備の失敗、再現なし、未実行は PASS にしない。

webview はランナーのゲートより先に字幕更新用の `window` message リスナーを登録している。実測では `modelBeforeBlock` がすでに `blockedPayload` と一致しており、ゲートは 8 件を記録したものの、モデル更新の後に実行されていた。したがって遮断件数だけでは stale model の証拠にならない。`before` で連続回転の旧ベースラインを確認した後は、モデルの開始角を DOM の表示角に揃え、最大 4 回まで保存値と表示値を読みながら 30 度へ補正する。両方が 30 度になった場合だけ step 4 に進む。

`../run-log-before.json` と `../run-log.json` に text_style の実測値、保存応答、seek、ゲート、コマンドを記録する。スクリーンショットは `before-*` / `after-*` で分ける。既存の `preview-caption-handles-v1` (1)〜(7) と `preview-modifier-keys-v1` はラッパーが別途実行する。
