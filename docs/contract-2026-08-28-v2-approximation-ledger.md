# エンジン v2 恒久近似清算表

制定日: 2026-08-28

## 1. 目的と判定規則

本表は、プレビュー、legacy 書き出し、エンジン v2 の間に蓄積した恒久近似を一件ずつ清算する正本である。
状態は次の三つに限る。

- **解消**: `packages/frame-engine/test/golden` の点群、`test:seek`、または契約に記録された実測値がある。
- **残す近似**: 即時プレビューと納品処理の役割差、または互換期間中の legacy 固有差として意図的に残す。
- **別票**: v2 の合否から切り離し、表中の起票候補名で追跡する。

「解消」には必ず同じ行に検収点群または実測値を記す。ゴールデンは raw frame の `diff 0`、否定側は
1 px の故意差分が必ず FAIL することを前提とする。OSR の決定論はソフト描画 2 走の全コマ SHA-256
一致で判定し、GPU の byte-exact は合否条件にしない。

## 2. 清算表

| 近似の名前 | 出典 | legacy での挙動 | v2 での状態 | 証跡・理由・別票候補 |
|---|---|---|---|---|
| freeze の尺伸び非再現 | preview-parity 旧 §2.4.3 | 表示を実時間停止するだけで出力尺を伸ばさず、映像と全音声を一緒に停止した | **解消** | resolved timeline が後続 cut を移動し、freeze を含む base parity 28 点が `diff 0`。長時間の寿命検収は `frameLifetime = 1000` コマ |
| screen FX の `noise` / `particles` / `flare` | preview-parity 旧 §2.4.5 | 縮小 canvas、4 輝点、CSS gradient で ffmpeg の式を近似した | **別票** | ゴールデンに当該 3 FX の画素点がないため解消扱いにしない。候補名: **screen FX 3 種の決定論的カーネル化** |
| `cuts[].transform.rotate` のバウンディングボックス | preview-parity 旧 §2.4.6 | CSS の箱を拡大せず、legacy の `rotw` / `roth` と透明パディング縁がずれ得た | **解消** | 同じ frame-engine 評価関数を器と出口が消費する。cut transform / opacity を含む base parity 28 点が `diff 0` |
| `cuts[].framing` + `cuts[].transform` 併用 | preview-parity 旧 §2.4.2 | 同一 `<video>` の `transform-origin` が競合し、scale / rotate の pivot が左上へずれた | **解消** | framing と transform を同じ frame-engine 内で合成。組合せを含む base parity 28 点が `diff 0` |
| ducking -12 dB 矩形 | preview-parity 旧 §2.5、audio-roles §2・§3.2・§4 | narration 区間内を瞬時に固定 -12 dB とし、`sidechaincompress` の attack / release とレベル依存を持たない | **残す近似** | G3 裁定で維持。master 無しの実測は preview -11.628 dB、書き出し -9.956 dB、差 -1.672 dB。共通化する場合の候補名: **ducking 共通エンベロープ** |
| transition 音声の acrossfade | preview-parity 旧 §2.5 | cut 境界で前後 2 音源を同時混合せず、境界 seek で切り替えた | **残す近似** | 映像ゴールデンは音声波形を検収しない。納品音声は ffmpeg `acrossfade` を正とし、即時プレビューとの差を明示して残す |
| `dissolve` 非描画 / xfade 擬似乱数差 | preview-parity 旧 §2.6、#60 | 一部器で描画されないか、ffmpeg xfade と別の乱数・補間になり得た | **解消** | `transitionParity = 90` 点と `transitionSemantics = 30` 点が `diff 0`。否定側は 1 px 差で必ず FAIL |
| `fade-black` / `fade-white` のカーブ | preview-parity 旧 §2.6 | CSS opacity と ffmpeg xfade の曲線差を許容した | **解消** | 5 transition を網羅する `transitionParity = 90` 点と意味論 `transitionSemantics = 30` 点が `diff 0` |
| YUV→RGB の bt601 / bt709 差 | OSR §11.2 | 未タグ素材を bt601 として換算し、v2 の色とずれた | **残す近似** | G3 裁定は v2 の `bt709-limited` が正。legacy 比は bt601 で MAD 9.28 / maxDelta 155、bt709 で MAD 0.886。残差はクロマ補間由来 |
| B フレームが 2 コマ手前になるずれ | OSR §11.1 | 負の DTS と edit list の media time を補正せず、提示フレームが一定 2 コマ早かった | **解消** | main `b30057de` で根治。`bFrame = 160` sampled 行（summary 10）、`bFrameTail = 24` 行（`bframe-tail-duration`）、`test:seek` の `bFrame.rows = 720`（coverage full）と `bFrameTail.rows = 24`。末尾 `finalFrameNumber = 239` |
| GOP 末尾 seek | preview-parity 旧検収節、#58 | GOP 末尾の warm-up / lookahead が不足し、末尾フレームを安定して選べない場合があった | **解消** | golden `gopTail = 9` 点、`test:seek requestCount = 94`、`performance.lookahead.hits = 8` |
| 静止画 cut の `<img>` 出し分け | still-image §5.2 | `<video>` を作り直さず、重ねた `<img>` の表示を切り替えて音声グラフを維持した | **別票** | 互換 `<video>` 器だけの分岐であり、frame-engine golden の画素点を証跡にできない。候補名: **v2 器への静止画 cut 統合と img 分岐退役** |
| `audio.master` の badge のみ | preview-parity 旧 §3、audio-roles §1・§5 | UI は badge を示すだけで `afftdn` / `loudnorm` / true peak guard を再現しない | **残す近似** | 即時プレビューは納品音声を保証しないという役割分担。master あり実測は I -14.3 LUFS、LRA 5.7 LU、TP -10.7 dBFS |
| `loudnorm` / true peak guard / `afftdn` | audio-roles §2・§5 | プレビューでは適用せず、ffmpeg マスターだけで処理した | **残す近似** | G3 裁定で維持。master 無し / ありの実測は I -12.3 / -14.3 LUFS、LRA 11.5 / 5.7 LU、TP -14.7 / -10.7 dBFS |
| legacy 書き出しの Chrome ラスタ揺れ ±1 px | OSR §9、#90 §5.4 | 同じ入力でも Chrome ラスタ境界が ±1 px 揺れ、legacy 出力を byte-exact にできなかった | **残す近似** | 互換期間中の legacy 固有差。v2 の合否は OSR ソフト描画 2 走の全コマ SHA-256 一致へ移し、legacy byte-exact を合否条件にしない |

## 3. 集計

- 解消: **7 件**
- 残す近似: **6 件**
- 別票: **2 件**
- 合計: **15 件**

別票は [エンジン v2 残課題](./notes-2026-08-28-engine-v2-open-items.md) に集約する。状態を変更する場合は、
この表の証跡欄と検収契約を同時に更新する。
