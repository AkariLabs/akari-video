# @akari-video/akari-tools

`akari media` の入出力契約は [`docs/contract-2026-08-29-media-inspect-cli-v0.md`](../../docs/contract-2026-08-29-media-inspect-cli-v0.md) を参照してください。

- `akari media probe <target>` — コンテナ、映像・音声ストリーム、内容ハッシュを調べる。
- `akari media grab <target> -t <time…>` — 指定した source 時刻の静止画を取り出す。
- `akari media filmstrip <target>` — 素材全体の流れをコンタクトシートにする。
- `akari media waveform <target>` — 波形、無音区間、ラウドネスを調べる。
- `akari media transcribe <target>` — ローカル既定の時刻付き文字起こしを返す。
- `akari media audio-level <projectDir>` — `gain_db` 未指定の音声素材を測り、役割別の提案値を表にする。`--write` で `edit.json` へ数値を保存し、`--json` で JSON 配列を返す。

## 音声素材の挿入レベル

```sh
# dry-run（edit.json は変更しない）
akari media audio-level ./project

# 提案値と未指定の既定 fade を書き、edit-lint で検証する
akari media audio-level ./project --write

# 自動処理向け。custom target と ceiling も指定できる
akari media audio-level ./project --json \
  --targets '{"narration":-16,"bgm":-26}' --ceiling -1
```

対象は v2 audio lane と legacy `audio.sfx[]` / `audio.narration[]` / `audio.bgm` のうち
`gain_db` が未指定のクリップだけである。素材不在は warning としてその 1 件を省き、書き込み後に
edit-lint error があれば `edit.json` 全文を元へ戻す。計測キャッシュは
`<projectDir>/.akari/cache/audio-measure/` に置き、`--no-cache` で再計測できる。
legacy 形（version 0/1）の dry-run / `--json` は利用できるが、現行 edit-lint は古い形式を
error にするため `--write` は巻き戻される。書き込む場合は先に `akari migrate` で v2 にする。
