import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { expressionValues } from "./drive.mjs";
import { addHeadDrive, computeIdleOffsets, modelBytesSeed } from "./idle-motion.mjs";
import { BAKE_SIZE } from "./layer.mjs";
import { launchAvatarVrmBrowser } from "./browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function numeric(value) {
  return Number(Number(value).toFixed(8)).toString();
}

export async function bakeAvatarVrmClip({
  modelPath,
  drive,
  framing,
  outPath,
  ffmpegCommand,
  idleEnabled = true,
  idleIntensity = 0.35,
  idleSeed = null,
  springbone = true,
}) {
  mkdirSync(dirname(outPath), { recursive: true });
  const modelBytes = readFileSync(modelPath);
  const effectiveIdleSeed = idleSeed ?? modelBytesSeed(modelBytes);
  const frameDir = mkdtempSync(join(tmpdir(), "akari-avatar-vrm-frames-"));
  const browser = await launchAvatarVrmBrowser();
  let page;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: BAKE_SIZE.width, height: BAKE_SIZE.height, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await page.goto(pathToFileURL(join(HERE, "render.html")).href, {
      waitUntil: "load",
      timeout: 180_000,
    });
    await page.waitForFunction(() => document.body.dataset.ready === "true", { timeout: 180_000 });
    const loaded = await page.evaluate(
      ({ url, framingValue }) => window.avatarVrmRenderer.loadModel(url, framingValue),
      {
        url: `data:model/gltf-binary;base64,${modelBytes.toString("base64")}`,
        framingValue: framing,
      },
    );
    for (let frame = 0; frame < drive.mouth.length; frame += 1) {
      const expressions = expressionValues(drive.mouth[frame], drive.eyes[frame]);
      const boneOffsets = idleEnabled || drive.head !== undefined
        ? addHeadDrive(computeIdleOffsets({
          frame,
          fps: drive.fps,
          intensity: idleEnabled ? idleIntensity : 0,
          seed: effectiveIdleSeed,
        }), drive.head?.[frame])
        : null;
      await page.evaluate(
        (next) => window.avatarVrmRenderer.renderExpressions(next.expressions, next.boneOffsets, next.deltaTime),
        { expressions, boneOffsets, deltaTime: springbone ? 1 / drive.fps : 0 },
      );
      await page.screenshot({
        path: join(frameDir, `frame-${String(frame).padStart(6, "0")}.png`),
        omitBackground: true,
        type: "png",
      });
    }
    if (pageErrors.length > 0) throw new Error(`renderer page error: ${pageErrors.join(" | ")}`);
    const args = [
      "-y", "-v", "error", "-framerate", numeric(drive.fps),
      "-i", join(frameDir, "frame-%06d.png"),
      "-frames:v", String(drive.mouth.length),
      "-map_metadata", "-1",
      "-fflags", "+bitexact", "-flags:v", "+bitexact",
      "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le",
      "-alpha_bits", "16", "-vendor", "apl0", "-an", outPath,
    ];
    const encoded = spawnSync(ffmpegCommand, args, { encoding: "utf8" });
    if (encoded.error || encoded.status !== 0) {
      throw new Error(String(encoded.stderr ?? encoded.error?.message ?? `ffmpeg exited ${encoded.status}`).slice(0, 4000));
    }
    return {
      frameCount: drive.mouth.length,
      fps: drive.fps,
      width: BAKE_SIZE.width,
      height: BAKE_SIZE.height,
      expressions: loaded.expressions,
      springboneJoints: loaded.springboneJoints,
      threeRevision: loaded.threeRevision,
      idleSeed: effectiveIdleSeed,
      ffmpegArgs: args,
    };
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close().catch(() => {});
    rmSync(frameDir, { recursive: true, force: true });
  }
}
