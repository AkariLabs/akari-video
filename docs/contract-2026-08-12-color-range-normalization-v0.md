# Color range normalization v0

## 1. 背景と目的

full-range（`color_range=pc` / `yuvj420p`）の入力をそのまま H.264 出力へ伝播させると、配信向けの limited range を期待する再生・検証環境で階調とメタデータが一致しない。本契約は Render の全エンコード工程を limited range（FFmpeg の `tv`）へ正規化し、最終成果物と中間生成物の一貫性を保証する。

この不具合の起点と再現条件は [公開 issue #21](https://github.com/AkariLabs/akari-video/issues/21) を参照する。

## 2. 最終出力の保証

MP4 / H.264 の最終映像ストリームは次を満たさなければならない。

- pixel format は `yuv420p`
- `color_range` は `tv`（limited range）

この組み合わせを AKARI Video の配信標準出力とする。

## 3. 値変換とメタデータの不変条件

色域レンジの正規化は、画素値の変換と映像ストリームへのメタデータのタグ付けを常に対で行う。

- 各 video filter chain は出力直前に `scale=out_range=tv` 相当の値変換を行う。
- 各 H.264 encode は `-color_range tv` 相当のメタデータを付ける。
- full-range の画素値を残したまま `tv` タグだけを付けることを禁止する。
- 値だけを limited range へ変換し、タグ付けを省略することも禁止する。

入力がすでに tv range の場合、`scale=out_range=tv` はレンジ変換について no-op として扱う。

## 4. 工程不変

cut、tail padding、track stack、layers、overlay composite を含む各エンコード工程の出力フレームは常に tv range とする。これは最終成果物だけでなく、後続工程へ渡す中間生成物にも適用する。

複数ソースの cut では、ソースごとの前処理チェーンで tv range へ正規化してから concat / transition へ入力する。これにより pc / tv range が混在したフレームを同じ concat へ直接渡さない。さらに、LUT や合成後の工程出力も終端で tv range に正規化する。

映像を再エンコードしない audio-only mux と、alpha を運ぶ非 H.264 overlay 中間生成物は本契約の対象外とする。

## 5. Probe と provenance

入力ソースの `pix_fmt` と `color_range` を ffprobe の映像ストリームから取得し、既存の duration、audio 有無、width、height、fps と同じ provenance 情報として記録する。ffprobe が入力の `color_range` を報告しない場合は `null` として記録し、推測値で置き換えない。

## 6. Verify 契約

レンダープランの期待値へ `color_range: "tv"` を追加し、official verify は `verify.color-range` を報告する。

- 実測 `color_range` が `pc` の場合は error とする。
- 実測が `tv` の場合は pass とする。
- ffprobe が `color_range` を報告しない場合は、H.264 の仕様既定（未指定は limited range）に従って tv とみなし pass とする。

`verify.pixel-format` の期待値 `yuv420p` は維持し、`verify.color-range` と独立に判定する。

## 7. 予約（今回のスコープ外）

次の事項は別契約で扱い、本契約 v0 では実装しない。

- BT.601 から BT.709 などの colorspace 変換
- `-colorspace` / `-color_primaries` / `-color_trc` による colorspace メタデータの正規化
- 10bit および HDR 入力の変換、tone mapping、出力形式

本契約の `tv` 正規化は color range のみに限定され、上記の色域・伝達特性変換を暗黙に保証しない。
