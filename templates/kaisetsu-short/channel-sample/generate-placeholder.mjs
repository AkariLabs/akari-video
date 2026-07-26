#!/usr/bin/env node
// generate-placeholder.mjs — チャンネルサンプル用プレースホルダキャラクター 8 態を
// ローカル手続き生成する（ImageMagick MVG ネイティブ描画・AI 生成は使わない。
// タスク契約 §個人情報分離: fal.ai 等の外部生成禁止）。
//
// 実装メモ: 当初 SVG テンプレート経由で試みたが、この環境の ImageMagick は
// rsvg-convert delegate 未導入で SVG の path/stroke が正しく描画されなかった
// （パッケージ追加インストール禁止のため rsvg 導入は避ける）。ImageMagick 自身の
// MVG（Magick Vector Graphics）ネイティブ描画は delegate 不要で path/circle/
// roundRectangle が正しく動くため、そちらを使う。
//
// 使い方: node channel-sample/generate-placeholder.mjs
import { mkdir, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "assets");
const W = 1024, H = 1536;

const BODY_COLOR = "#8a97a8";
const BODY_SHADE = "#6f7d8f";
const INK = "#2a2622";

function bodyMvg() {
  const cx = W / 2;
  return [
    `fill ${BODY_SHADE}`,
    `roundRectangle ${cx - 140},1080 ${cx - 20},1500 55,55`,
    `roundRectangle ${cx + 20},1080 ${cx + 140},1500 55,55`,
    `fill ${BODY_COLOR}`,
    `roundRectangle ${cx - 330},560 ${cx - 220},1000 55,55`,
    `roundRectangle ${cx + 220},560 ${cx + 330},1000 55,55`,
    `path 'M ${cx - 220},540 Q ${cx},470 ${cx + 220},540 L ${cx + 260},1120 Q ${cx},1190 ${cx - 260},1120 Z'`,
    `rectangle ${cx - 50},430 ${cx + 50},520`,
    `circle ${cx},300 ${cx},70`,
  ].join("\n");
}

function faceMvg(pose) {
  const cx = W / 2, cy = 300;
  const eyeY = cy - 30;
  const mouthY = cy + 110;
  const eyeR = pose === "surprised" || pose === "laugh" ? 26 : 18;

  const brow = {
    "neutral-closed": `M ${cx - 105},${eyeY - 45} Q ${cx - 80},${eyeY - 55} ${cx - 55},${eyeY - 45} M ${cx + 55},${eyeY - 45} Q ${cx + 80},${eyeY - 55} ${cx + 105},${eyeY - 45}`,
    "neutral-half": `M ${cx - 105},${eyeY - 45} Q ${cx - 80},${eyeY - 55} ${cx - 55},${eyeY - 45} M ${cx + 55},${eyeY - 45} Q ${cx + 80},${eyeY - 55} ${cx + 105},${eyeY - 45}`,
    "neutral-open": `M ${cx - 105},${eyeY - 45} Q ${cx - 80},${eyeY - 55} ${cx - 55},${eyeY - 45} M ${cx + 55},${eyeY - 45} Q ${cx + 80},${eyeY - 55} ${cx + 105},${eyeY - 45}`,
    happy: `M ${cx - 105},${eyeY - 50} Q ${cx - 80},${eyeY - 62} ${cx - 55},${eyeY - 50} M ${cx + 55},${eyeY - 50} Q ${cx + 80},${eyeY - 62} ${cx + 105},${eyeY - 50}`,
    sad: `M ${cx - 105},${eyeY - 35} Q ${cx - 80},${eyeY - 55} ${cx - 50},${eyeY - 50} M ${cx + 50},${eyeY - 50} Q ${cx + 80},${eyeY - 55} ${cx + 105},${eyeY - 35}`,
    angry: `M ${cx - 105},${eyeY - 30} L ${cx - 50},${eyeY - 55} M ${cx + 50},${eyeY - 55} L ${cx + 105},${eyeY - 30}`,
    surprised: `M ${cx - 105},${eyeY - 65} Q ${cx - 80},${eyeY - 75} ${cx - 55},${eyeY - 65} M ${cx + 55},${eyeY - 65} Q ${cx + 80},${eyeY - 75} ${cx + 105},${eyeY - 65}`,
    laugh: `M ${cx - 105},${eyeY - 55} Q ${cx - 80},${eyeY - 68} ${cx - 55},${eyeY - 55} M ${cx + 55},${eyeY - 55} Q ${cx + 80},${eyeY - 68} ${cx + 105},${eyeY - 55}`,
  }[pose];

  const mouthLines = {
    "neutral-closed": [`fill none`, `stroke ${INK}`, `stroke-width 10`, `stroke-linecap round`, `path 'M ${cx - 45},${mouthY} L ${cx + 45},${mouthY}'`],
    "neutral-half": [`fill ${INK}`, `stroke none`, `ellipse ${cx},${mouthY} 30,16 0,360`],
    "neutral-open": [`fill ${INK}`, `stroke none`, `circle ${cx},${mouthY} ${cx},${mouthY + 34}`],
    happy: [`fill none`, `stroke ${INK}`, `stroke-width 12`, `stroke-linecap round`, `path 'M ${cx - 55},${mouthY - 10} Q ${cx},${mouthY + 35} ${cx + 55},${mouthY - 10}'`],
    sad: [`fill none`, `stroke ${INK}`, `stroke-width 12`, `stroke-linecap round`, `path 'M ${cx - 50},${mouthY + 15} Q ${cx},${mouthY - 25} ${cx + 50},${mouthY + 15}'`],
    angry: [`fill none`, `stroke ${INK}`, `stroke-width 12`, `stroke-linecap round`, `path 'M ${cx - 50},${mouthY} Q ${cx},${mouthY - 15} ${cx + 50},${mouthY}'`],
    surprised: [`fill ${INK}`, `stroke none`, `circle ${cx},${mouthY} ${cx},${mouthY + 34}`],
    laugh: [`fill ${INK}`, `stroke none`, `path 'M ${cx - 65},${mouthY - 15} Q ${cx},${mouthY + 55} ${cx + 65},${mouthY - 15} Q ${cx},${mouthY + 20} ${cx - 65},${mouthY - 15} Z'`],
  }[pose];

  return [
    `fill ${INK}`,
    `stroke none`,
    `circle ${cx - 80},${eyeY} ${cx - 80 + eyeR},${eyeY}`,
    `circle ${cx + 80},${eyeY} ${cx + 80 + eyeR},${eyeY}`,
    `fill none`,
    `stroke ${INK}`,
    `stroke-width 10`,
    `stroke-linecap round`,
    `path '${brow}'`,
    ...mouthLines,
  ].join("\n");
}

