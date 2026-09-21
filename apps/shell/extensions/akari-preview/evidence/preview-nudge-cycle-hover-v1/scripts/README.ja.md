[English](./README.md) | **日本語**

# プレビューの nudge・循環・ホバー L1

ビルド済み Electron と `fetch` / `WebSocket` が使える Node で実行します。

```sh
AKARI_CDP_PORT=9757 bash apps/shell/extensions/akari-preview/evidence/preview-nudge-cycle-hover-v1/scripts/run-l1.sh
```

launcher は `preview-drill-in-followups-v1/scripts` の構成を踏襲します。
使用中ポートを拒否し、一時 workspace/profile を使い、Theia の起動を待って、
自身のプロセスと一時ディレクトリだけを片付けます。`ELECTRON_BIN` で実行ファイル、
`AKARI_EVIDENCE_DIR` で出力先を指定できます。ビルド・依存導入・git commit はしません。
起動失敗時も新しい FAIL の `run-log.json` を残します。

fixture は project-default と object-tree-html-bag の複製です。g1 を outer で包んで
子の表示位置を分離し、lazy な袋と同位置に重なる group 2 枚を追加します。
変更するのは複製だけです。次の 6 項目を CDP の実入力で検証します。

1. plain を選択し、→×3・Shift+↓×1。ライブ操作、アイドル前は書き込みなし、
   preview 書き込み 1 回、保存値 x +3 / y +10 を確認します。
   step 1・2 の nudge 中はメイン window の capture で Arrow の keydown/keyup が 0 件か検査し、`isTrusted` も記録します。
   step 1 後は選択解除して矢印を 1 打鍵送り転送経路を確認します。対照も 0 件なら未確認と記録し、0 件検査のみとします。
2. outer と lazy な袋でも繰り返し、それぞれ transform 書き込み 1 回を確認します。
3. 同位置のシングルクリック 3 回で手前 → 背面 → 手前を選択します。
4. 同位置のダブルクリックは手前の group に入り、その子を選択します。
5. group 外のホバーは可視子の union と一致し、選択対象には出ません。
   group 内では兄弟の葉に個別の枠が出ます。
6. 再生中の pointerdown で停止し、選択したら停止を維持します。
   空振りでも押下時は止まり、選択なしで操作が終わると再開します。

各ケースの前に必要ならタイムラインの「全体」へ戻し、プレビューを開き直して
1.5 秒へシークします。plain の実クリックと Esc で、タイムラインから復元された
選択を解除します。準備操作も各ケースに記録します。出力は evidence 内の
run-log.json と手順/失敗スクリーンショットです。6 項目すべて成功したときだけ exit 0。
計測は既存 overlayWrite の呼び出しを観測し、元の関数へそのまま委譲します。
本番ソースから抜き出した文字列を実行しません。起動済みの隔離アプリへ接続する場合は
run-l1.mjs に `<port> <workspace> <evidence-output>` を渡します。

P1（preview-drill-in-v1）・P0（preview-part-text-edit-v1）・修飾キー
（preview-modifier-keys-v1）・仕上げ（preview-drill-in-followups-v1）の回帰は、
各既存 fixture/runner を使います。既存 evidence を変更しないよう、各 run-l1.mjs の
出力先には本 evidence 配下の新しいディレクトリを渡します。

構文確認は両 mjs の `node --check` と launcher の `bash -n`。
ブラウザテストは `node --test packages/overlay-runtime/test-harness/nudge-cycle-hover-browser.test.mjs`。
