# L0 / L1 の媒体観察と文字起こし

## 正本

呼び出し、stdout、各コマンドの出力、帳面追記、分析レベルは [`akari media` 観察コマンド契約 v0 §1〜§4](../../docs/contract-2026-08-29-media-inspect-cli-v0.md) を正本とする。要約すると、**観察は `akari media`、判断はこのスキル、結果はプロジェクト内の analysis.json へ追記**する。

## L0: probe

```bash
akari media probe "$SOURCE"
```

stdout の JSON から `duration_s`、`video`、`audio` を確認する。入力をデコードできると推測せず、exit 0 と有限の正の尺を成立条件にする。プロジェクト内では `probe` と `observations[]` が自動追記される。

- 音声が `null` なら L1 をスキップできる。
- 映像が `null` なら L2 の映像観察は実行できない。L0 / 音声 L1 の結果だけで確定するか、依頼との不一致を報告する。
- stdout 以外の進捗・警告は stderr として扱い、JSON に混ぜない。

## L1: waveform を先に取る

音声がある素材では、文字起こしより先に実行する。

```bash
akari media waveform "$SOURCE"
```

既定閾値を変える必要がある場合だけ `--silence-db` / `--min-silence` を指定し、値と理由を報告する。`silences` は source 秒、`speech_likely` は文字起こし要否の粗いゲートであり、字幕や発言内容の根拠にはしない。

- `speech_likely: false`: 依頼で明示されない限り transcribe せず、`transcript: []` のまま L1 を完了する。
- `speech_likely: true`: 次節へ進む。

## L1: speech_likely のときだけ transcribe

```bash
akari media transcribe "$SOURCE"
```

指定窓だけ必要なら全尺を起こさず、source 秒で範囲を限定する。

```bash
akari media transcribe "$SOURCE" --in 120 --out 180 --lang ja
```

3 層 backend の選択順、キャッシュ、`segments[]` の形、no speech、失敗時の扱いは [`akari media` 契約 §2.5](../../docs/contract-2026-08-29-media-inspect-cli-v0.md) に委ねる。スキル側で backend の実行ファイル・モデル・入力音声を探索または変換しない。

### 承認制クラウド

- 既定で外部へ音声を送らない。
- `.akari/connections.json` に doctor `ok` で登録済みの接続だけを候補にする。
- 決定カードで人間が明示承認した後だけ `--backend cloud:<connection-id>` を指定する。
- キーは `credentials.env` 経由だけで扱い、値を stdout / stderr / 成果物 / チャットへ出さない。
- ローカル結果が利用不能でも、承認なしにクラウドへ切り替えない。

### 結果の扱い

- `segments[]` は analysis.json の `transcript[]` と同形で、時刻は source 秒。プロジェクト内では対象範囲だけが自動更新される。
- `no_speech: true` + `segments: []` は成功であり、発話を推測しない。
- exit 1 は推測で埋めず `transcript: []` のまま、stderr の理由と試した範囲を報告する。
- backend は stdout と `observations[]` を provenance とし、Schema 外のフィールドを transcript segment へ足さない。
- キャッシュヒットでも観察結果は有効である。内容ハッシュが同じ音声を別手順で二重に起こさない。

### transcript の品質確認

`segments[]` をそのまま信用せず、source duration 内か、`end > start` か、時刻順か、word 区間が親 segment 内かを確認する。次の疑いがあれば waveform、前後 transcript、L2 を実施済みなら視認画像と突き合わせる。

- 波形上の発話兆候と矛盾する定型文・短文
- 同じ文の不自然な連続反復
- 素材の言語・話題・前後文脈と噛み合わない発話
- 視認済み画像の可視事実と明確に矛盾する断定

根拠と矛盾する segment は除外し、全件なら `transcript: []` にする。除外内容・時刻・根拠は完了報告へ書き、Schema 外フィールドを足さない。L2 未実施なら画像との突合のためだけに勝手に L2 へ広げず、確認できた根拠の範囲で保留または除外する。

## L2 での 720p 扱い

L0 / L1 は原本から観察し、`proxy.mp4` を作らない。L2 で画像を個別確認する場合、`akari media grab --separate` は時刻ごとの 720p 高さの PNG を返す。永続的な 720p プロキシが後続工程から明示要求された場合だけ L2 中間物として置き、trim せず原本と source 時刻を一致させる。媒体バックエンドをこのスキルから直接呼ぶ手順は置かない。

## よくある間違い

- waveform より先に全尺 transcribe を走らせる。
- `speech_likely` を発話内容や字幕の根拠にする。
- L1 のためだけに映像プロキシを作る。
- backend の raw 出力へ独自変換を加え、契約済み `segments[]` を作り直す。
- クラウド接続が登録済みというだけで承認なしに送信する。
- backend 不可を隠すために transcript を推測する。
