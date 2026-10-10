# akari-connect — L1 の再現手順

`run-l1.mjs` は、build 済みの `apps/shell` を Electron で起動し、CDP で「つなぐ」を操作して確かめる検証スクリプトです。
ホーム・`AKARI_HOME`・TMPDIR は一時ディレクトリへ隔離し、鍵は偽物を 1 本だけ使います。

```sh
cd apps/shell && npm run build && cd ../..
TMPDIR=$(mktemp -d) node apps/shell/extensions/akari-connect/evidence/akari-connect/run-l1.mjs
```

確かめること（17 項目。すべて true で exit 0）:

- 左の列の「つなぐ」に、つながったもののアイコンが小さく重なって並ぶ（鍵の追加後に増え、再読み込み後も残る）
- 左の列から つなぐ画面が開く（見出し・説明・検索・絞り込み・4 つの群・18 枚のカード）
- 絞り込み（つながっている / 行き来する）と検索
- 制作アプリの状態が、その機械の `/Applications` の実際の中身と一致する
- 詳細の鍵の欄は password。偽の鍵を貼って保存すると「つながった」になり、画面には末尾 4 文字だけが出る。鍵は既存の `credentials.env` に入り、`connectors.json` には入らない
- 「チャットで試す」は、`akari.chat.prefill` が無ければ通知を出し、あれば `{ text: 例文 }` で呼ぶ（検証ではコマンドを横取りして記録する）

スクリーンショット・計測 JSON は記録物なのでリポにはコミットしない（`evidence/` の運用規約）。
