# 契約 — export-nle: 他社 NLE への書き出し（BETA・実 NLE 取り込み未確認）

- 実装: `packages/export-nle/`（CLI: `bin/export-nle.mjs`）/ 入口スキル: `skills/export-nle/`
- 地位: **beta-unverified** — 実装とユニットテスト（構造・時間量子化・写像）は済み。
  **実 Final Cut Pro / DaVinci Resolve / Premiere Pro への取り込み検証は未実施**
- 方向: **片道書き出しのみ**。NLE → edit.json の逆輸入は本契約のスコープ外（別契約になるまで着手しない）

## 1. ターゲット形式

| 出力 | 形式 | 想定インポータ |
|---|---|---|
| `<project>.fcpxml` | FCPXML 1.11 | Final Cut Pro / DaVinci Resolve |
| `<project>.premiere.xml` | FCP7 XML（xmeml v5） | Premiere Pro |
| `<project>.srt` | SRT | 全 NLE（captions.json 存在時のみ） |
| `export-report.json` | レポート | `written[]` / `dropped[]` / `warnings[]` |

`.prproj`（非公開形式）と CapCut draft（非公式・暗号化進行中）は狙わない。CapCut は需要が
確認できた時点で lab スパイクとして別途判断する。

## 2. 時間の量子化（丸めポリシー）

- edit.json の秒 float は**必ず出力先のフレーム境界へ最近傍丸め**してから書く
- FCPXML: `output.fps` を frameDuration 有理数へ変換（NTSC 系 23.976/29.97/59.94 →
  1001/24000・1001/30000・1001/60000。整数 fps → 1/fps。その他 → ms 精度の有理数）。
  全時刻は「フレーム数 × frameDuration」の約分済み有理数秒で表記
- xmeml: 整数フレーム。NTSC 系は timebase 30/24/60 + `ntsc TRUE` とし、フレーム番号は
  真の fps（30000/1001 等）で丸める
- SRT: ms 精度

## 3. タイムライン意味論（render-cut との整合）

- カット配置・speed・xfade 重複・(src, source 秒) アンカー写像の**意味論の正本は
  `packages/render-cut/src/cut-timeline.mjs` / `captions.mjs`**。export-nle は同じ式を
  最小移植している（依存回避のため。render-cut 側が変わったら export-nle も追随する）
- `at` / `track` 指定のない編集: 逐次連結 + xfade 重複減算（`computeCutTimelineOffsets` 同等）
- `at` / `track` 指定のある編集（gap-aware）: 絶対配置。**この場合 transition_out は
  書き出さない**（境界が隣接に限らないため。dropped で明示）
- captions / beats / emphasis_words の start/end/t は timeline 秒ではなく (src, source 秒)
  アンカー。書き出し時に cuts を通して timeline へ写像し、どのカットにも含まれない
  アンカーは dropped に落とす

## 4. フィールド別マッピング

### 移る

| edit.json | FCPXML | xmeml | 備考 |
|---|---|---|---|
| cuts[].in/out/at/track | asset-clip offset/start/duration | clipitem start/end/in/out | |
| cuts[].speed | timeMap 2 点（⚠推定） | timeremap 定速（⚠推定） | 等速のみ |
| cuts[].transform | adjust-transform（⚠座標系未検証） | Basic Motion（⚠center 未検証） | |
| cuts[].opacity | adjust-blend amount | Opacity filter | |
| transition_out dissolve | 子要素なし transition（= 既定 cross dissolve） | Cross Dissolve transitionitem | §5 の近似 |
| transition_out fade-black/white | cross dissolve **近似** + dropped | 同左 | dip to color は手動再設定 |
| layers（baked/video） | lane 2+ の connected clip | 上位 video track | アルファ付き mov はただのクリップ |
| layers[].blend | adjust-blend mode（⚠未検証） | **落ちる**（warning） | |
| audio.narration | lane -1 / role dialogue | audio track | gain は adjust-volume / audiolevels |
| audio.sfx | lane -2-（track）/ role effects | audio track（sfx track 単位） | in/out 対応 |
| audio.bgm | 実尺までループ展開 + fade キーフレーム（⚠推定） | 同左 | 実尺不明時は全体尺 1 クリップ + warning |
| beats / emphasis_words | クリップ上の marker（source 秒のまま） | シーケンスマーカー（timeline へ写像） | 意味層はマーカーへ退化 |
| captions.json | —（SRT へ） | —（SRT へ） | display_text 優先・プレーンテキスト |

### 移らない（dropped[] に全件列挙 — 黙って落とさない）

audio.bgm.ducking / audio.master（loudnorm・denoise）/ output.look（LUT）/
sources[].chroma_key・layers[].chroma_key / direction / 字幕スタイル（style・text_style・words）/
カット範囲外の beats・emphasis_words アンカー

## 5. 既知の近似（ベータの明示的トレードオフ）

1. **xfade**: AKARI レンダは重複区間の全時間 xfade。書き出しは「前カットの可視尺を重複分
   詰めて突き合わせ + 境界中央寄せの transition」。**カット点と後続の同期は保存**されるが、
   境界内のフレーム内容は近似
2. **speed の交換表現**（FCPXML timeMap / xmeml timeremap）は仕様書と輸出物観察に基づく
   推定実装。取り込み検証が最優先の未確認点
3. **音量フェードのキーフレーム表現**（FCPXML adjust-volume param / xmeml audiolevels）は
   取り込み側で無視されても成立する（フェードが落ち、gain は残る）
4. メディアは**絶対パスの file URL 参照**。プロジェクト移動後は NLE 側 relink が前提

## 6. 実行契約

- 決定的 CLI（LLM 判断・乱数・現在時刻を混ぜない）。外部 npm 依存ゼロ、ffprobe は
  media-bin 解決の本体直叩きのみ（`--no-probe` で完全オフライン、音声はプレースホルダ尺 + warning）
- 読み取り専用: edit.json / captions.json を書き換えない。書き込みは `--out`（既定
  `<project>/exports/nle/`）のみ
- exit 0 = 書き出し完了（warnings 可）/ exit 2 = 入力・環境エラー

## 7. ベータ卒業の条件（このリストが空になったら BETA 表記を外す）

- [ ] Final Cut Pro 実機で fcpxml 取り込み確認（カット位置・音声同期・マーカー）
- [ ] DaVinci Resolve 実機で fcpxml 取り込み確認（同上）
- [ ] Premiere Pro 実機で premiere.xml 取り込み確認（同上 + timeremap / Basic Motion）
- [ ] speed・transform・フェードの取り込み結果を §5 の近似メモへ反映（必要なら実装修正）
- [ ] 取り込みテストの再現手順を verify スキル系列（L 系）に載せるか判断

検証結果は本ファイルへ**追記**で記録する（結論の書き換えではなく履歴として残す）。
