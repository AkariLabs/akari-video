# compile-review-session fixture

`fixture-project/` は合成音声だけを使う自己検証用プロジェクトである。実データは含まない。
検証時はディレクトリごと `/tmp` へコピーし、fixture 本体には書き込まない。

| session | パターン | 期待 |
|---|---|---|
| s-0001 | timelineT 15 で停止中。編集指示 + テスト発話 | sourceT 105 / cut:1 を 1 件追加、テスト発話を理由付き破棄 |
| s-0002 | 停止中に 30→8→45 と seek | 最終着地点 sourceT 135 / cut:1 |
| s-0003 | 再生中。発話前 3 秒で cut 境界 10 を通過 | 境界 sourceT 100 / cut:1 |
| s-0004 | compiled・既存 a-0002 | 既定 skip。`--force` で sourceT 102 / cut:1 を新 ID 追加 |
| s-0005 | 壊れた session.json | この session だけ skip |
| s-0006 | snapshot 欠落 | sourceT を推測せず reject |
| s-0007 | 発話をまたぐ多段スクラブ（発話中に seek が連続し、発話終端直前の最終 seek 着地点で 3 秒弱滞留して発話が終わる） | 発話終端の着地点 timelineT=71.25 → cut:1 → sourceT=1011.25（±0.05）に confidence high で解決 |
| s-0008 | 手動コンパイル時代の `{start,end,text}` 形式（`words` 欠落）の transcript.json を事前に仕込んだセッション | warning を残して再文字起こし → 発話 1 件 → annotation 1 件（`BGMの音量を下げる`）まで完走。session は `failed` にならない |

基準コマンド:

```sh
cp -R skills/compile-review-session/dev-fixtures/fixture-project /tmp/crs-selftest
node skills/compile-review-session/bin/compile-review-session.mjs /tmp/crs-selftest --json
node skills/compile-review-session/bin/compile-review-session.mjs /tmp/crs-selftest \
  --session s-0004 --force --json
```
