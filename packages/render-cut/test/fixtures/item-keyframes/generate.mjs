import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function generateItemKeyframesFixture(projectRoot, { ffmpeg = "ffmpeg" } = {}) {
  const root = resolve(projectRoot);
  await mkdir(join(root, ".akari"), { recursive: true });
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n', "utf8");
  const result = spawnSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", "color=c=0x111111:s=640x360:r=30:d=5",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-g", "30", "-bf", "0", "-c:a", "aac", "-shortest", join(root, "source.mp4"),
  ], { encoding: "utf8", timeout: 60_000 });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr || `${ffmpeg} exited ${result.status}`);
  }
}
