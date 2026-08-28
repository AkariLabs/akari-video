# エンジン v2 残課題

更新日: 2026-08-28

## 1. 位置づけ

エンジン v2 のゴールデンフレーム検収へ統合した後も残る、公開可能な技術課題の一覧である。
現在の合否条件を弱めるための例外一覧ではない。各項目は独立して完了条件を満たし、契約と検収を
同時に更新して閉じる。

## 2. 実機・プラットフォーム

### #14 Windows 実機 OSR

- Windows 実機で OSR の連番捕捉、エンコード、音声 mux、最終照合を通す。
- ソフト描画は 2 走の全コマ SHA-256 一致、GPU は同一マシン 2 走の一致率を診断値として記録する。
- 別マシン間の GPU byte-exact は要求しない。Windows で OSR を既定にできることを実機結果で裁定する。

### Theia 実ブート `--render`

- パッケージ化した Theia / Electron から `--render` を起動し、OSR のストレージ、終了コード、成果物の
  引き渡しまでを実ブートで検証する。
- 開発時の直接起動だけを合格根拠にしない。

### ソフト描画の前提と検証環境の両立

- 2026-08-28 の実測により、失敗は macOS 固有の条件やデコード実装側の回帰ではなく、worktree ごとの
  Electron 同梱 `libffmpeg.dylib` の差に起因すると確定した。`apps/shell` の `npm run build` は
  `@theia/ffmpeg` 経由で非プロプライエタリ版へ差し替える既知の副作用がある。
- 差し替え版は 1,203,568 B で `H264 Decoder` 文字列がなく、SwiftShader / `AKARI_OSR_SOFT=1` では
  `VideoDecoder.configure()` が全指定で失敗する。GPU 描画は VideoToolbox を使うため影響しない。
  `VideoDecoder.isConfigSupported()` は差し替え版でも `prefer-software` に `true` を返すため、判定には
  使用しない。
- 検証 / CI 環境では、`libffmpeg.dylib` に `H264 Decoder` 文字列がある stock 版
  （2,160,944 B・SHA-256 `5651a2ba1e9d2a57a9dc684729bff4cfb9460ed8be64aed74e8025ba8c12de9f`）
  であることを機械判定し、差し替え版を検出したら原因と復旧方法を示して fail-closed にする。
- 詳細は [OSR 書き出し契約](./contract-2026-08-28-osr-export-v0.md) §11.3「ソフト描画の前提」を参照する
  （本ブランチにはまだ §11.3 がなく、公開 main の合流後に同ファイルへ現れる）。
- 検証専用 worktree では `apps/shell` を build しない。build した場合は stock 版へ戻し、shell build 済みの
  ツリーをソフト描画の検収に使わない。CI は `npm ci` 直後の stock 版で検収を実行する。

## 3. デコード・決定論・性能

### #16 非連番 seek と決定論

- 非連番 seek、チャンク分割、並列化を導入しても完成画が履歴に依存しない方式を定める。
- 候補は先頭または同期点からの warm-up 履歴固定と、完成画に対する独立ゴールデン検収。
- 連番 2 走の byte-exact 条件を暗黙に非連番へ拡張しない。

### #70 WebCodecs デコード先読み

- GOP 距離に応じた warm-up と lookahead の上限、cache 破棄規則、長尺時のメモリ上限を決める。
- 現在の基準値 `test:seek requestCount = 94`、`bFrame.rows = 720`、
  `performance.lookahead.hits = 8` を回帰基準として保つ。

### #70 stdin バックプレッシャ

- raw BGRA を encoder stdin へ渡す際に、`write()` の戻り値と `drain` を尊重する。
- producer の無制限先行、pipe 終了前の成功扱い、末尾フレーム欠落を失敗として検出する。

### GPU→CPU 往復の解消

- GPU 合成結果を CPU の raw BGRA へ readback してから再び encoder へ渡す往復をなくす。
- 将来の WebCodecs `VideoEncoder` で GPU surface を直接扱える経路を調査し、色空間、timestamp、
  B フレーム、音声 mux、決定論の検収を別々に定める。

## 4. OSR の隔離と検収精度

### OSR Electron のストレージ隔離

- 同時実行する OSR ごとに user data / origin / OPFS を隔離し、fixture や中間状態の衝突を防ぐ。
- 二つの render を並行実行し、互いの frame、manifest、終了処理へ干渉しないことを検収する。

### verify の 1 コマ遅れ撤廃

- 捕捉要求時刻、DOM commit、GPU raster 完了、raw BGRA 取得の境界を同じ frame number へ揃える。
- matte 同期の現行基準 `300` コマ・mismatches `0` を維持し、補正のための暗黙 `+1 frame` をなくす。

### render-cut verify の ±3 を OSR で ±0 へ

- legacy 由来のフレーム許容幅 ±3 を OSR 出口には持ち込まない。
- OSR は要求 frame number と捕捉 frame number の一致を ±0 で判定し、不一致を失敗にする。

## 5. 表現と音声の別票

### screen FX 3 種の決定論的カーネル化

- `noise` / `particles` / `flare` を同じ時刻・seed・色空間から評価できるようにする。
- 3 種それぞれに固定時刻の positive 点と 1 px 改変の negative 点を追加してから近似を解消する。

### v2 器への静止画 cut 統合と img 分岐退役

- 互換 `<video>` 器の `<img>` 切替に依存せず、frame-engine の source として静止画を評価する。
- framing、transform、freeze、連続 seek、動画 cut との境界をゴールデンに追加してから分岐を退役する。

### ducking 共通エンベロープ

- G3 で残した -12 dB 矩形を変更する場合だけ着手する。
- narration の実レベル、attack 5 ms、release 300 ms をどこまで予定表へ含めるかを先に裁定し、
  即時プレビューと納品マスターの役割差は維持する。

## 6. legacy 退役（#100b）

legacy 合成経路のコードとテストは互換期間中そのまま残す。削除へ進める条件は次のいずれかである。

1. #14 の Windows 実機で OSR が PASS する。
2. Windows でも OSR を既定にするオーナー裁定がある。

条件成立後に、legacy engine 選択、ffmpeg filtergraph 合成、互換 `<video>` プレビュー、専用検収を
参照ごと棚卸しする。条件成立前の削除、到達不能化、テスト無効化は行わない。
