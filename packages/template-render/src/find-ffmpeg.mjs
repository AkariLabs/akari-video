// find-ffmpeg — 連番 PNG を動画へ束ねるのに ffmpeg を使う。
// 無いときは黙って失敗せず、OS ごとの入れ方を出す。
// 実体解決は media-bin へ委譲（AKARI_FFMPEG_BIN → FFMPEG_PATH 既存互換 → PATH →
// ffmpeg-static 同梱バイナリ）。--ffmpeg 明示指定はそれらより優先する。

import { existsSync } from "node:fs";
import { resolveFfmpeg } from "../../media-bin/src/index.mjs";

export async function findFfmpeg(explicitPath) {
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new Error(`--ffmpeg で指定されたファイルがありません: ${explicitPath}`);
    }
    return explicitPath;
  }

  try {
    return resolveFfmpeg();
  } catch (cause) {
    throw new Error(
      [
        cause.message,
        "",
        "パスを直接渡すこともできます:  --ffmpeg /path/to/ffmpeg",
        "PNG 連番だけでよければ ffmpeg なしで書き出せます:  --png-sequence <出力先ディレクトリ>",
      ].join("\n"),
    );
  }
}
