# コンパイル規則

## 目次

- [時計と cut 写像](#時計と-cut-写像)
- [文字起こしと発話区切り](#文字起こしと発話区切り)
- [参照解決](#参照解決)
- [ストロークペアリング](#ストロークペアリング)
- [採否と正規化](#採否と正規化)
- [着地と劣化](#着地と劣化)

## 時計と cut 写像

`events.jsonl` を recT 順に読み、`playing`、`anchorTimelineT`、`anchorRecT`、`rate` を保持する。
停止中は anchor の timelineT、再生中は
`anchorTimelineT + (recT - anchorRecT) * rate` とする。`tick` は anchor を実測値へ戻す
ドリフト訂正であり、推定より常に優先する。壊れた JSONL 行だけを warning 付きで除外する。

`edit.snapshot.json` の最小 track をプライマリトラックとし、cut の
`duration = (out - in) / (speed ?? 1)` を配列順に並べる。`at` がなければ直前の終了へ接続する。
区間は `[timelineStart, timelineEnd)` とし、境界ちょうどは次の cut に属する。
`sourceT = in + (timelineT - timelineStart) * speed` で逆写像する。snapshot がなければ拒否し、
現在の edit.json や recT から sourceT を推測しない。

## 文字起こしと発話区切り

`analyze-footage` の 3 層に相乗りする。

1. `skills/analyze-footage/bin/transcribe-sa.mjs` を `--check` 後に呼ぶ。
2. 利用不能・失敗なら既存 `whisper-cli` と多言語 `ggml-*.bin` を探索し、mono 16 kHz WAV を
   作って full JSON を正規化する。ツールやモデルを自動導入しない。
3. `--allow-cloud-stt` があり、doctor ok の候補を decision card で確認でき、
   `--cloud-provider ... --cloud-approved` まで明示された場合だけ
   `transcribe-cloud.mjs` を呼ぶ。明示承認前に送信しない。

採用する backend は word 時刻を返すものだけとし、`transcript.json` の `backend` に provenance
を残す。音声の長い無音で backend の先頭ずれを補正した後、隣接 segment の間隔が 0.3 秒未満なら
結合する。結合内は word に付いた `。！？!?` の後に word が残る場合に分割する。
全 backend が失敗したら `backend: "unavailable"`、`segments: []` と原因を保存し、発話ゼロとして
処理を続ける。「発話なし」とは断定しない。

## 参照解決

優先順位は次のとおり。

1. 発話区間中に seek が起きた場合は発話終端時点の着地点を第一候補とし、その位置に 1 秒以上
   滞留していれば、発話をまたぐスクラブが停止したとみなして `confidence: high` とする。
2. 発話開始時に停止中なら停止フレームを採用し、`confidence: high` とする。停止中の連続 seek は
   最後の着地点が anchor になる。
3. 再生中なら発話開始から 3 秒遡った実軌跡と開始位置の間にある cut 境界を列挙する。候補が
   1 つならその境界、0 なら瞬時位置、複数なら候補列を残す。
4. 0 件・複数候補は `confidence: low` とし、`[要確認]` に候補と質問を書く。黙って捨てず、
   複数候補から機械的に 1 つを断定しない。

解決した timelineT を snapshot cuts に当て、`target: "cut:<元配列index>"` と sourceT を得る。

## ストロークペアリング

`strokes.json` がある場合、発話区間と recT が重なるストローク、または区間間の距離が 3 秒以内の
ストロークを決定的に選ぶ。重なりを最優先し、次に発話開始へ最も近いストローク端点、最後に
recT・ID の順で tie-break する。参照解決の優先順位は **停止中発話 > ストロークペア >
巻き戻し再生 > 再生中発話**。停止中発話では停止フレームのアンカーを保ったままストロークだけを
添付し、それ以外ではストロークの frame を sourceT / timelineT / cut target のアンカーにする。

annotation には最大 100 点へ決定的に簡略化したポリラインを埋め込み、始点・終点を必ず残す。
原本は `sessionRef` で参照し、`strokes.json` 自体は変更しない。ファイル欠落は正常、JSON や
要素の破損は warning とし、壊れた要素だけを除外してストロークなしの従来経路へ劣化する。

## 採否と正規化

bin は編集語・要求語・システム確認語の保守的なヒューリスティックで暫定判定する。
編集指示は命令形へ正規化し、原文を `transcript` に残す。テスト、音声確認、独り言、言い直し、
雑談は annotation にせず、原文・recT・理由をレポートに残す。グレーな発話は破棄せず
`[要確認]` に倒す。

実案件では `--prepare-only` で `compile-proposals.json` を作り、各 `proposals[].decision` を
確認・記入する。参照候補、原文、音声の recRange、snapshot の構造データを先に確認し、
データにない視覚参照だけを最後の手段としてフレーム視認する。確定後に `--apply-proposals` で
着地する。着地前ゲートを増やすのではなく、これはコンパイラ内のエージェント判断段である。
自動一括が必要な fixture や明示運用では、未編集の暫定判定を直接着地できる。

## 着地と劣化

既存 `transcript.json` がスキーマ不正な場合は warning を残して再生成する。

review.json の既存 annotations 行を再シリアライズしない。閉じ `]` の直前へ minified JSON を
新しい行として加え、一時ファイルから rename する。ID は既存 `a-` 数値の最大 + 1 とし、削除済み
ID を再利用しない。annotation は `status: "open"`、`input: "session"` とし、`timelineT` には
解決済みタイムライン秒（参考値。正は sourceT）を書き込む。audio、transcript、session
id・recRange・confidence を含める。

成功後だけ session.json を `compiled` にし、今回の ID を `compiledAnnotations` へ追記する。
既存 ID は保持する。compiled は既定でスキップし、`--force` でも既存 annotation を消さず新 ID を
追加する。壊れた manifest と snapshot 欠落はセッション単位で報告し、他セッションを続行する。

`packages/schemas/review.schema.json` の `input` enum と `apps/shell` の annotation reader に
`session` を追加する同期は別タスクであり、本スキルの境界外である。契約どおり
`input: "session"` を書き、境界外実装に合わせて値を歪めない。
