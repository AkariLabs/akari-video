[English](./README.md) | **日本語**

# プレビュー文字編集中のキー隔離 L1

ビルド済み Electron と `fetch` / `WebSocket` 対応 Node で実行します。
既存の nudge/cycle/hover・複数選択 L1 の型に合わせています。

```sh
AKARI_CDP_PORT=9777 bash apps/shell/extensions/akari-preview/evidence/preview-edit-key-isolation-v1/scripts/run-l1.sh
```

launcher は使用中ポートを拒否し、一時 project/profile を作り、Theia の起動を待ち、
自分のプロセスと一時ディレクトリだけを片付けます。`ELECTRON_BIN` で実行ファイル、
`AKARI_EVIDENCE_DIR` で出力先を指定できます。ビルド・依存導入・コミットはしません。
起動済みの隔離アプリで検証する場合は、起動前に `scripts/prepare-fixture.mjs <workspace>`
を実行し、`<workspace>/project` を開いてから
`scripts/run-l1.mjs <port> <workspace> <output>` を実行します。
対照はアイテムを削除するので、実プロジェクトには実行しないでください。

fixture は「あいう」を持つ部品の葉と通常 HTML の葉を別トラックに置きます。
操作は CDP の実マウス・キー入力です。ホスト window の capture で keydown / keyup /
keypress と isTrusted を観測し、プローブからイベントを生成・消費しません。

1. 部品の葉を単クリックで選択し、タイムライン側の同時選択も確認してから、
   ダブルクリックで編集へ入ります。
   末尾で Backspace を打ち、「あい」・edit.json 不変・ホスト受信 0 件を要求します。
2. Space・c・f を打ち、「あい cf」・再生状態とツールモード不変・アイテム生存・
   ホスト受信 0 件を要求します。
3. 保存確認後、編集中でない通常の葉を選択して Backspace を打ちます。
   ホストの Backspace keydown が正確に 1 件で、葉が実際に削除されることを要求します。
   転送経路が観測できない場合は失敗です。
4. Enter により部品は source.text、通常 HTML は既存の書き戻し経路で保存されます。
   通常の葉も同じ単クリック選択確認とダブルクリックで編集へ入ります。
   削除で保存確認が隠れないよう、実行順は 1 → 2 → 4 → 3 です。

4 項目すべて成功した場合のみ exit 0。出力は run-log.json と手順・失敗時の画像です。
スクリプトの作成や構文検査だけで L1 成功とは扱いません。

回帰 L1 6 本は既存 runner を使い、出力を本ディレクトリ配下へ分けます。

各回帰専用の一時 workspace を既存 prepare-fixture.mjs で作成し、その workspace で
ビルド済みアプリを起動して、既存 run-l1.mjs に `<port> <workspace> <output>` を渡します。
P0（preview-part-text-edit-v1）と修飾キー（preview-modifier-keys-v1）は末尾に `after` も必要です。出力先には
preview-edit-key-isolation-v1/regression/<case> 配下の絶対パスを渡してください。
古い launcher の一部は AKARI_EVIDENCE_DIR を受け付けないため、既定値のまま使いません。
対象は P1（preview-drill-in-v1）・P0（preview-part-text-edit-v1）・修飾キー
（preview-modifier-keys-v1）・P1.5a（preview-drill-in-followups-v1）・P1.5b
（preview-nudge-cycle-hover-v1）・P4a（preview-multi-select-v1）の 6 本です。

Puppeteer 単体テストは、選択ツリー有無の両方で文字削除・入力・カーソル移動・全選択・undo・
Enter/Escape・blur と IME 素通しを検証します。

```sh
node --test packages/overlay-runtime/test-harness/edit-key-isolation-browser.test.mjs
```
