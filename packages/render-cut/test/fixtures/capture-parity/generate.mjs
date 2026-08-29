import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function generateCaptureFixture(projectRoot, { ffmpeg = "ffmpeg" } = {}) {
  const root = resolve(projectRoot);
  const media = join(root, "media");
  await mkdir(join(root, ".akari"), { recursive: true });
  await mkdir(media, { recursive: true });
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n', "utf8");
  run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", "color=c=0xc62828:s=320x180:r=10:d=4",
    "-f", "lavfi", "-i", "color=c=0x1565c0:s=320x180:r=10:d=4",
    "-f", "lavfi", "-i", "color=c=0x2e7d32:s=320x180:r=10:d=4",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=12",
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
    "-map", "[v]", "-map", "3:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-g", "10", "-bf", "0", "-c:a", "aac", "-shortest", join(media, "source.mp4"),
  ]);
  run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", "color=c=0xffc107:s=96x54:r=10:d=12",
    "-vf", "drawbox=x=8:y=8:w=80:h=38:color=0x212121:t=5",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "10", "-bf", "0",
    join(media, "layer.mp4"),
  ]);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 60_000 });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr || `${command} exited ${result.status}`);
  }
}
