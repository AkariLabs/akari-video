# evidence — first-run-unsupported（L1 実測記録）

タスク `2026-09-08-tool-install-unsupported-and-model-override` の受け入れ条件
（verify 層 L0 + L1）の実測。計測日 2026-09-08 / macOS 26 系（`sw_vers` major ≥ 26）/
Electron 39.8.7（worktree root の `node_modules/electron`）。

## 走らせ方

```sh
node evidence/first-run-unsupported/run-l1-electron.mjs   # 実機 Electron（隔離 HOME）
node evidence/first-run-unsupported/run-l1-spoof.mjs      # 偽装 OS + whisper override
```

どちらも `HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` / `AKARI_HOME` /
`AKARI_CREDENTIALS_FILE` を `mkdtemp` の一時ディレクトリへ向ける。実利用の
`~/.theia` `~/.akari` `~/.config/akari-video` は読み書きしない。Electron は
計測後に SIGTERM → SIGKILL で必ず落とす。

## L1-a 実機 Electron（隔離 HOME・実 DOM）

`l1-electron-observations.json` / `l1-first-run-tools-macos.png` /
`l1-first-run-speech-analyzer-row.png`

| 行 | 札 | チェックボックス |
|---|---|---|
| FFmpeg | インストール済み | 無し |
| Whisper（whisper.cpp） | **準備が要る（モデルが無い）** | 有り（ON） |
| yt-dlp | インストール済み | 無し |
| Blender CLI | インストール済み | 無し |
| VOICEVOX | インストール済み | 無し |
| **SpeechAnalyzer** | **使える** | **無し** |
| macOS: Command Line Tools | インストール済み | 無し |

- ボタン = **「選んだ道具をインストール（1）」**（= whisper のみ。SpeechAnalyzer は数に入らない）
- SpeechAnalyzer が「使える」ときは手動導入の案内 note を出さない（`shouldShowToolNote`）。
  VOICEVOX のクレジット表記 note は導入済みでも出したまま

## L1-b 偽装 OS（`platform` を渡した実 `detectTools()` → 実 UI 判定関数）

`l1-spoof-observations.json`

| 偽装 | `speech-analyzer` 行 | 札 | チェックボックス |
|---|---|---|---|
| linux | `{ available: false, unsupported: true }` | **この OS では使えない** | **無し** |
| win32 | 同上 | この OS では使えない | 無し |
| darwin（実機） | `{ available: true }` | 使える | 無し |

- `deriveToolSelection()` の既定選択（linux）に `speech-analyzer` は入らない
- `filterInstallableSelection()` に `speech-analyzer` を**手で足しても** n は変わらない
  （`installButtonN === installButtonNWithManualCheck`。n の絶対値は同時に走る
  ほかの道具の検知結果で 2〜3 と揺れるため、不変条件のほうを assert している）

## L1-c whisper モデル override（実 fs・一時ディレクトリの偽モデル）

| env | 検出（`tool-detection.detectTools`） | 導入（`tool-install.resolveWhisperModelPath`） |
|---|---|---|
| `WHISPER_CPP_MODEL` + `AKARI_WHISPER_MODEL` | `<tmp>/models/ggml-large-v3-turbo-q5_0.bin` | **同じパス** |
| `WHISPER_CPP_MODEL` のみ | 同上 | **同じパス** |
| `AKARI_WHISPER_MODEL` のみ | 未検出（`needs: ['モデルが無い']`） | `<tmp>/models/ggml-legacy.bin` + 警告ログ（後方互換） |
| どちらも無し（隔離 HOME） | 未検出 | 未検出 |

警告ログ: `[akari-surfaces] AKARI_WHISPER_MODEL は後方互換用です。WHISPER_CPP_MODEL を使ってください。`

## L0

| 対象 | 結果 |
|---|---|
| `apps/shell && npm run build:ext` | exit 0 |
| `apps/shell && npm run lint` | exit 0 |
| `apps/shell && npx theia build --mode production` | browser / node / electron すべて 0 errors |
| リポ root `npm run test:shell` | tests **3064** / pass 3064 / fail 0 / skipped 0（`akari-surfaces` 193・本タスクで +27） |

## 既知の揺れ（本タスクの変更に由来しない）

`tool-detection.ts` の `defaultRunCommand` は `timeout: 5000`。SpeechAnalyzer の
`--check`（`transcribe-sa.mjs`）は冷えた状態で 3〜5 秒かかることがあり
（実測: cold 3.9s / 5.4s、warm 0.52s）、アプリ起動直後の 1 回目の検知が
タイムアウトすると行が「準備が要る（SpeechAnalyzer の利用可否を確認できませんでした）」
になる。本ハーネスは「再チェック」を最大 3 回押して落ち着いた状態も観測する
（今回の記録は 1 回目で「使える」だったため `rechecks: []`）。
