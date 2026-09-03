import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function generateCommentSafeActiveFixture(projectRoot, { ffmpeg = "ffmpeg" } = {}) {
  const root = resolve(projectRoot);
  await mkdir(join(root, ".akari"), { recursive: true });
  await mkdir(join(root, "media"), { recursive: true });
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n', "utf8");
  const output = join(root, "media", "background.mp4");
  const result = spawnSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", "color=c=0x101820:s=320x180:r=10:d=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "10", "-bf", "0", output,
  ], { encoding: "utf8", timeout: 60_000 });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr || `${ffmpeg} exited ${result.status}`);
  }
}
