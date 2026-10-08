# golden-soft 参考ジョブの原因修正

## 原因と検証

| 症状 | 原因 | 修正 | 確かめ方 |
|---|---|---|---|
| `WebGL2 PBO fence wait failed` | Chromium の WebGL `finish()` は GPU の完了を待たず、1080p の FX 計測で積まれた処理が次の 320×180 描画の fence を塞ぐ。 | 計測前後と compositor 破棄前に `fenceSync` → `flush` → `clientWaitSync` で完了を待つ。待機中はイベントループに制御を返す。 | fence の成功・`WAIT_FAILED`・期限超過を単体テストで確認し、次段の fence 待ちを CI で観測する。 |
| `colorPatches.direct` の B だけ最大 12 の差 | SwiftShader の `VideoFrame` → `texImage2D` ソフト変換に、BT.709 と異なる Cb 係数が使われる。 | 描画器名に `SwiftShader` があるときだけ direct の許容差を R≤2、G≤2、B≤12 とする。 | 全 9 パッチを確認し、実 GPU の許容差が `[2,2,2]` のままか `run.mjs` で検査する。 |
| filter 比較が `--engine legacy` で exit 2 | legacy 合成出口が撤去済み。 | 同じ edit を OSR で書き出す。SwiftShader 時は OSR もソフト描画にそろえる。 | invert・saturation・lut の 3 行で既存の閾値を保持して比較する。 |
| CI だけ filter の export / floor MAD が 5〜11 | Ubuntu の FFmpeg 6.1.1 は書き出し mp4 の BT.709 タグを RGB 変換時に使わず、BT.601 行列でデコードする。 | 書き出し側のデコードで BT.709 limited を明示する。 | bare の frame 37 と PNG の比較は BT.709 で MAD 1.500、BT.601 で 8.645。 |
| `frameLifetime` の終了時キューが 28〜29 | SwiftShader の非同期ソフトデコードは `setTimeout(0)` 1 回では掃けず、終了時の判定と競争する。 | セッションを生かしたまま 50 ms 間隔・最大 5 秒待つ。1,000 フレームの close 件数とキュー増加、自然に 0 になる条件は従来どおり検査する。 | 手元の計測では破棄せず約 100 ms で 29→0。`decodeQueueDrainMs` を結果に記録する。 |

## 色の許容差の根拠

SwiftShader の direct 経路で観測した中心画素。値は期待 RGB → 実測 RGB、差分は各チャンネルの絶対値。

| パッチ | 期待 | 実測 | Δ(R,G,B) |
|---|---|---|---|
| black | 0,0,0 | 0,0,0 | 0,0,0 |
| white | 255,255,255 | 255,255,255 | 0,0,0 |
| red | 255,0,0 | 255,1,3 | 0,1,3 |
| green | 0,255,0 | 0,255,11 | 0,0,11 |
| blue | 0,0,255 | 1,0,243 | 1,0,12 |
| cyan | 0,255,255 | 0,254,252 | 0,1,3 |
| magenta | 255,0,255 | 255,0,244 | 0,0,11 |
| yellow | 255,255,0 | 254,255,12 | 1,0,12 |
| mid-gray | 128,128,128 | 128,128,128 | 0,0,0 |

fixture の YCbCr 中心画素は red (63,102,240)、green (173,42,26)、blue (32,240,118)、cyan (188,154,16)、magenta (78,214,230)、yellow (219,16,138)。B の変換係数を BT.709 の `2(1−0.0722)=1.8556` から BT.601 の `2(1−0.114)=1.772` に変えると、差は `0.0836×|Cb−128|`、最大約 10.7。8 bit 量子化と丸めを含む実測最大 12 と整合する。これはソフト変換の係数差を示す状況証拠である。

copyTo 経路は全行 Δ≤2 なので厳密なまま。maskFidelity と crossPath の判定も変更しない。実 GPU には B≤12 を適用せず、`run.mjs` が `glRenderer` と許容差 `[2,2,2]` を照合する。

## 時間予算

CI 実測で Electron 段の合計は約 195 秒。主な内訳は transitionParity 約 92 秒、fxCost 約 55 秒、lookParity 約 23 秒。FX の積み残しを段内で待つ時間も fxCost に含まれる。既定の 300 秒は実測の約 1.5 倍の余裕しかないため、golden-soft だけ Electron の期限を実測の約 3 倍の 600 秒へ、親プロセスをその 30 秒後へ延ばす。GPU drain 単体の期限 120 秒は fxCost 段の実測 55 秒を上回る。段ごとの開始と所要時間をログに出し、予算の消費を確認できるようにする。

## CI 実測

CI での 10 回の実測と run URL はプルリクエストに記録する。

## 手元の確認

Electron 39.8.7 を SwiftShader 指定で起動し、`results.pass=true`、direct 色パッチ 9 行合格、FX パス計測 60 フレーム、`frameLifetime` 1,000 フレーム close を確認した。破棄しない追加計測ではキューが約 100 ms で 29→0、差し替え後の実走では `decodeQueueDrainMs=52`・`decodeQueueSizeFinal=0` だった。filter の OSR 比較は invert・saturation・lut の 3 行が既存の閾値内で合格した。build、単体テスト 649 件（失敗 0、skip 4）、golden の型検査も通過した。
