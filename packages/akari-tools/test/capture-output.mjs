import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { encodeRgbaPng } from "../../osr-export/src/png.mjs";
import { renderLabeledContactSheetFromPngs } from "../src/capture/output.mjs";

test("capture contact sheets use the shared labeled renderer and stay within the media bounds", async (t) => {
  const ffmpeg = resolveFfmpeg();
  const ffprobe = resolveFfprobe();
  if (spawnSync(ffmpeg, ["-version"]).status !== 0 || spawnSync(ffprobe, ["-version"]).status !== 0) {
    return t.skip("ffmpeg or ffprobe unavailable");
  }
  const root = await mkdtemp(join(tmpdir(), "capture-output-"));
  try {
    const frames = [];
    for (let index = 0; index < 3; index += 1) {
      const pixels = new Uint8Array(320 * 180 * 4);
      for (let offset = 0; offset < pixels.length; offset += 4) {
        pixels[offset + index] = 255;
        pixels[offset + 3] = 255;
      }
      const path = join(root, `source-${index}.png`);
      await writeFile(path, encodeRgbaPng(pixels, 320, 180));
      frames.push(path);
    }
    const output = join(root, "sheet.png");
    await renderLabeledContactSheetFromPngs({
      ffmpegCommand: ffmpeg,
      frames,
      labels: ["0f", "03s", "06s"],
      output,
      directory: join(root, "work"),
      width: 320,
      height: 180,
      cwd: root,
    });
    const probe = spawnSync(ffprobe, [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt",
      "-of", "json", output,
    ], { encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr);
    const stream = JSON.parse(probe.stdout).streams[0];
    assert.ok(stream.width <= 2576);
    assert.ok(stream.height <= 1456);
    assert.equal(stream.pix_fmt, "rgb24");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
