[English](./README.md) | **日本語**

# プレビュー複数選択 L1

使い捨てのプロジェクト複製と隔離 profile 上で Electron/CDP の実ポインタ・実キー入力を使う。`run-log.json` とスクリーンショットをこのディレクトリ（または `AKARI_EVIDENCE_DIR`）へ保存する。ラッパーの実行用に用意したスクリプトであり、存在だけでは L1 成功を意味しない。

現在の edit-store、preview-server のランタイムバンドル、shell をビルドして実行する。

```sh
npm --prefix packages/edit-store run build
npm --prefix packages/preview-server run build
npm --prefix apps/shell run build
bash apps/shell/extensions/akari-preview/evidence/preview-multi-select-v1/scripts/run-l1.sh
```

`AKARI_CDP_PORT` の既定は `9758`。`ELECTRON_BIN` で macOS Electron の実行ファイルを変更できる。起動済みポートへの接続は拒否し、自分が起動したプロセスと一時ディレクトリだけを片付け、起動失敗も記録する。元プロジェクトは変更しない。`scripts/prepare-fixture.mjs <empty-workspace>` は 1.5 秒時点で重ならないルートの兄弟 3 枚と、葉 1 枚を持つ group を、それぞれ別の visual トラックに作る。fixture 単体テストでは実際にプロジェクトを準備し、3 件の transform バッチを解決して、元文書と候補文書の両方を edit-lint で検査する。

8 シナリオで以下を検査する。

1. Shift 加算、union 枠の実寸、各メンバーの選択印、拡縮ハンドルなし。
2. 3 枚目の加算と解除。
3. 3 件のドラッグ、保存値の同量移動、ホストの batch メッセージ 1 回・単発 0 回・lint 1 回・edit.json の実書き込み 1 回。
4. 右 × 3 と Shift+下で全員が +3/+10 移動し、アイドル後にバッチ 1 回で保存。
5. Shift+深い選択で別スコープへ入ると集合を置換。そのスコープ外への通常の Shift クリックも置換。ルートから入れ子の葉を普通に押す場合は既存規則どおり group を選ぶ。
6. Esc で最後に加えた代表へ畳み、次の Esc で解除。
7. ダブルクリックで 1 件に絞ってから文字編集または group 内へ入る。
8. 実ホストの lint サービスへ一度だけ不正な候補文書を渡し、`references.files` の拒否、全員のライブ位置復帰、edit.json のバイト一致を検査。

ホストのプローブは既存ハンドラと file service へ処理を委譲する。preview service 自体を委譲ラッパーへ置き換え、`lintEditCandidate` だけを包み、ほかのメンバーは元の JSON-RPC service を受け手として委譲する。装着時と計測開始ごとに service と関数の同一性を検査し、装着時の結果をイベントログへ記録する。batch / 単発メッセージ、read / lint / write 回数、実際の lint 結果を観測する。シナリオ 8 では lint リクエストの候補文書だけを変更し、item c の参照先を `overlays/__l1_missing_c__.html` にする。元のサービスで本物の検査を行い、`references.files` のエラーを必須とする。失敗結果は偽造せず、プローブは入力バッチ・プロジェクト内のファイル・候補内のほかの item を変更しない。成功後は file watcher の read が総 read 数に加わる場合がある。構造単体テストで batch ハンドラ自体の read が 1 回であることも検査する。検査対象の選択ジェスチャーには常に CDP 実入力を使い、準備用コマンド・seek・プローブ・状態読取は計測用とする。代表の型 `string | null` を保ち、新しい `selectedIds` と `selectionKind` getter も検査する。

同じ現在のビルドで、以下の既存 L1 を別途実行する。全て exit 0 が必要。このランナーは回帰を暗黙に成功扱いしない。

```sh
for suite in preview-drill-in-v1 preview-part-text-edit-v1 preview-modifier-keys-v1 preview-drill-in-followups-v1 preview-nudge-cycle-hover-v1; do
  bash "apps/shell/extensions/akari-preview/evidence/$suite/scripts/run-l1.sh" || exit "$?"
done
```

対象の単体検査（ブラウザテストには headless Chrome が必要）:

```sh
node --test packages/edit-store/test/preview-item-write-batch.test.mjs packages/overlay-runtime/test-harness/selection-scope.test.mjs packages/overlay-runtime/test-harness/multi-selection-browser.test.mjs apps/shell/extensions/akari-preview/test/preview-overlay-write-batch.test.mjs apps/shell/extensions/akari-preview/test/preview-multi-select-fixture.test.mjs
```
