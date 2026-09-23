# review.json 消失・ID 再利用の調査記録

## 書き手一覧（公開ソースの調査）

| 経路 | 書き方 | 書く直前の読み直し・保護 | 調査結果 |
|---|---|---|---|
| `skills/compile-review-session/bin/core/review-store.mjs` の `appendAnnotationsAtomic`（session apply と canvas compile から呼ぶ） | 既存テキスト末尾へ行を追加し、一時ファイルから rename | 修正前は読み直すが排他なし。修正後は共通ディレクトリロック内で再読込し、ENOENT 以外は停止 | 書き手 |
| `skills/address-review/bin/core/review-store.mjs` の `respondToAnnotation` | 対象行の status/response を差し替え、一時ファイルから rename | 修正前は読み直すが排他なし。修正後は共通ロック内で再読込 | 書き手 |
| `apps/shell/extensions/akari-annotations/src/node/akari-annotations-service.ts` の `createAnnotation` | 読んだテキストへ 1 行追加し原子的な全文置換 | 修正前は読取失敗をすべて空ファイル扱い、排他なし。修正後は共通ロック内で再読込し、ENOENT のみ新規扱い | 危険経路 |
| 同サービスの `resolveAnnotation` | 対象 status の変更後、原子的な全文置換 | 修正前は再読込するが排他なし。修正後は共通ロック内で再読込 | 書き手 |
| 同サービスの `deleteAnnotation` | 対象 1 件を明示削除し、原子的な全文置換 | 修正前は再読込するが排他なし。修正後は共通ロック内で再読込 | 唯一の明示削除 |
| 同サービスの `restoreAnnotation` | 指定 ID の 1 件を追加し、原子的な全文置換 | 修正前は読取失敗をすべて空扱い、排他なし。修正後は共通ロック内で再読込 | 危険経路 |
| `apps/shell/extensions/akari-annotations/src/browser/review-model.ts` | サービス RPC 呼出しのみ。メモリ一覧を `review.json` へ全文保存しない | サービス側が再読込 | 直接の書き手ではない |
| `apps/shell/extensions/akari-preview/src/browser/review-session-recorder.ts`、`src/node/review-session-writer.ts` | セッション原本だけを保存 | review.json への書き込みなし | 書き手ではない |
| `packages/preview-server` | review.json への書き込み・削除なし | 該当なし | 書き手ではない |
| `packages/akari-vibe/src/ops-exec/review_note.mjs` | `env.reviewSource` をメモリ上で更新 | ファイル保存は未接続 | 書き手ではない |

他に本番コードで `review.json` を直接 unlink・rm・rename する経路は見つからなかった。rename は上表の原子的置換に限る。

## 再現手順と実測

`node skills/compile-review-session/evidence/issue-69-review-json/reproduce.mjs before` と `... after` を実行した。スクリプトは一時プロジェクトを作り、修正前の `review-store.mjs` は Git の基点から読み出す。9 件追加し、`s-0011/session.json` に ID を記録する。**消失した状態だけを模すために** `review.json` を一時プロジェクト内で削除し、別セッション相当の 2 件を追加する。削除を起こしたアプリ操作自体は再現できていない。

| 状態 | 初回 | 2 回目の結果 | 再利用 |
|---|---:|---|---|
| BEFORE | 9 件、a-0001〜a-0009 | 2 件、a-0001・a-0002 | 2 件 |
| AFTER | 9 件、a-0001〜a-0009 | 2 件、a-0010・a-0011 | 0 件 |

同じ再現スクリプトの `race-before` / `race-after` では、CLI 24 プロセスを同時に解放して追記した。基点 `92a0dd48` の実測は **試行 24 件・残存 8 件・一意 ID 8 件**、修正後は **試行 24 件・残存 24 件・一意 ID 24 件**。これは CLI 同士の競合実測であり、報告時のアプリ操作そのものを再現した値ではない。別の回帰テストでは、CLI を別プロセスで 6 回、シェルサービスを 6 回同時実行し、**全 12 件・一意 ID 12 件**を確認した。

失われたファイルの注釈本文はセッション ID 記録だけから復元できない。AFTER の 2 件という値は外部でファイルを削除した場合に限る。ファイルが存在する通常経路では、CLI 9 件 → アプリサービスで 1 件解決 → 別の CLI 2 件のテストが **11 件・ID 重複 0 件**で通った。壊れた JSON での CLI apply は修正前からエラー停止し、元ファイルは不変だった。アプリの追加・復元は修正前に読取エラーを空として扱う実装であり、修正後のテストではエラー停止・ファイル不変を確認した。

報告の「CLI rename とファイル監視後のブラウザ側全文書き戻し」という推測は、ブラウザモデルに直接の全文保存処理がないため裏付けられなかった。シェルサービスの読取失敗時の空扱いと書き手間の排他欠如は実際に存在したが、報告時にどの処理がファイルを消したかは特定できていない。

## 事例 2：オーバーレイ HTML の文言

`.akari/work/overlays/<name>.html` を固定パスとして生成・更新する本番コードは見つからなかった。ただし、`edit.json` がその相対パスを参照するなら以下の汎用経路が書き換え得る。

| 経路 | 書き方・新しい文言の可能性 | 自動実行 |
|---|---|---|
| `apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts` の `handleOverlayWrite` | プレビューの contenteditable 操作で渡された HTML を読み、対象テキストを差し替えて保存。ユーザーが入力した文言のみ | 操作時のみ |
| `packages/preview-server/src/server.mjs` の `PUT /api/overlay-html` | HTTP リクエスト本文の HTML で参照先ファイルを原子的に全文置換。クライアントは `public/app.js` の編集操作 | 操作時のみ |
| `skills/beat-sync-edit/templates/gen-timeline.mjs` | 生成器を明示実行すると `overlays/*.html` を毎回再生成。テンプレートにある文言は作り得るが、既定の出力先はプロジェクト直下の `overlays/` | 自動実行なし |
| `edit-plan`・`overlay-authoring` 等のスキルを使うエージェント | 指示に応じて HTML を新規作成・書換えでき、文言を新しく考案し得る | エージェントがタスクを実行した場合のみ |

アプリのファイル監視・プレビュー再読込が新しい文言を生成する経路は確認されなかった。報告にある文言の出所は履歴・操作ログがないため確定できない。事例 2 のコードは変更していない。

## 検証

- `node --test skills/compile-review-session/test/*.test.mjs skills/address-review/test/*.test.mjs`：78 件成功。
- `node --test apps/shell/extensions/akari-annotations/test/review-loss.test.mjs`：10 件成功（version 1 の書き込み拒否・ロック解放後のイベント記録を含む）。
- 前回の関連 3 ファイル合同実行は 34 件成功。今回の変更後は上記 `review-loss.test.mjs` を再実行した。
- `node skills/compile-review-session/evidence/issue-69-review-json/reproduce.mjs race-before` / `race-after`：残存 8/24 件 → 24/24 件。
- `npx tsc -b extensions/akari-theme extensions/akari-preview extensions/akari-annotations`（`apps/shell` から実行）：既存の `read-aloud-dialog.ts` の型エラー 2 件で exit 1。対象の JavaScript 出力は生成され、上記 10 件を実行できた。
