# preview-audio-wiring 検証記録

## Fixture

- `fixture/fixture-video.mp4`: 6.000 秒、186,434 bytes
- `fixture/audio/bgm.wav`: 1.500 秒、220 Hz、144,078 bytes
- `fixture/audio/sfx.wav`: 0.300 秒、880 Hz、28,878 bytes
- `fixture/audio/narration.wav`: 2.000 秒、440 Hz、192,078 bytes
- `fixture/edit.json`: BGM `gain_db=-18`、`ducking=true`、SFX 1 件、欠落 SFX 1 件、narration 1 件（`t=2`）
- `fixture/no-audio/`: `audio` セクションを持たない 3.000 秒の対照プロジェクト

すべてローカルの ffmpeg 8.1.1 で生成した。3 本の WAV はいずれも非無音。

## 自動観測

`node run-audio-controller-simulation.mjs` は編集後の TypeScript から
`hostAdapterScript()` の生 JS テンプレートを抽出し、決定的な Web Audio テストダブル上で実行した。
結果は `simulation-run-log.json` のとおり全項目 PASS。

- デコード: BGM 1 / SFX 1 / narration 1。欠落 SFX は warning 後に当該要素だけスキップ
- 再生開始: AudioContext `running`、BGM/SFX/narration 各 1 source をスケジュール
- スケジュール時刻: BGM 10.015 秒、SFX 11.015 秒、narration 12.015 秒（context start 10.015 秒基準）
- narration 区間外: BGM `-18 dB` = linear `0.12589254117941673`
- narration 区間内（timeline 2.2 秒）: duck `-12 dB`、合計 `-30 dB` = linear `0.03162277660168379`
- master gain: video volume `0.4` → `0.4`、video muted → `0`
- audio 無し: supplemental AudioContext を生成せず `{ disabled: true }`

## L0

実行ディレクトリ: `apps/shell/`

- `npm run build:ext`: PASS、exit 0、real 4.76 秒
- `npm run lint`: PASS、exit 0、real 2.33 秒

依存は同一リポ本体に既に存在する `apps/shell/node_modules` を一時参照し、外部通信は行っていない。

## 実機観測（ラッパーによる L1 追加実施）

codex の実行サンドボックス（`environment-attempts.json`）では Electron 起動・headless Chrome・
ローカル HTTP listen のいずれも環境制約でブロックされたため、上記の決定的シミュレーションのみで
提出された。ラッパー（本検証を実施した Claude Code セッション）はより制約の緩い環境で動いているため、
実際に Electron を起動し CDP 経由で実機観測を追加実施した（`run-real-electron-audio-e2e.mjs`）。

手順は `skills/verify/SKILL.md` の L1 手順（`node_modules/electron/dist` を直接起動 + CDP で
入れ子 webview の active-frame へ到達）に準拠。`npm run build`（`build:ext` + `theia build`）で
実際に `lib/frontend/bundle.js` を生成し、隔離ワークスペース（`fixture/` を丸ごとコピー）を
開いて Quick Open（⌘P）でファイルを開き、`window.akari.previewAudioDebug()` を実行中の
Web Audio グラフに対して直接呼び出した。

**再現時の既知の落とし穴（この worktree 固有）**: `apps/shell/node_modules` を他チェックアウトから
まるごとシンボリックリンクすると、その中の `akari-preview` 等ワークスペースパッケージの相対
シンボリックリンク（`node_modules/akari-preview -> ../extensions/akari-preview`）がリンク元
チェックアウトの `extensions/akari-preview` を指したままになり、`theia build` がこの worktree の
編集済みコードではなく別チェックアウトの旧コードをバンドルしてしまう（1 回目の実行で
`window.__akariPreview.summary.audio` が常に `undefined` になり発覚）。対処: `node_modules` 配下の
8 拡張分のシンボリックリンクだけをこの worktree の `extensions/*` へ張り直してから
`rm -rf lib && npm run build` を実行すること。

### 観測結果（全項目 PASS、`real-run/real-electron-run-log.json` に実測ログ）

- **audio セクションのパース**: 実際の edit.json から `bgm`（`gain_db=-18`, `ducking=true`）/
  `sfx`（存在する 1 件のみ。`audio/missing.wav` は解決失敗でドロップ）/ `narration`（`n-0001`）が
  正しく `window.__akariPreview.summary.audio` に反映されることを実機で確認
- **欠落ファイルの警告**: フロントエンドの実コンソールに
  `[akari-preview] audio.sfx[1] を無視しました（音声ファイルを配信できません） Error: ENOENT: ... audio/missing.wav`
  が実際に出力されることを確認（スキップは該当要素のみ、プレビューは継続）
- **スケジュール**: 再生開始後 `previewAudioDebug()` で BGM/SFX/narration 各 1 source が
  `active` になることを確認
- **ducking**: 実際の再生タイムラインで narration 区間（t=2〜4秒）に入ると
  `duckGainDb=-12`、`bgmGainLinear≈0.03162277`（`10^((-18-12)/20)` と一致）に下がり、
  区間を抜けると `duckGainDb=0`、`bgmGainLinear≈0.12589253`（`10^(-18/20)` と一致）に戻ることを確認
- **マスターゲインのミラー**: `video.muted=true` で `masterGainLinear=0`、
  `video.volume=0.4` で `masterGainLinear≈0.4` になることを確認
- **pause**: 全 source が停止（`active.bgm/sfx/narration` すべて 0）することを確認
- **audio 無しプロジェクトの非退行**: `summary.audio` が存在せず、
  `previewAudioDebug()` が `{ disabled: true }`（supplemental AudioContext 自体を生成しない）を返し、
  かつ動画自体は通常どおり再生（`paused:false, currentTime>0`）することを確認
- スクリーンショット: `real-run/06-audio-playing.png`（fixture 再生中）/
  `real-run/07-no-audio-playing.png`（audio 無しプロジェクト再生中）

### なお未確認の事項

- **OS のスピーカーから実際に音が聞こえること**: Web Audio グラフが `AudioContext.destination` まで
  正しく接続され、上記のとおりゲイン値・スケジュールは実測できたが、人間の耳による可聴確認はしていない
  （ヘッドレス実行環境のため）
- `run-preview-audio-e2e.mjs` / `run-headless-audio-harness.mjs`（codex 作成）は環境都合で未実行のまま
  残置。`run-real-electron-audio-e2e.mjs`（ラッパー作成）が実質的に同じ目的を実機で達成した
