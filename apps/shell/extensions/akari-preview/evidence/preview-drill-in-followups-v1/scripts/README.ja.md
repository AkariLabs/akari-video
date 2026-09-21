[English](./README.md) | **日本語**

# プレビュー階層選択の仕上げ L1

ビルド済み Electron と、`WebSocket` / `fetch` を持つ Node で実行します。
スクリプト自身はビルドや依存導入をしません。

```sh
AKARI_CDP_PORT=9747 bash apps/shell/extensions/akari-preview/evidence/preview-drill-in-followups-v1/scripts/run-l1.sh
```

`ELECTRON_BIN` で macOS 実行ファイルのパスを変更できます。使用中のポートは拒否し、
起動を最大 600 秒待ちます。終了時は自身のプロセスと一時 workspace/profile だけを
片付けます。起動失敗時も FAIL ログを新しく書きます。

fixture は project-default と object-tree-html-bag の複製です。g1 を outer で包み、
子の表示を分離し、名札 3 個の全走査の袋 lazy を足します。調整と git 初期化は
使い捨ての複製内だけで行い、元 fixture とユーザー設定を変更しません。

CDP の実ポインター・キー入力で次の 4 項目を検証し、DOM/widget の状態を読み取ります。

1. 既定の畳み状態から g1.first を ⌘/Ctrl クリック。outer / g1 が開き、子行が選択され、
   タイムラインのフォーカスは root のままです。事前にトグルを押しません。
2. タイムラインの g1 をダブルクリックし、プレビューの子をクリックして Esc を 3 回。
   g1 で選択解除 → outer へ → root へ、1 打鍵ずつ進みます。
   各打鍵の前後で両 document のフォーカス・activeElement と shell の active/current widget を記録し、
   実際にフォーカスがあるプレビューまたはメインへ送信します。この 3 打鍵の間にクリックや
   フォーカスの取り直しは行いません。
3. lazy のマウント数が入る前 1 → 入ると 3 → plain を押すと 1 に戻ります。
   ダブルクリック・Enter・⌘/Ctrl クリックの 3 経路で繰り返します。
4. 明示子/exclude がある s01 は常に 2 マウントです。edit.json と HTML の指紋が一致し、
   選択操作でファイルを書き換えていないことも確認します。

各手順の前に、必要ならタイムラインの「全体」パンくずで root へ戻し、通常の shell 経路で
プレビューを開き直して試験時刻へシークし、plain のクリックと Esc で選択を解除します。
準備操作は別途記録し、step 1 の前に outer/g1 を展開しません。前手順が失敗しても
フォーカスの床や文字編集状態を次手順へ持ち越さない構成です。

出力はこの evidence ディレクトリの run-log.json と手順/失敗 PNG です。
4 項目とも通ったときだけ exit 0。既存 P1 / P0 / 修飾キーの回帰 L1 は別実行です。
起動済みの隔離アプリへ接続する場合は run-l1.mjs に
`<port> <workspace> <evidence-output>` を渡します。
構文だけの確認は各 mjs の `node --check` と launcher の `bash -n`。
テストで本番ソースから抜き出した文字列を実行しません。
