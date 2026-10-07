import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { encodeRgbaPng } from '../../../../../../packages/osr-export/src/png.mjs';
import { CASES, FRAMES } from './fixtures.mjs';

function decodePng(bytes) {
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), channels = bytes[25] === 6 ? 4 : 3;
  if (bytes[24] !== 8 || ![2, 6].includes(bytes[25]) || bytes[28] !== 0) throw new Error('Unsupported PNG');
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (kind === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const data = inflateSync(Buffer.concat(chunks));
  const pixels = Buffer.alloc(width * height * channels), stride = width * channels;
  const paeth = (a, b, c) => { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c; };
  for (let row = 0; row < height; row++) for (let col = 0; col < stride; col++) {
    const i = row * stride + col, raw = row * (stride + 1) + col;
    const a = col >= channels ? pixels[i - channels] : 0, b = row ? pixels[i - stride] : 0;
    const c = row && col >= channels ? pixels[i - stride - channels] : 0;
    const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][data[row * (stride + 1)]];
    if (predictor === undefined) throw new Error('Unsupported PNG filter');
    pixels[i] = (data[raw + 1] + predictor) & 255;
  }
  return { width, height, channels, pixels };
}

function bounds(image, region = { left: 0, right: image.width, top: 0, bottom: image.height }) {
  let left = image.width, top = image.height, right = -1, bottom = -1;
  for (let y = region.top; y < region.bottom; y++) for (let x = region.left; x < region.right; x++) {
    const offset = (y * image.width + x) * image.channels;
    const [r, g, b] = image.pixels.subarray(offset, offset + 3);
    if (g > r + 35 && g > b + 15 && g > 80) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  return { left, top, width: right < left ? 0 : right - left + 1, height: bottom < top ? 0 : bottom - top + 1 };
}

function assetPixels(image) {
  const sample = (x, y) => [...image.pixels.subarray((y * image.width + x) * image.channels,
    (y * image.width + x) * image.channels + 3)];
  const blue = sample(80, 90), red = sample(230, 90);
  return { blue, red, pass: blue[2] > blue[0] + 80 && red[0] > red[2] + 80 };
}

export function launcherTierFromSurfaces(surfaces = []) {
  const exports = surfaces.filter(entry => entry.surface === 'gpu' || entry.surface === 'osr');
  return exports.length > 0 && exports.every(entry => entry.receipt?.launcherTier === 2) ? 2 : null;
}

export async function recomputeComparisons(report, out, { requireComplete = false } = {}) {
  report.comparisons = [];
  report.visualChecks = [];
  report.launcherChecks = (report.surfaces ?? [])
    .filter(entry => entry.surface === 'gpu' || entry.surface === 'osr')
    .map(entry => ({ name: `launcher-tier:${entry.fixture}/${entry.surface}`,
      launcherTier: entry.receipt?.launcherTier ?? null,
      pass: entry.receipt?.launcherTier === 2 }));
  report.launcher_tier = launcherTierFromSurfaces(report.surfaces);
  const cases = requireComplete ? CASES : [...new Set((report.surfaces ?? []).map(entry => entry.fixture))];
  for (const fixture of cases) for (const surface of ['gpu', 'osr']) for (const frame of FRAMES) {
    const web = report.surfaces.find(entry => entry.fixture === fixture && entry.surface === 'web');
    const exportEntry = report.surfaces.find(entry => entry.fixture === fixture && entry.surface === surface);
    if (!requireComplete && (!web || !exportEntry)) continue;
    const comparison = { fixture, surface, frame, pass: false };
    report.comparisons.push(comparison);
    try {
      const reference = web?.outputs?.find(output => output.frameNumber === frame)?.path;
      const target = exportEntry?.outputs?.find(output => output.frameNumber === frame)?.path;
      if (!reference || !target) throw new Error('Capture missing');
      const a = decodePng(await readFile(reference)), b = decodePng(await readFile(target));
      if (a.width !== b.width || a.height !== b.height) throw new Error('Image dimensions differ');
      const diff = Buffer.alloc(a.width * a.height * 4);
      let sum = 0;
      for (let i = 0; i < a.width * a.height; i++) for (let c = 0; c < 3; c++) {
        const delta = Math.abs(a.pixels[i * a.channels + c] - b.pixels[i * b.channels + c]);
        diff[i * 4 + c] = delta; diff[i * 4 + 3] = 255; sum += delta;
      }
      const boxA = bounds(a), boxB = bounds(b);
      const diffPath = join(out, fixture, `${surface}-diff-${frame}.png`);
      await mkdir(join(out, fixture), { recursive: true });
      await writeFile(diffPath, encodeRgbaPng(diff, a.width, a.height));
      const assets = fixture.startsWith('paths') ? [assetPixels(a), assetPixels(b)] : undefined;
      Object.assign(comparison, { bounds: [boxA, boxB], mad: sum / (a.width * a.height * 3), diffPath,
        ...(assets ? { assetPixels: assets } : {}),
        pass: Object.keys(boxA).every(key => Math.abs(boxA[key] - boxB[key]) <= 1)
          && (!assets || assets.every(value => value.pass)) });
    } catch (error) { comparison.error = String(error.stack ?? error); }
  }
  const surfacePath = (surface, name) => report.surfaces.find(entry => entry.fixture === name && entry.surface === surface)
    ?.outputs?.find(output => output.frameNumber === FRAMES[0])?.path;
  const comparePair = async (surface, name, beforeName, afterName, region, expectChange) => {
    const before = surfacePath(surface, beforeName), after = surfacePath(surface, afterName);
    if (!before || !after) return;
    const result = { name: `${name}:${surface}`, pass: false };
    report.visualChecks.push(result);
    try {
      const a = decodePng(await readFile(before)), b = decodePng(await readFile(after));
      if (a.width !== b.width || a.height !== b.height) throw new Error('Image dimensions differ');
      let outsideDiff = 0, insideDiff = 0;
      const diff = Buffer.alloc(a.width * a.height * 4);
      for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
        let changed = false;
        for (let c = 0; c < 3; c++) {
          const delta = Math.abs(a.pixels[(y * a.width + x) * a.channels + c]
            - b.pixels[(y * b.width + x) * b.channels + c]);
          diff[(y * a.width + x) * 4 + c] = delta;
          if (delta > 1) changed = true;
        }
        diff[(y * a.width + x) * 4 + 3] = 255;
        if (!changed) continue;
        if (x >= region.left && x < region.right && y >= region.top && y < region.bottom) insideDiff++;
        else outsideDiff++;
      }
      const diffPath = join(out, `${surface}-${name}-diff.png`);
      await writeFile(diffPath, encodeRgbaPng(diff, a.width, a.height));
      Object.assign(result, { insideDiff, outsideDiff, diffPath,
        pass: outsideDiff === 0 && (expectChange ? insideDiff > 0 : insideDiff === 0) });
    } catch (error) { result.error = String(error.stack ?? error); }
  };
  for (const surface of ['web', 'gpu', 'osr']) {
    await comparePair(surface, 'path-diff-confined-to-tile', 'paths-base', 'paths',
      { left: 70, right: 230, top: 80, bottom: 171 }, true);
    await comparePair(surface, 'missing-address-pixels-unchanged', 'bars-base', 'missing',
      { left: 0, right: 640, top: 0, bottom: 360 }, false);
    const before = surfacePath(surface, 'bars-base'), after = surfacePath(surface, 'bars');
    if (!before || !after) continue;
    const result = { name: `bar-green-bounds:${surface}`, pass: false };
    report.visualChecks.push(result);
    try {
      const original = bounds(decodePng(await readFile(before)), { left: 280, right: 355, top: 0, bottom: 360 });
      const changed = bounds(decodePng(await readFile(after)), { left: 280, right: 355, top: 0, bottom: 360 });
      Object.assign(result, { original, changed,
        pass: Math.abs((original.top - changed.top) - 160) <= 1
          && Math.abs(changed.height - 260) <= 1
          && Math.abs(original.left - changed.left) <= 1
          && Math.abs(original.width - changed.width) <= 1 });
    } catch (error) { result.error = String(error.stack ?? error); }
  }
  report.missingSurfaces = requireComplete ? CASES.flatMap(fixture => ['web', 'gpu', 'osr', 'shell']
    .filter(surface => !(surface === 'shell' ? report.shell?.cases?.some(value => value.fixture === fixture && value.pass)
      : report.surfaces.some(value => value.fixture === fixture && value.surface === surface && value.status === 'passed')))
    .map(surface => ({ fixture, surface }))) : [];
  report.pass = report.missingSurfaces.length === 0 && report.checks?.length > 0
    && report.checks.every(check => check.pass === true)
    && report.surfaces.length > 0 && report.surfaces.every(value => value.status === 'passed')
    && report.launcherChecks.every(value => value.pass)
    && report.comparisons.every(value => value.pass)
    && report.visualChecks.every(value => value.pass);
  return report;
}
