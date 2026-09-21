[English](./README.md) | **日本語**

# プレビュー部品文字編集 L1 スクリプト

タスクの指示 1（BEFORE）と 6（AFTER）を担当するスクリプトです。ビルド済みの
Electron アプリと、グローバル `WebSocket` / `fetch` を持つ Node で実行します。
ビルド・依存のインストール・製品 src の変更は行いません。
共有の `packages/edit-store/lib/canonical.js` が生成済みである必要があります。

```sh
bash apps/shell/extensions/akari-preview/evidence/preview-part-text-edit-v1/scripts/run-l1.sh before
bash apps/shell/extensions/akari-preview/evidence/preview-part-text-edit-v1/scripts/run-l1.sh after
```

モード引数は必須です。`AKARI_CDP_PORT` の既定は **9747**。
`ELECTRON_BIN` で macOS 用既定実行ファイルを上書きできます。起動スクリプトは
使用中ポートを拒否し、Electron / Theia の準備を最大 600 秒待ち、自分が起動した
Electron PID と一時ワークスペース・ユーザーデータだけを後始末します。
起動失敗でも新しい FAIL ログを書き、runner の終了コードを返します。
プロセス名による一括終了や既存プロジェクトの変更は行いません。

`prepare-fixture.mjs <workspace>` は `<workspace>/project` を作り、既存 project の
置き換えを拒否します。P1 と同じく `templates/project-default` の複製へ
`object-tree-html-bag` を重ね、canonical edit.json と空の review.json を書き、
**使い捨て複製内だけ**で Git の初期化・初期コミットを行います（hooks / 署名は無効）。
レイアウトの変更は `s01.B.transform.y = 40` だけです。
**0.5 秒 / 15 フレーム**では A / B / C / plain の文字領域が重ならず、
無関係な `g1` は 30 フレーム開始なのでまだ出ません。ID・HTML のバイト列・
袋の `exclude: ["C"]`・明示子 B・走査だけの A の区別は保ちます。
元 fixture と P1 evidence は読み取り専用です。

4 ケースのそれぞれで初期コミットに戻します。プレビューを閉じ、
`git restore --source=HEAD --staged --worktree -- .` と `git clean -fd` を実行し、
初期ハッシュを照合してから `akari.preview.ensureVisible` で新しく開きます。
fixture に対する checkout / clean と同等で、ステージ済み変更も戻します。
Git 復元は使い捨て project のリポジトリ内に限定します。操作後も改めて
プレビューを再構築するため、あるケースでの破壊を次のケースへ持ち越しません。

操作順:

1. 袋から出した `s01.C` → `L1-C-new`。
2. 袋の中の明示子 `s01.B` → `L1-B-new`。
3. 走査だけの `s01#A` → `L1-A-new`。
4. 通常 HTML `plain` → `L1-plain-new`。

検証対象の操作は、既存の
`akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs` を使った CDP Input
です。⌘／Ctrl クリックで P1 の深い選択から部品に到達し、ダブルクリックで文字編集に
入ります。⌘／Ctrl+A で既存文字を全選択（選択内容も検査）し、`Input.insertText` で
新しい文字を入力、Enter で確定します。フォーカス・編集要素の所属・ヒット領域の
非重複を検査します。既存 P1 の interaction getter を読むだけで状態を書き換えたり
API を追加したりしません。0.5 秒への seek input と通常の Theia 開閉コマンドは
準備にだけ使います。ハーネスから write メッセージを直接 post しません。

P1 と同じ透過 `engine.overlayWrite` ラッパーで、送信境界の引数をそのまま記録します。
type・overlay ID・完全な patch・`hasHtml` / `hasText`・HTML の先頭 200 文字を含みます。
元の `this`・引数・Promise を保って委譲します。実際の受信
`akari-preview-overlay-write-response`（requestId・ok / error を含む）は
message listener で記録します。requestId はラッパー通過後に engine が生成するため、
送信引数の記録に架空の requestId は足しません。Runtime binding により
プレビュー破棄後もイベントを Node 側に保持します。

各ケースで両 HTML の前後 SHA-256・バイト長・先頭 200 バイト（UTF-8 表示と
欠損のない数値バイト配列）、パース済み edit.json・`git diff HEAD -- edit.json`、
操作直後および再構築後の DOM を記録します。DOM 証跡には対象 textContent と
**各部品自身の mount** 内の A / B / C の computed visibility、さらに全クローンの
兄弟要素を含めます。正常なクローンマスクで隠れる兄弟を、本人の mount が壊れた
ものと混同しません。BEFORE ログがあれば AFTER は fixture のハッシュも照合します。

BEFORE は観測だけです。共有 card が変化しシリアライズ済みマスクを含めば
`reproduced`（再現成功）と記録します。操作を完遂していれば `not-reproduced` でも
観測成功で、応答 `ok:false` もそのまま残します。本人の mount が hidden になった
部品は実害として別途記録します。BEFORE の exit 1 は起動・準備・入力・観測の
失敗時だけです。

AFTER はケースごとに `ok` / `ng` を判定します。部品ケースでは card / plain の
不変、成功応答を伴う text のみの write 1 件、対象 `source.text` の保存、
それ以外の edit.json の不変（文書全体比較と resolver の既存 `JSON.stringify`
形式によるバイト比較）を要求します。
走査 A は P1 規則の明示子 `s01.A`（`source.part: "A"`、`at: 0`、袋と同じ duration /
path、新しい text）になります。再構築後の対象文字が一致し、3 部品自身の表示が
visible であることも必要です。plain は plain.html のハッシュ変化と新文字保存、
card.html / edit.json の不変、再構築後の文字一致を確認します。4 ケースすべての
成功で exit 0 です。各部品は文字要素 1 個なので、文字要素が複数ある場合の
保存拒否・復元・エラー表示はこの fixture の判定対象外です。

出力は scripts の 1 つ上に `run-log-before.json` または `run-log.json`、
モードを接頭辞にした初期状態・編集中・再構築後・失敗時の PNG を置きます。
AFTER は BEFORE 証跡を上書きしません。ログは status・ケースごとの観測・
生イベント・失敗詳細を含み、ケース失敗後も次のケースへ進みます。

構文だけの確認（アプリは起動しません）:

```sh
node --check apps/shell/extensions/akari-preview/evidence/preview-part-text-edit-v1/scripts/prepare-fixture.mjs
node --check apps/shell/extensions/akari-preview/evidence/preview-part-text-edit-v1/scripts/run-l1.mjs
bash -n apps/shell/extensions/akari-preview/evidence/preview-part-text-edit-v1/scripts/run-l1.sh
```
