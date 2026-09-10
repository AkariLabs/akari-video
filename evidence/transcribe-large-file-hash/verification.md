# 検証記録 — 2 GiB 超の素材で「起こす」/ 取り込み probe が `File size (…) is greater than 2 GiB` で落ちる件

対象: `packages/akari-tools/src/media/common.mjs` の `sha256File` が `readFileSync` でファイル全体を一括読みしていたため、
Node の `ERR_FS_FILE_TOO_LARGE`（2 GiB 上限）で `media transcribe`（台本パネルの「起こす」）と `media probe`（素材取り込み）の
両方がエンジン起動前に落ちていた。`createReadStream` + `createHash` のストリーム版（`async`、`Promise<string>`）に置き換え、
呼び出し側 2 箇所（`transcribe.mjs` / `probe.mjs`）を `await` 化した。ハッシュ値は従来と同一（キャッシュ鍵互換）。

## L0（静的・機械的）

| 対象 | コマンド | 結果 |
|---|---|---|
| `packages/akari-tools`（全 test） | `cd packages/akari-tools && npm test` | 378 tests / **pass 377 / fail 0** / skipped 1（新規 2 件を含む） |
| 新規: `media-sha256-file.test.mjs` | `node --test packages/akari-tools/test/media-sha256-file.test.mjs` | 固定バイト列・ランダム 2048 B の両方で `createHash("sha256").update(await readFile(...))` と一致、戻り値は `Promise` |
| 既存キャッシュ鍵テスト（`${sha256}-0-30-speech-analyzer-auto`） | `node --test packages/akari-tools/test/transcribe.test.mjs` | 「transcribe の 2 回目は内容ハッシュ cache hit で backend を起動しない」ほか **全緑・テスト本体は無変更** |
| probe 結果 JSON の sha256（`analysis.schema.json` の `^[0-9a-f]{64}$` 必須項目） | `node --test packages/akari-tools/test/media-contract.test.mjs` | **全緑・テスト本体は無変更** |
| unit lane pure | `npm run test:unit` | 1923 tests / pass 1916 / fail 1（`scripts/test` の check-extension-deps 1 件のみ＝基点で既に赤・契約で無視可） |
| 生成物ドリフト | `node scripts/ci/check-frame-engine-drift.mjs` | exit 0（gpu-export / osr-export / akari-preview / preview-server すべて current）。**生成物は再生成していない** |
| governance（tracked-file leak scan） | `.github/workflows/governance.yml` の scan step をローカルで実行 | exit 0（`governance.txt`） |

補足: この worktree の `node_modules/@akari-video/` には workspace の symlink `edit-store` が同期されておらず、初回の
`test:unit` と drift 検査は `Cannot find package '@akari-video/edit-store'`（`packages/frame-engine/src/timeline/plan.ts` から）で
落ちた。`npm install` はせず、`node_modules/@akari-video/edit-store -> ../../packages/edit-store` の symlink だけを足して再実行した
結果が上表（`packages/edit-store` 673 / 673 緑）。本件の変更とは無関係（edit-store / frame-engine は akari-tools を import しない）。

## L1（2 GiB 超の実ファイル実測）

`run-l1.mjs` の実行結果が `l1-results.json`（生の出力・作業機パスは `<TMP>` / `<WORKTREE>` に置換済み）。
合成素材は `mktemp` の下に作り、終了時に削除（`cleanup.tmpRemoved: true`）。修正前は
`git archive f955a97d packages presets` の複製を一時ディレクトリへ展開し、同じ素材へ同じ CLI を叩いた。

### 合成素材

契約例の `-c:v rawvideo -pix_fmt yuv420p … out.mov` は ffmpeg が「yuv420p rawvideo cannot be written to mov, output file will be
unreadable」と警告し、ffprobe が `Invalid pixel format` で読めない（duration が取れず probe が別の理由で落ちる）ため、
mov に入れられる raw 形式 `-pix_fmt uyvy422`（1 フレーム ≈ 4.1 MB）に変え、`-t 19` で尺を調整した:

