import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

import { resolveFfmpeg } from "../../../media-bin/src/index.mjs";

function composeVariant(spriteSet, mouth, eyes, ffmpegCommand) {
  const { width, height } = spriteSet.manifest.size;
  const result = spawnSync(ffmpegCommand, [
    "-v", "error", "-i", spriteSet.assets.base, "-i", spriteSet.assets[`mouth.${mouth}`],
    "-i", spriteSet.assets[`eyes.${eyes}`],
    "-filter_complex", "[0:v]format=rgba[base];[1:v]format=rgba[mouth];[2:v]format=rgba[eyes];"
      + "[base][mouth]overlay=format=auto[tmp];[tmp][eyes]overlay=format=auto,format=rgba[out]",
    "-map", "[out]", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1",
  ], { encoding: null, maxBuffer: width * height * 4 + 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`スプライト合成に失敗しました (${mouth}/${eyes}): `
      + String(result.stderr || result.error?.message).trim());
  }
  const expected = width * height * 4;
  if (result.stdout.length !== expected) throw new Error(`合成フレームの byte 数が不正です: ${result.stdout.length} != ${expected}`);
  return result.stdout;
}

export async function bakeAvatarClip({ spriteSet, mouthStates, eyeStates, fps, outPath }, { ffmpegCommand } = {}) {
  if (mouthStates.length !== eyeStates.length || mouthStates.length === 0) throw new Error("口と目の状態列の長さが一致しません");
  const command = ffmpegCommand ?? resolveFfmpeg();
  const variants = new Map();
  for (let index = 0; index < mouthStates.length; index += 1) {
    const key = `${mouthStates[index]}/${eyeStates[index]}`;
    if (!variants.has(key)) variants.set(key, composeVariant(spriteSet, mouthStates[index], eyeStates[index], command));
  }
  mkdirSync(dirname(outPath), { recursive: true });
  const { width, height } = spriteSet.manifest.size;
  const child = spawn(command, [
    "-y", "-v", "error", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", `${width}x${height}`,
    "-framerate", String(fps), "-i", "pipe:0", "-frames:v", String(mouthStates.length),
    "-map_metadata", "-1", "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le",
    "-alpha_bits", "16", "-vendor", "apl0", "-an", outPath,
  ], { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  for (let index = 0; index < mouthStates.length; index += 1) {
    const frame = variants.get(`${mouthStates[index]}/${eyeStates[index]}`);
    if (!child.stdin.write(frame)) await once(child.stdin, "drain");
  }
  child.stdin.end();
  const [status] = await once(child, "close");
  if (status !== 0) throw new Error(`アルファ付きクリップのベイクに失敗しました: ${stderr.trim()}`);
  return { outPath, frameCount: mouthStates.length, width, height, variants: variants.size };
}

