import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

import { resolveFfmpeg } from "../../../media-bin/src/index.mjs";
import { calculateMotionMargin } from "./motion.mjs";
import { blendFrameBuffers, computeMouthTransitions } from "./mouth-transition.mjs";
import { calculatePartsMargin, decodePartImages, renderPartsFrame } from "./parts-render.mjs";

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

function transformedFrame(source, width, height, frame, margin) {
  const outputWidth = width + margin * 2;
  const outputHeight = height + margin * 2;
  const output = Buffer.alloc(outputWidth * outputHeight * 4);
  const radians = frame.rotateDeg * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const sourceCenterX = width / 2;
  const sourceCenterY = height / 2;
  const outputCenterX = outputWidth / 2 + frame.tx;
  const outputCenterY = outputHeight / 2 + frame.ty;

  const sample = (x, y, channel) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 0;
    return source[(y * width + x) * 4 + channel];
  };
  for (let outputY = 0; outputY < outputHeight; outputY += 1) {
    for (let outputX = 0; outputX < outputWidth; outputX += 1) {
      const dx = outputX + 0.5 - outputCenterX;
      const dy = outputY + 0.5 - outputCenterY;
      const sourceX = (cosine * dx + sine * dy) / frame.scaleX + sourceCenterX - 0.5;
      const sourceY = (-sine * dx + cosine * dy) / frame.scaleY + sourceCenterY - 0.5;
      const x0 = Math.floor(sourceX);
      const y0 = Math.floor(sourceY);
      const fx = sourceX - x0;
      const fy = sourceY - y0;
      const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      const points = [[x0, y0], [x0 + 1, y0], [x0, y0 + 1], [x0 + 1, y0 + 1]];
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let index = 0; index < 4; index += 1) {
        const [x, y] = points[index];
        const weight = weights[index];
        const pointAlpha = sample(x, y, 3);
        alpha += pointAlpha * weight;
        red += sample(x, y, 0) * pointAlpha * weight;
        green += sample(x, y, 1) * pointAlpha * weight;
        blue += sample(x, y, 2) * pointAlpha * weight;
      }
      const offset = (outputY * outputWidth + outputX) * 4;
      const roundedAlpha = Math.max(0, Math.min(255, Math.round(alpha)));
      output[offset + 3] = roundedAlpha;
      if (alpha > 0) {
        output[offset] = Math.max(0, Math.min(255, Math.round(red / alpha)));
        output[offset + 1] = Math.max(0, Math.min(255, Math.round(green / alpha)));
        output[offset + 2] = Math.max(0, Math.min(255, Math.round(blue / alpha)));
      }
    }
  }
  return output;
}

export async function bakeAvatarClip({
  spriteSet, mouthStates, eyeStates, fps, outPath, motionFrames = null, partFrames = null,
  partTransitions = null, mouthTransitionFrames = 0,
}, { ffmpegCommand } = {}) {
  if (mouthStates.length !== eyeStates.length || mouthStates.length === 0) throw new Error("口と目の状態列の長さが一致しません");
  if (motionFrames !== null && motionFrames.length !== mouthStates.length) {
    throw new Error("モーション列と口状態列の長さが一致しません");
  }
  const command = ffmpegCommand ?? resolveFfmpeg();
  if (spriteSet.kind === "parts-v2") {
    if (!Array.isArray(partFrames) || partFrames.length !== mouthStates.length) {
      throw new Error("parts.json v2 のパーツ変換列と口状態列の長さが一致しません");
    }
    if (partTransitions !== null && (!Array.isArray(partTransitions) || partTransitions.length !== mouthStates.length)) {
      throw new Error("parts.json v2 の口遷移列と口状態列の長さが一致しません");
    }
    const decoded = decodePartImages(spriteSet, command);
    const margin = partTransitions === null
      ? calculatePartsMargin(spriteSet, partFrames)
      : calculatePartsMargin(spriteSet, [
        ...partFrames,
        ...partTransitions.filter(Boolean).map((transition) => transition.fromRendered),
      ]);
    const width = spriteSet.manifest.size.width + margin * 2;
    const height = spriteSet.manifest.size.height + margin * 2;
    mkdirSync(dirname(outPath), { recursive: true });
    const child = spawn(command, [
      "-y", "-v", "error", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", `${width}x${height}`,
      "-framerate", String(fps), "-i", "pipe:0", "-frames:v", String(mouthStates.length),
      "-map_metadata", "-1", "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le",
      "-alpha_bits", "16", "-vendor", "apl0", "-an", outPath,
    ], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const variants = new Set();
    for (let index = 0; index < partFrames.length; index += 1) {
      const frame = partFrames[index];
      variants.add(frame.filter((part) => part.visible).map((part) => part.id).join("\0"));
      let rendered = renderPartsFrame(spriteSet, frame, decoded, margin);
      if (partTransitions?.[index]) {
        const fromRendered = renderPartsFrame(spriteSet, partTransitions[index].fromRendered, decoded, margin);
        rendered = blendFrameBuffers(fromRendered, rendered, partTransitions[index].t);
      }
      if (!child.stdin.write(rendered)) await once(child.stdin, "drain");
    }
    child.stdin.end();
    const [status] = await once(child, "close");
    if (status !== 0) throw new Error(`parts.json v2 アルファ付きクリップのベイクに失敗しました: ${stderr.trim()}`);
    return { outPath, frameCount: mouthStates.length, width, height, margin, variants: variants.size };
  }
  const transitions = mouthTransitionFrames > 0
    ? computeMouthTransitions(mouthStates, mouthTransitionFrames)
    : null;
  const variants = new Map();
  for (let index = 0; index < mouthStates.length; index += 1) {
    const key = `${mouthStates[index]}/${eyeStates[index]}`;
    if (!variants.has(key)) variants.set(key, composeVariant(spriteSet, mouthStates[index], eyeStates[index], command));
    if (transitions?.[index]) {
      for (const mouth of [transitions[index].from, transitions[index].to]) {
        const transitionKey = `${mouth}/${eyeStates[index]}`;
        if (!variants.has(transitionKey)) variants.set(transitionKey, composeVariant(spriteSet, mouth, eyeStates[index], command));
      }
    }
  }
  mkdirSync(dirname(outPath), { recursive: true });
  const sourceSize = spriteSet.manifest.size;
  const margin = motionFrames === null ? 0 : calculateMotionMargin(sourceSize.width, sourceSize.height, motionFrames);
  const width = sourceSize.width + margin * 2;
  const height = sourceSize.height + margin * 2;
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
    const transition = transitions?.[index];
    const variant = transition
      ? blendFrameBuffers(
        variants.get(`${transition.from}/${eyeStates[index]}`),
        variants.get(`${transition.to}/${eyeStates[index]}`),
        transition.t,
      )
      : variants.get(`${mouthStates[index]}/${eyeStates[index]}`);
    const frame = motionFrames === null
      ? variant
      : transformedFrame(variant, sourceSize.width, sourceSize.height, motionFrames[index], margin);
    if (!child.stdin.write(frame)) await once(child.stdin, "drain");
  }
  child.stdin.end();
  const [status] = await once(child, "close");
  if (status !== 0) throw new Error(`アルファ付きクリップのベイクに失敗しました: ${stderr.trim()}`);
  return { outPath, frameCount: mouthStates.length, width, height, margin, variants: variants.size };
}