```sh
ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=30 -f lavfi -i sine=frequency=440 -t 19 \
  -c:v rawvideo -pix_fmt uyvy422 -c:a pcm_s16le out.mov
```

- `stat -f %z out.mov` = **2,365,591,587 bytes**（> 2,147,483,648 = 2 GiB）
- `shasum -a 256 out.mov` = `64e8b0b1edc67acc18793172b62a7833ae58b19c2d5db9be3aa34e6e86e60ab7`

### before / after

| 観測 | 修正前（基点 `f955a97d`） | 修正後 |
|---|---|---|
| `media probe out.mov --no-record` | **exit 1** / stderr `File size (2365591587) is greater than 2 GiB` / stdout 空 | **exit 0** / stderr 空 / JSON の `sha256` = `64e8b0b1…60ab7`（**shasum と一致**）、`size_bytes` 2365591587、`container` mov、`duration_s` 19、video 1920×1080 30fps rawvideo、audio pcm_s16le mono 44.1 kHz |
| `media transcribe out.mov --backend whisper-cpp --no-record` | **exit 1** / stderr 同上 / stdout 空 | **exit 0** / stderr 空（`greater than 2 GiB` を含まない）/ `backend` whisper-cpp / `cache.key` = `64e8b0b1…60ab7-0-19-whisper-cpp-auto`（sha256 が鍵の先頭に入る）/ `cache.hit` false / segments 1 件（正弦波に対する "." 1 件・音声なしなので内容は問わない） |
| `sha256File(out.mov)` を直接呼ぶ | `RangeError [ERR_FS_FILE_TOO_LARGE]` を throw | 解決値が shasum と一致、戻り値は `Promise` |

修正前は 2 コマンドともエンジン（ffmpeg → whisper.cpp）に到達する前に `sha256File` で落ちている。
修正後の transcribe は whisper.cpp（`ggml-large-v3-turbo-q5_0`）まで実際に走っている（cache miss・wall 12.6 s）。

### ハッシュに要した秒数（次の一手 = 鍵の軽量化の判断材料）

2,365,591,587 bytes（2.20 GiB）を Node v26.3.0・Apple Silicon で:

| 計測 | 秒 | 備考 |
|---|---|---|
| `shasum -a 256`（参照） | 14.2 〜 19.6 s | 別レーンが走る load average 20〜130 の下で 3 回。CPU バウンド（user 14 s） |
| ストリーム版 `sha256File` 単体（ファイルは page cache 上） | **4.1 〜 6.3 s**（≈ 480 〜 550 MiB/s） | RSS 114〜130 MiB・heap 6 MiB（一括読みなら 2.2 GiB をヒープに載せる必要があった） |
| `media probe` 全体 wall（cold read・load average 100 超） | 36.7 s | ffprobe + ハッシュ + version 取得。初回のディスク読みが支配的 |
| `media probe` 全体 wall（warm） | 4.4 〜 4.7 s | |
| `media transcribe` 全体 wall（cache miss・whisper.cpp 実走） | 11.1 〜 12.6 s | ハッシュ ≈ 4〜6 s + 16 kHz WAV 変換 + whisper.cpp |

16.8 GB の実素材（実機報告）に外挿すると、warm でも 30〜40 s・cold read では分単位のハッシュ待ちが「起こす」の押下直後に入る。
**鍵の軽量化（サイズ + mtime + 先頭末尾サンプル）は鍵の契約変更なので別票**（本票の対象外）。

## 再現手順

```sh
# 修正前 / 修正後 / ハッシュ秒数を 1 回で実測し、l1-results.json を書く（合成素材は終了時に削除）
node evidence/transcribe-large-file-hash/run-l1.mjs            # --baseline-rev f955a97d --seconds 19 が既定
cd packages/akari-tools && npm test                            # 新規 media-sha256-file.test.mjs を含む
node scripts/ci/check-frame-engine-drift.mjs
```