const POSES = ["neutral-closed", "neutral-half", "neutral-open", "happy", "sad", "angry", "surprised", "laugh"];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}
function runCapture(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  for (const pose of POSES) {
    const mvg = [
      "push graphic-context",
      `viewbox 0 0 ${W} ${H}`,
      "stroke none",
      bodyMvg(),
      faceMvg(pose),
      "pop graphic-context",
    ].join("\n");
    const mvgPath = path.join(os.tmpdir(), `kaisetsu-placeholder-${pose}.mvg`);
    await writeFile(mvgPath, mvg);
    const pngPath = path.join(OUT_DIR, `fullbody-${pose}.png`);
    await run("magick", ["-background", "none", `mvg:${mvgPath}`, pngPath]);
    await rm(mvgPath);
    console.log(`[generate-placeholder] wrote ${pngPath}`);
  }

  // 全ポーズで bbox が一致することを検証する（実キャラの前提条件を踏襲）
  const bboxes = [];
  for (const pose of POSES) {
    const pngPath = path.join(OUT_DIR, `fullbody-${pose}.png`);
    const out = await runCapture("magick", [pngPath, "-format", "%@", "info:"]);
    const m = out.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/);
    if (!m) throw new Error(`trim bbox の解析に失敗: ${out}`);
    bboxes.push({ pose, w: Number(m[1]), h: Number(m[2]), x: Number(m[3]), y: Number(m[4]) });
  }
  console.log("[generate-placeholder] bbox per pose:", bboxes);
  const first = bboxes[0];
  const allSame = bboxes.every((b) => b.w === first.w && b.h === first.h && b.x === first.x && b.y === first.y);
  console.log(`[generate-placeholder] bbox identical across all poses: ${allSame}`);
  console.log(`[generate-placeholder] personBBox for channel.json: { "x": ${first.x}, "y": ${first.y}, "w": ${first.w}, "h": ${first.h} }`);
  if (!allSame) throw new Error("bbox がポーズ間で一致しない（personBBox 前提が崩れる）");
}

main().catch((err) => {
  console.error("[generate-placeholder] FAILED:", err);
  process.exit(1);
});
