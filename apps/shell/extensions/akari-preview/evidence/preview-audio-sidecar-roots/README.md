# preview-audio-sidecar-roots — 音声サイドカーの要求に要求元ウィンドウの roots を載せる

## 症状
同じバックエンドで 2 つ目のウィンドウ（別ワークスペース）を開くと、1 つ目のウィンドウの出力プレビューで
音声サイドカーの要求が `Preview audio sidecar paths must stay inside an open workspace` で失敗し、
主動画の埋め込み音声（speech）が「一部の音声を再生できません」になる。

## 原因と対応
- backend の `requestPreviewAudioSidecar` は基点の時点で `resolveWorkspaceRoots(request.workspaceRoots)` を通していた。
  roots が無い要求だけが「最後に使ったワークスペース」（= 2 つ目のウィンドウ）で判定される。
- open-handler の `requestPreviewAudioSidecar(item.request)` 3 か所（初回の speech、通常の音声の entry.resolve、ポーリング）が roots を載せていなかった。
- 3 か所で `currentWorkspaceRoots()` を載せる。要求型は common の `PreviewAudioSidecarRequest`（`workspaceRoots?: string[]`）にまとめた。
- 台帳に無い roots は従来どおり `The requested workspace root is not an open workspace` で拒否される（fail-closed は不変）。

## L1（Windows 11・開発配置・user-data-dir / THEIA_CONFIG_DIR / AKARI_HOME は隔離）
手順は `scripts/sar-l1.mjs`: ws-a で出力プレビュー → 再生、ws-b を 2 つ目のウィンドウで開き出力プレビュー、
ws-a で出力プレビューを閉じて開き直し → 2 秒地点から再生。出力の AnalyserNode で 500 Hz（主動画の埋め込み音声）を測る。

| 場面 | 修正前（基点） | 修正後 |
|---|---|---|
| ws-a 単独 | 500 Hz -48.4 dB | -48.3 dB |
| ws-b | -48.2 dB | -48.2 dB |
| ws-b を開いたあとの ws-a（開き直し） | **-137.1 dB**・「一部の音声を再生できません: speech:cut-1〜3」・supply.failed = speech 3 本 | **-48.5 dB**・表示なし・failed 0 |
| 起動ログの `Preview audio sidecar paths must stay inside an open workspace` | 11 行（ws-a の開き直し以降） | 0 行 |

生データ: `data/l1-before.json` / `data/l1-after.json`。L0 の集計: `data/l0.json`。
