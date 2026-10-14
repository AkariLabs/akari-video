# akari-chat-polish3 — 表示・権限・起動の確認手順

ACP の検索語と一覧表示、名前や説明のある未知の道具の表示、agy の transport とエラー表示、相手別の進め方を更新した。Claude の「要所で確認」は `--permission-mode default --permission-prompt-tool stdio` で起動し、確認文を日本語で表示する。Grok と Claude の伏せ字済み実測記録は `../../test/fixtures/` に置いた。

## 起動直後の重さ

履歴の題名・相手・モデルだけを先に表示し、`restoreOrStart()` と起動時の `resumeLast()` の両経路で会話の再開を初回送信まで遅らせる。相手一覧の読み込み前に `resumeLast()` が呼ばれても待ってから表示し、同じ履歴の重複起動を避ける。相手一覧の取得でも各 CLI の `--version` 起動をやめ、実行ファイルの存在だけを確認する。

## 確認待ちと進め方の表示

Claude の権限確認中は該当する道具を実行中に戻し、結果を受けたら完了または停止表示へ更新する。進め方メニューは相手別の非対応理由を表示し、ラベルと説明を縦に並べて項目の高さを内容に合わせる。

## L0

`apps/shell` で `npm run build:ext` と `npx eslint "extensions/akari-chat/src/**/*.{ts,tsx}"` を実行し、`extensions/akari-chat` で `node --test test/*.test.mjs` を実行する。ACP と Claude の実測記録、Codex の権限値、`resumeLast()` の遅延表示、Claude の確認待ちの道具行は単体テストで確認する。

## L1 実測結果
