#!/usr/bin/env node
// catalog/luts/bake-luts.mjs
//
// Generates the two initial catalog/luts/*.cube files from parameterized presets. Ported (not
// copied wholesale) from the read-only reference implementation
// akari-os/akari-video-on-os/src/lib/color-grade.ts — same operation order and formulas
// (① exposure → ② temperature/tint → ③ contrast → ④ saturation → ⑥ CDL lift/gamma/gain/offset;
// ⑤ external LUT and ⑦ vignette are not applicable when *building* a LUT from scratch), reduced to
// the subset of parameters these two presets actually use.
//
// Usage: node catalog/luts/bake-luts.mjs
// Regenerates natural.cube and cinematic.cube deterministically from the PRESETS table below.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const SIZE = 33; // matches color-grade.ts's BAKE_CUBE_SIZE

const REC709 = { r: 0.2126, g: 0.7152, b: 0.0722 };
const TEMP_COEF = 0.18;
const TINT_COEF = 0.12;
const CONTRAST_PIVOT = 0.5;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// Same per-channel CDL evaluation as color-grade.ts's applyCdlChannel (lift -> gamma -> gain -> offset).
function applyCdlChannel(v, lift, gamma, gain, offset) {
  let c = v * (1 - lift) + lift;
  c = Math.pow(Math.max(0, c), 1 / (1 + gamma));
  c *= 1 + gain;
  return clamp01(c + offset);
}

function applyGrade(r, g, b, p) {
  let cr = r;
  let cg = g;
  let cb = b;

  // ① exposure
  if (p.exposure) {
    const mult = Math.pow(2, p.exposure);
    cr *= mult;
    cg *= mult;
    cb *= mult;
  }

  // ② temperature / tint
  cr *= 1 + (p.temperature ?? 0) * TEMP_COEF;
  cb *= 1 - (p.temperature ?? 0) * TEMP_COEF;
  cg *= 1 - (p.tint ?? 0) * TINT_COEF;
  cr = clamp01(cr);
  cg = clamp01(cg);
  cb = clamp01(cb);

  // ③ contrast (pivot 0.5)
  if (p.contrast) {
    const k = 1 + p.contrast;
    cr = clamp01((cr - CONTRAST_PIVOT) * k + CONTRAST_PIVOT);
    cg = clamp01((cg - CONTRAST_PIVOT) * k + CONTRAST_PIVOT);
    cb = clamp01((cb - CONTRAST_PIVOT) * k + CONTRAST_PIVOT);
  }

  // ④ saturation (Rec.709 luma-weighted)
  if (p.saturation) {
    const luma = cr * REC709.r + cg * REC709.g + cb * REC709.b;
    const k = 1 + p.saturation;
    cr = clamp01(luma + (cr - luma) * k);
    cg = clamp01(luma + (cg - luma) * k);
    cb = clamp01(luma + (cb - luma) * k);
  }

  // ⑥ CDL wheels (lift -> gamma -> gain -> offset, per channel)
  cr = applyCdlChannel(cr, p.lift_r ?? 0, p.gamma_r ?? 0, p.gain_r ?? 0, p.offset_r ?? 0);
  cg = applyCdlChannel(cg, p.lift_g ?? 0, p.gamma_g ?? 0, p.gain_g ?? 0, p.offset_g ?? 0);
  cb = applyCdlChannel(cb, p.lift_b ?? 0, p.gamma_b ?? 0, p.gain_b ?? 0, p.offset_b ?? 0);

  return [cr, cg, cb];
}

function bakeCube(name, params, size = SIZE) {
  const last = size - 1;
  const lines = [`# akari-video catalog LUT: ${name}`, `LUT_3D_SIZE ${size}`];
  for (let bz = 0; bz < size; bz += 1) {
    for (let gy = 0; gy < size; gy += 1) {
      for (let rx = 0; rx < size; rx += 1) {
        const [r, g, b] = applyGrade(rx / last, gy / last, bz / last, params);
        lines.push(`${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

const PRESETS = {
  natural: {
    // Gentle, safe-default grade: a touch more punch and warmth without a strong "look".
    contrast: 0.08,
    saturation: 0.1,
    temperature: 0.03,
  },
  cinematic: {
    // Teal-shadow / orange-highlight film look: lift_b raises blue (and lift_r lowers red) in the
    // shadows for a teal cast; gain_r raises red in the highlights for an orange cast.
    temperature: 0.05,
    contrast: 0.16,
    saturation: -0.08,
    lift_r: -0.03,
    lift_b: 0.04,
    gain_r: 0.05,
    gain_b: -0.02,
  },
};

for (const [name, params] of Object.entries(PRESETS)) {
  const cube = bakeCube(name, params);
  // catalog/<category>/<item-id>/ layout, matching every other catalog/* entry in this repo
  // (catalog/audio, catalog/3d, catalog/font all use one directory per item with meta.json inside).
  const outPath = join(OUT_DIR, name, `${name}.cube`);
  writeFileSync(outPath, cube, "utf8");
  console.log(`wrote ${outPath} (${cube.split("\n").length - 1} lines)`);
}
