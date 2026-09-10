# 検証記録 — 長尺素材の「起こす」が `helper failed: spawnSync … speechanalyzer-helper ENOBUFS` で落ちる件

対象: `skills/analyze-footage/bin/transcribe-sa.mjs` が Swift ヘルパー `speechanalyzer-helper` の stdout を
`spawnSync(..., { encoding: "utf8" })`（`maxBuffer` 未指定 = Node 既定の 1 MiB）で受けていたため、数時間の素材で
ヘルパー JSON（segments + words + `allWords` の重複コピー）が 1 MiB を超えると `ENOBUFS` で落ち、Mac 既定の
SpeechAnalyzer 経路が使えなかった。次の段 `packages/akari-tools/src/media/transcribe.mjs` の `runSpeechAnalyzer` も
`runChecked`（64 MiB）で stdout を受けており、上限を持つ構造は同じだった。

修正:

- `transcribe-sa.mjs`: ヘルパーの stdout を `fs.mkdtempSync` 配下の一時ファイルの fd（`stdio: ["ignore", fd, "pipe"]`）で受け、
  終了後に `readFileSync` → `JSON.parse`（stderr は従来どおりバッファで `summarize`）。一時ディレクトリは `finally` で削除。
  `spawn()` ヘルパーは `sw_vers` / `swiftc` 用に残し、ヘルパー実行だけ `runHelper()` の新経路
- `transcribe-sa.mjs` に `--output <path>` を追加: 指定時は成功の最終 JSON（`{ backend, available: true, segments }`）を
  stdout ではなくそのファイルへ書き、stdout には何も出さない。exit code は従来どおり。
  **失敗（exit≠0）経路は `--output` の有無に関わらず従来どおり stdout に失敗 JSON を出す**
  （呼び出し側 `runChecked` が exit≠0 のとき stdout / stderr の要約をエラー文言にするため。失敗理由が消えないようにする）。
  未指定なら従来どおり stdout（`compile-review-session` など他の呼び出し側は無変更で動く）
- `transcribe.mjs` の `runSpeechAnalyzer`: `runBackend` が持つ `temporaryDirectory` を引数で受け取り、
  `--output <temporaryDirectory>/speech-analyzer-output.json` を渡してそのファイルを読む（新規 mkdtemp なし）。
  `runChecked` 失敗時は従来どおり
- Swift ヘルパー（`speechanalyzer-helper.swift`）は無変更

## L0（静的・機械的）

| 対象 | コマンド | 結果 |
|---|---|---|
| `packages/akari-tools`（全 test） | `cd packages/akari-tools && npm test` | 381 tests / **pass 380 / fail 0** / skipped 1（skipped は既存の「shell schema 写しが存在するときは帳面を検証する」= shell 未ビルド時の既定 skip。新規 3 件を含む） |
| 新規: `transcribe-sa-output.test.mjs` | `node --test packages/akari-tools/test/transcribe-sa-output.test.mjs` | 3 / 3 緑: (1) 偽ヘルパー（`#!/bin/sh` + `node -e` で **10.7 MB（10.18 MiB）** の JSON を stdout に吐く）で `--output` なし / あり両方が exit 0・segments が正規化（無効時刻の segment / word を除外・start 順に整列）され両者が deepEqual・ENOBUFS なし (2) `transcribeMedia` を `options.spawn` 差し替えで通し、`--output` が付与されそのファイルから segments が返る (3) 偽ヘルパーが exit 1 + stderr `boom` のとき `--output` 付きでも exit 1・stdout に `helper failed: boom` の失敗 JSON・出力ファイルは作られない |
| 既存: `transcribe.test.mjs` + `transcribe-script-resolution.test.mjs` | `node --test …` | 24 / 24 緑（後者は spawn モックを `--output` 追随させる 6 行のみ変更） |
| `transcribe-sa.mjs --check` | `node skills/analyze-footage/bin/transcribe-sa.mjs --check` | `{"available":true}` exit 0（従来どおり） |
| unit lane pure | `npm run test:unit` | 1923 tests / pass 1916 / fail 1（`scripts/test` の check-extension-deps 1 件のみ = 基点で既に赤・契約で無視可） |
| 生成物ドリフト | `node scripts/ci/check-frame-engine-drift.mjs` | exit 0（gpu-export / osr-export / akari-preview / preview-server すべて current。生成物は再生成していない） |
| docs 索引 / スキル索引 | `npm run check:docs-sync` / `npm run check:skills-index` | いずれも drift なし |
| governance（tracked-file leak scan） | `.github/workflows/governance.yml` の scan step をローカルで実行 | exit 0（`governance.txt`） |

