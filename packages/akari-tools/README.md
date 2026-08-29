# @akari-video/akari-tools

`akari media` の入出力契約は [`docs/contract-2026-08-29-media-inspect-cli-v0.md`](../../docs/contract-2026-08-29-media-inspect-cli-v0.md) を参照してください。

- `akari media probe <target>` — コンテナ、映像・音声ストリーム、内容ハッシュを調べる。
- `akari media grab <target> -t <time…>` — 指定した source 時刻の静止画を取り出す。
- `akari media filmstrip <target>` — 素材全体の流れをコンタクトシートにする。
- `akari media waveform <target>` — 波形、無音区間、ラウドネスを調べる。
- `akari media transcribe <target>` — ローカル既定の時刻付き文字起こしを返す。

