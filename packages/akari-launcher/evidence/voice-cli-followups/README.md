# voice CLI followups 証跡

`node packages/akari-launcher/evidence/voice-cli-followups/regenerate.mjs` で再生成する。ローカルの VOICEVOX ヘッドレスエンジンと ffmpeg、macOS の SpeechAnalyzer が必要。実行スクリプトは一時 `HOME` / `AKARI_HOME` を作り、`narration generate --engine voicevox` の自動起動経路で `quick-v1` と `extended-v1` を読み上げる。生成時に起動したエンジンは narration コマンドが各生成後に停止する。GUI アプリは起動しない。

生成した録音は音量を整えて `voice create` → `voice rename` → 偽 HTTP 応答によるローカル写し `voice copy` → `voice extend` → `voice profiles` に渡す。`copy-local-mock.json` は stale を観測するための写しで、実 Irodori へは接続しない。録音・作業場は一時領域から削除し、JSON はパスとユーザー名を置換して保存する。有償 API、実在の鍵、人の声は使わない。
