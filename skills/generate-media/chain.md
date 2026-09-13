# still → video → resume

## 一連の流れ

1. `akari generate still <projectDir> --spec <beats.json>` で静止画仮枠を作る。絵が未決なら `--placeholder` を使う
2. タイムラインで尺・順序・静止画としての完成度を確認する
3. 動かす 1 クリップを選び、`akari generate video <projectDir> --item <itemId> --dry-run --json` で送信 body、丸め、見積、外部送信を確認する
4. 費用承認後だけ同コマンドへ `--yes` を付けて実行する
5. CLI が送信前に meta の `job` と `status: "generating"` を保存したことを確認する
6. 完了なら同じ item の source が動画へ差し替わり、失敗なら静止画を保つ

## 再取得

プロセス終了や通信切断の後は、新規ジョブを黙って作らず保存済み request id を再取得する。

```sh
akari generate resume <projectDir> --item <itemId> --json
```

全生成中 item を確認する場合は `--item` を省略できる。

`status: "generating"` のまま `started_at` から `stale_after_s` を超えた状態が stale で、既定は 900 秒。UI は「応答なし・再取得」と表示する。stale は失敗確定ではないため、まず resume で provider の既存ジョブを照会する。

## 失敗と見え方

- `planned`: 文字カードと planned の小札。書き出しでは文字カード自体は残る
- `generating`: 静止画の上に進捗表示。書き出しでは静止画のまま
- stale: 「応答なし」。書き出しでは静止画のまま
- `failed`: 失敗表示。元の静止画を消さず、履歴にも失敗理由を残す
- `done`: 動画へ差し替え、通常表示に戻る

左上の小札、下端の帯、点線、進捗表示は編集用表示である。書き出し時にはすべて消え、0 px になる。失敗や応答なしでも静止画クリップが残るため、タイムラインと書き出しを壊さない。
