import { spawnSync } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { resolveFfmpeg } from "../../../media-bin/src/index.mjs";

const FONT_CANDIDATES = [
  "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
  "/System/Library/Fonts/HelveticaNeue.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
];

const exists = (path) => access(path).then(() => true, () => false);
const escapeDrawtext = (value) => String(value).replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "’").replaceAll("%", "％");

export async function createTextCard({
  outputPath,
  id,
  text,
  env = process.env,
  spawn = spawnSync,
  resolveBinary = resolveFfmpeg,
  fontCandidates = FONT_CANDIDATES,
  logWarn = (line) => console.warn(line),
}) {
  let ffmpeg;
  try {
    ffmpeg = resolveBinary({ env });
  } catch (error) {
    logWarn(`WARN: ffmpeg を解決できないため文字カード ${id} をスキップします: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return { ok: false, skipped: true, reason: "ffmpeg を解決できません" };
  }
  const font = (await Promise.all(fontCandidates.map(async (path) => await exists(path) ? path : null))).find(Boolean);
  const lines = [id, String(text ?? "").slice(0, 40)];
  const filters = [];
  if (font) {
    filters.push(`drawtext=fontfile='${escapeDrawtext(font)}':text='${escapeDrawtext(lines[0])}':fontcolor=white:fontsize=54:x=(w-text_w)/2:y=h/2-48`);
    filters.push(`drawtext=fontfile='${escapeDrawtext(font)}':text='${escapeDrawtext(lines[1])}':fontcolor=white:fontsize=38:x=(w-text_w)/2:y=h/2+32`);
  } else {
    logWarn(`WARN: 使用できるフォントが無いため ${id} は文字なしの単色カードにします`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const baseArgs = ["-y", "-f", "lavfi", "-i", "color=c=0x202020:s=1920x1080", "-frames:v", "1"];
  const args = filters.length > 0
    ? [...baseArgs, "-vf", filters.join(","), outputPath]
    : [...baseArgs, outputPath];
  let result = spawn(ffmpeg, args, { encoding: "utf8", env });
  if (filters.length > 0 && (result.error || result.status !== 0)) {
    const fallback = spawn(ffmpeg, [...baseArgs, outputPath], { encoding: "utf8", env });
    if (!fallback.error && fallback.status === 0) {
      logWarn(`WARN: drawtext が使えないため文字カード ${id} は文字なしの単色カードにしました`);
      return { ok: true, width: 1920, height: 1080 };
    }
    result = fallback;
  }
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? String(result.stderr || `exit ${result.status}`).trim().split("\n").at(-1);
    logWarn(`WARN: 文字カード ${id} を作れませんでした: ${reason}`);
    return { ok: false, skipped: true, reason };
  }
  return { ok: true, width: 1920, height: 1080 };
}
