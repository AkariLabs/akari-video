#!/usr/bin/env node
// Extract equal-time OSR frames, compare stroke pixels, and build a paired crop.
// Usage: node outline-compare.mjs <before-mp4> <after-mp4> <output-dir>
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [beforeVideo, afterVideo, outputArg] = process.argv.slice(2);
if (!beforeVideo || !afterVideo || !outputArg) throw new Error('before video, after video, and output directory are required');
const output = path.resolve(outputArg);
await mkdir(output, { recursive: true });
const width = 1280, height = 720;
const framePaths = ['before', 'after'].map(label => path.join(output, `${label}-outline-osr.png`));
function ffmpeg(args) {
    const result = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args],
        { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 180_000 });
    if (result.status !== 0) throw new Error(`frame operation failed: ${result.stderr}`);
    return result;
}
for (const [index, video] of [beforeVideo, afterVideo].entries()) {
    ffmpeg(['-ss', '4', '-i', video, '-frames:v', '1', framePaths[index]]);
}
const frames = framePaths.map(file => {
    const result = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file,
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: width * height * 3 + 4096, timeout: 30_000 });
    if (result.status !== 0 || result.stdout.length !== width * height * 3) throw new Error('frame pixels unavailable');
    return result.stdout;
});
const region = { left: 100, top: 160, right: 1180, bottom: 540 };
const pixel = (buffer, x, y) => {
    const index = (y * width + x) * 3;
    return [buffer[index], buffer[index + 1], buffer[index + 2]];
};
const white = ([r, g, b]) => r >= 220 && g >= 220 && b >= 220;
const black = ([r, g, b]) => r <= 25 && g <= 25 && b <= 25;
function bounds(buffer, predicate) {
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = region.top; y < region.bottom; y++) for (let x = region.left; x < region.right; x++) {
        if (!predicate(pixel(buffer, x, y))) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right < 0) throw new Error('caption pixels were not found');
    return { left, top, right, bottom };
}
const whiteBounds = frames.map(frame => bounds(frame, white));
const afterWhite = whiteBounds[1];
// Lower strokes of the first glyph cross this row; use the same row for both renderers.
const horizontalY = Math.round(afterWhite.top + (afterWhite.bottom - afterWhite.top) * .7);
let verticalX = afterWhite.left + 10, mostWhite = -1;
for (let x = afterWhite.left + 10; x <= Math.min(afterWhite.left + 90, afterWhite.right); x++) {
    let count = 0;
    for (let y = afterWhite.top; y <= afterWhite.bottom; y++) if (white(pixel(frames[1], x, y))) count++;
    if (count > mostWhite) { mostWhite = count; verticalX = x; }
}
function scan(frame) {
    const xs = [], ys = [];
    for (let x = region.left; x < region.right; x++) xs.push(x);
    for (let y = region.top; y < region.bottom; y++) ys.push(y);
    const atY = predicate => xs.filter(x => predicate(pixel(frame, x, horizontalY)));
    const atX = predicate => ys.filter(y => predicate(pixel(frame, verticalX, y)));
    const wx = atY(white), wy = atX(white);
    if (![wx, wy].every(values => values.length > 0)) throw new Error('chosen scan line misses the glyph');
    const blackLeft = xs.filter(x => x >= wx[0] - 40 && x <= wx[0] && black(pixel(frame, x, horizontalY)));
    const blackRight = xs.filter(x => x >= wx.at(-1) && x <= wx.at(-1) + 40 && black(pixel(frame, x, horizontalY)));
    const blackTop = ys.filter(y => y >= wy[0] - 40 && y <= wy[0] && black(pixel(frame, verticalX, y)));
    const blackBottom = ys.filter(y => y >= wy.at(-1) && y <= wy.at(-1) + 40 && black(pixel(frame, verticalX, y)));
    if (![blackLeft, blackRight, blackTop, blackBottom].every(values => values.length > 0)) {
        throw new Error('chosen scan line misses the outline');
    }
    return {
        horizontal: { y: horizontalY, whiteLeft: wx[0], blackLeft: blackLeft[0], whiteRight: wx.at(-1), blackRight: blackRight.at(-1),
            outwardLeftPx: wx[0] - blackLeft[0], outwardRightPx: blackRight.at(-1) - wx.at(-1) },
        vertical: { x: verticalX, whiteTop: wy[0], blackTop: blackTop[0], whiteBottom: wy.at(-1), blackBottom: blackBottom.at(-1),
            outwardTopPx: wy[0] - blackTop[0], outwardBottomPx: blackBottom.at(-1) - wy.at(-1) }
    };
}
const before = { whiteBounds: whiteBounds[0], blackBounds: bounds(frames[0], black), ...scan(frames[0]) };
const after = { whiteBounds: whiteBounds[1], blackBounds: bounds(frames[1], black), ...scan(frames[1]) };
const crop = { width: 900, height: 330,
    x: Math.max(0, Math.min(width - 900, Math.round((afterWhite.left + afterWhite.right) / 2) - 450)),
    y: Math.max(0, Math.min(height - 330, Math.round((afterWhite.top + afterWhite.bottom) / 2) - 165)) };
const filter = `[0:v]crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=1800:660:flags=neighbor[l];`
    + `[1:v]crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=1800:660:flags=neighbor[r];[l][r]hstack=inputs=2`;
ffmpeg(['-i', framePaths[0], '-i', framePaths[1], '-filter_complex', filter, '-frames:v', '1',
    path.join(output, 'outline-osr-side-by-side.png')]);
const differences = {
    left: Math.abs(before.horizontal.outwardLeftPx - after.horizontal.outwardLeftPx),
    right: Math.abs(before.horizontal.outwardRightPx - after.horizontal.outwardRightPx),
    top: Math.abs(before.vertical.outwardTopPx - after.vertical.outwardTopPx),
    bottom: Math.abs(before.vertical.outwardBottomPx - after.vertical.outwardBottomPx)
};
let changedPixels = 0;
for (let y = region.top; y < region.bottom; y++) for (let x = region.left; x < region.right; x++) {
    const index = (y * width + x) * 3;
    if (frames[0][index] !== frames[1][index]
        || frames[0][index + 1] !== frames[1][index + 1]
        || frames[0][index + 2] !== frames[1][index + 2]) changedPixels++;
}
const result = { condition: { text: 'こんにちは', fontSizePx: 160, strokeWidthPx: 12, frame: { width, height }, second: 4 },
    crop, before, after, differences, changedPixels,
    withinOnePixel: Object.values(differences).every(value => value <= 1) };
await writeFile(path.join(output, 'results-outline-osr.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ before: before.horizontal, after: after.horizontal, differences, withinOnePixel: result.withinOnePixel }));
