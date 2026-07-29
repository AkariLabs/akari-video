// find-ffmpeg — 連番 PNG を動画へ束ねるのに ffmpeg を使う。
// 無いときは黙って失敗せず、OS ごとの入れ方を出す。

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";

function canRun(command) {
  return new Promise((resolve) => {
    const child = spawn(command, ["-version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

const INSTALL_HINT = {
  darwin: "  brew install ffmpeg",
  win32: "  winget install Gyan.FFmpeg    （または https://ffmpeg.org/download.html）",
  linux: "  sudo apt install ffmpeg       （Debian/Ubuntu 系）",
};

export async function findFfmpeg(explicitPath) {
  const candidate = explicitPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  if (explicitPath && !existsSync(explicitPath)) {
    throw new Error(`--ffmpeg で指定されたファイルがありません: ${explicitPath}`);
  }
  if (await canRun(candidate)) return candidate;

  throw new Error(
    [
      "ffmpeg が見つかりませんでした。動画の書き出しに必要です。",
      "",
      INSTALL_HINT[platform()] ?? "  https://ffmpeg.org/download.html",
      "",
      "入れたあと、パスを直接渡すこともできます:  --ffmpeg /path/to/ffmpeg",
      "PNG 連番だけでよければ ffmpeg なしで書き出せます:  --png-sequence <出力先ディレクトリ>",
    ].join("\n"),
  );
}