## L1（本物の SpeechAnalyzer で 1 MiB 超の出力になる長さの音声を実測）

`run-l1.mjs` の実行結果が `l1-results.json`（生の出力・作業機パスは `<TMP>` / `<TMPDIR>` / `<WORKTREE>` に置換済み）。
合成音声は `mkdtemp` の下に作り、終了時に削除（`cleanup.tmpRemoved: true`）。修正前は `git archive 8e96e81f packages presets skills`
の複製を一時ディレクトリへ展開し、同じ音声へ同じ CLI を叩いた。Electron は起動していない。

### 合成音声

ヘルパーの locale は `ja-JP` 固定（英語を喋らせると認識語が激減して 1 MiB に届かない）ので、日本語本文 12 段落を
`say -v Kyoko --data-format=LEI16@16000` で wav にし（**1,150 s**）、ffmpeg `-stream_loop 6` で 7 倍に伸ばした:

- 長さ **8,052 s（2 時間 14 分）**・257,672,528 bytes（16 kHz mono pcm_s16le）
- 生成: say 17.7 s + ffmpeg 0.8 s

### ヘルパーの生 JSON（共有ヘルパー `speechanalyzer-helper` を直接実行・ファイル受け）

| 項目 | 値 |
|---|---|
| バイト数 | **6,668,750 bytes（= 1 MiB の 6.36 倍）** |
| segments | 201 |
| segment 内 words 合計 | **35,197** |
| `allWords`（重複コピー）| 35,197（= words と同数。JSON の約半分がこの重複） |
| engine / locale | macOS SpeechAnalyzer/SpeechTranscriber / ja_JP |
| 処理時間 | 87.5 s（macOS 26.2・Apple Silicon） |

### before / after（`media transcribe <wav> --backend speech-analyzer --no-record`）

| 観測 | 修正前（基点 `8e96e81f`） | 修正後 |
|---|---|---|
| exit | **1** | **0** |
| stderr | `{"backend":"speechanalyzer","available":false,"reason":"helper failed: spawnSync <TMPDIR>/akari-speech-analyzer/speechanalyzer-helper ENOBUFS"}`（実機報告と同一文言） | 空 |
| stdout | 空 | transcribe JSON 1,678,525 bytes / `backend` speech-analyzer / range 0–8052.26 / `no_speech` false / **segments 201 / words 35,197**（ヘルパーの生 JSON と同数 = 取りこぼしなし）/ 先頭 segment 0–61.44 s「これは長時間の収録を想定した文字起こしの試験です…」/ 末尾 segment 8017.86–8052.26 s / cache miss |
| ENOBUFS | あり | なし |
| wall | 85.9 s | 94.5 s（ヘルパーの再ビルド + unrecognized span 検出を含む） |

修正前はヘルパー自体は最後まで走った上で（85 s）、1 MiB の spawnSync バッファに収まらず落ちている。
修正後は同じヘルパー・同じ音声で segments が返る。短い素材（19 分・935 KB）の結果は修正前後で同一（単体テストの正規化経路は無変更）。

## 未確認・別票候補

- Swift ヘルパーの `allWords` 重複（JSON の約半分）の削減・ストリーミング出力（契約で対象外）
- 長尺音声のチャンク分割・並列文字起こし / キャッシュ鍵の軽量化（契約で対象外）
- `compile-review-session/bin/core/transcription.mjs` は従来どおり stdout 経路で `transcribe-sa.mjs` を呼ぶ（無変更・編集禁止）。
  同スキルの `run()` に別のバッファ上限があれば録音 review セッションの長尺で同種の問題が残る可能性がある（本票では未確認）
- シェル側のエラー文言整形（生 JSON 表示）は対象外
