import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

// Opt in on a machine with Electron, ffmpeg and a writable TMP directory:
// AKARI_KARAOKE_PARITY=1 node --test test/caption-karaoke-pixel-parity.test.mjs
const enabled = process.env.AKARI_KARAOKE_PARITY === '1';
const require = createRequire(import.meta.url);
const { resolveCaptionDisplay } = require('../../edit-store/lib/index.js');
const root = resolve(import.meta.dirname, '../../..');
const node = process.execPath;
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const width = 640, height = 360, fps = 30, cueSeconds = 3;
const fills = ['char', 'word', 'smooth'];
const framesPerCue = cueSeconds * fps;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message ?? result.stderr?.slice(-2000) ?? result.status}`);
  }
  return result;
}

function selectedFrames() {
  const indices = new Set();
  const add = (base, second) => {
    const frame = base + Math.round(second * fps);
    for (const offset of [-1, 0, 1]) if (frame + offset >= base && frame + offset < base + framesPerCue) indices.add(frame + offset);
  };
  fills.forEach((fill, i) => {
    const base = i * framesPerCue;
    add(base, 0.3); // start_index prefix after the 180 ms caption fade-in
    add(base, 0.5); // word switch and first remaining char
    for (let n = 2; n < 8; n++) add(base, 0.5 + 2 * n / 7);
    add(base, 1.5);
    add(base, 2.5);
  });
  return [...indices].sort((a, b) => a - b);
}

function decodeSelected(file, frames) {
  const filter = `select=${frames.map(n => `eq(n\\,${n})`).join('+')}`;
  const result = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file,
    '-vf', filter, '-fps_mode', 'vfr', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
  { encoding: null, maxBuffer: width * height * 3 * (frames.length + 1) });
  const stride = width * height * 3;
  assert.equal(result.stdout.length, stride * frames.length, `decoded frame count for ${file}`);
  return frames.map((_, index) => result.stdout.subarray(index * stride, (index + 1) * stride));
}

function highlightGeometry(rgb) {
  let sum = 0, sx = 0, sy = 0;
  const xs = [], ys = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 3;
    const r = rgb[offset], g = rgb[offset + 1], b = rgb[offset + 2];
    if (!(r > 145 && r > g + 25 && g > b + 20)) continue;
    const weight = Math.min(1, (r - g - 25) / 80);
    sum += weight;
    sx += weight * (x + 0.5);
    sy += weight * (y + 0.5);
    xs.push(x); ys.push(y);
  }
  if (!sum) return null;
  const quantile = (values, fraction) => {
    values.sort((a, b) => a - b);
    return values[Math.min(values.length - 1, Math.floor(values.length * fraction))];
  };
  return {
    cx: sx / sum / width, cy: sy / sum / height,
    w: (quantile(xs, 0.995) - quantile(xs, 0.005) + 1) / width,
    h: (quantile(ys, 0.995) - quantile(ys, 0.005) + 1) / height,
    mass: sum,
  };
}

test('GPU and OSR karaoke highlight pixels agree at fill boundaries', { skip: !enabled }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'akari-gpu-karaoke-parity-'));
  const project = join(temp, 'project');
  const assets = join(project, 'assets');
  await mkdir(assets, { recursive: true });
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi',
    '-i', `color=c=0x27313f:size=${width}x${height}:rate=${fps}:duration=${cueSeconds * fills.length}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(assets, 'base.mp4')]);
  const captions = fills.map((fill, index) => {
    const start = index * cueSeconds;
    return { id: `c-${fill}`, style: 'karaoke', start, end: start + cueSeconds,
      text: 'KARAOKE', words: [{ text: 'KARAOKE', start: start + 0.5, end: start + 2.5 }],
      text_style: { karaoke: { fill, start_index: 2, done_color: '#fb923c' } } };
  });
  await writeFile(join(project, 'captions.json'), JSON.stringify({ captions }));
  const durationFrames = framesPerCue * fills.length;
  const edit = { version: 2, output: { width, height, fps },
    sources: [{ id: 'base', path: 'assets/base.mp4' }], tracks: [
      { id: 'visual', lane: 'visual', name: 'Base', items: [
        { id: 'cut', at: 0, duration: durationFrames,
          source: { kind: 'media', src: 'base', in: 0, out: cueSeconds * fills.length, speed: 1 } }] },
      { id: 'captions', lane: 'visual', name: 'Captions', items: [
        { id: 'captions-item', at: 0, duration: durationFrames,
          source: { kind: 'captions', path: 'captions.json' }, items: [] }] },
    ] };
  await writeFile(join(project, 'edit.json'), JSON.stringify(edit));
  const env = { ...process.env, AKARI_HOME: join(temp, 'akari-home') };
  delete env.AKARI_EXPORT_ALLOW_DESKTOP;
  delete env.AKARI_OSR_ELECTRON;
  const render = (engine, out) => run(node,
    [join(root, 'packages/render-cut/bin/render-cut.mjs'), project, '--force',
      '--no-verify-blank', '--engine', engine, '--out', out],
    { env, timeout: 600_000 });
  const exportsDir = join(project, 'exports');
  await mkdir(exportsDir, { recursive: true });
  const gpu = join(exportsDir, 'gpu.mp4'), osr = join(exportsDir, 'osr.mp4');
  render('auto', gpu);
  const receipt = JSON.parse(await readFile(join(project, '.akari', 'render.json'), 'utf8'));
  assert.equal(receipt.provenance?.engine ?? receipt.engine, 'gpu');
  assert.equal(receipt.provenance?.gpu?.provenance?.launcher_tier, 2);
  assert.doesNotMatch(JSON.stringify(receipt.warnings ?? []), /GPU export is ineligible/u);
  render('osr', osr);
  const frames = selectedFrames();
  const gpuPixels = decodeSelected(gpu, frames), osrPixels = decodeSelected(osr, frames);
  for (const [index, frame] of frames.entries()) {
    const g = highlightGeometry(gpuPixels[index]);
    const o = highlightGeometry(osrPixels[index]);
    assert.ok(g && o, `highlight is visible in frame ${frame}`);
    for (const key of ['cx', 'cy']) assert.ok(Math.abs(g[key] - o[key]) <= 0.002,
      `frame ${frame} ${key}: GPU ${g[key]} OSR ${o[key]}`);
    for (const key of ['w', 'h']) assert.ok(Math.abs(g[key] - o[key]) <= 0.007,
      `frame ${frame} ${key}: GPU ${g[key]} OSR ${o[key]}`);
  }
});

test('GPU and OSR policy karaoke agree around every word and a fragment switch',
  { skip: !enabled }, async () => {
    const temp = await mkdtemp(join(tmpdir(), 'karaoke-policy-parity-'));
    try {
      const project = join(temp, 'project');
      const assets = join(project, 'assets');
      await mkdir(assets, { recursive: true });
      await mkdir(join(project, '.akari'));
      const duration = 4;
      run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi',
        '-i', `color=c=0x27313f:size=${width}x${height}:rate=${fps}:duration=${duration}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(assets, 'base.mp4')]);
      const fragments = ['あいうえおかきくけこさし', 'すせそたちつてとなにぬね',
        'のはひふへほまみむめもや', 'ゆよらりるれろわをんがぎ'];
      assert.deepEqual(fragments.map(fragment => [...fragment].length), [12, 12, 12, 12]);
      const content = fragments.join('');
      const offsets = [0, 4, 8, 12, 16, 20, 28, 32, 36, 40, 44, 48];
      const starts = [0.2, 0.5, 0.8, 1.1, 1.4, 1.7, 2.2, 2.5, 2.8, 3.1, 3.4];
      const words = starts.map((start, index) => ({
        text: content.slice(offsets[index], offsets[index + 1]), start,
        end: starts[index + 1] ?? 3.8,
      }));
      assert.ok(offsets[5] < 24 && offsets[6] > 24,
        'the word at index 5 crosses the two-fragment cue switch');
      const display_policy = { mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
        unit_metric: 'ascii-half-other-one-v1', max_line_units: 12,
        minimum_fragment_duration_seconds: 0.1, locale: 'ja', lines: 2,
        wrap: 'multi', word_style: 'karaoke' };
      const captionsRoot = { display_policy,
        captions: [{ id: 'c-policy', start: 0, end: duration, text: content,
          display_fragments: fragments, words,
          text_style: { karaoke: { fill: 'word', done_color: '#fb923c' } } }] };
      const cues = resolveCaptionDisplay(captionsRoot, { cuts: [] }).display_cues;
      assert.equal(cues.length, 2);
      assert.equal(cues[1].start, 2);
      assert.ok(cues[0].words.some(word => word.text === content.slice(20, 24)));
      assert.ok(cues[1].words.some(word => word.text === content.slice(24, 28)
        && word.start === starts[5]));
      await writeFile(join(project, 'captions.json'), JSON.stringify(captionsRoot));
      const edit = { version: 2, output: { width, height, fps },
        sources: [{ id: 'base', path: 'assets/base.mp4' }], tracks: [
          { id: 'visual', lane: 'visual', name: 'Base', items: [
            { id: 'cut', at: 0, duration: duration * fps,
              source: { kind: 'media', src: 'base', in: 0, out: duration, speed: 1 } }] },
          { id: 'captions', lane: 'visual', name: 'Captions', items: [
            { id: 'captions-item', at: 0, duration: duration * fps,
              source: { kind: 'captions', path: 'captions.json' }, items: [] }] },
        ] };
      await writeFile(join(project, 'edit.json'), JSON.stringify(edit));
      const env = { ...process.env, AKARI_HOME: join(temp, 'akari-home') };
      delete env.AKARI_EXPORT_ALLOW_DESKTOP;
      delete env.AKARI_OSR_ELECTRON;
      const render = (engine, out) => run(node,
        [join(root, 'packages/render-cut/bin/render-cut.mjs'), project, '--force',
          '--no-verify-blank', '--engine', engine, '--out', out],
        { env, timeout: 600_000 });
      const exportsDir = join(project, 'exports');
      await mkdir(exportsDir, { recursive: true });
      const gpu = join(exportsDir, 'gpu.mp4'), osr = join(exportsDir, 'osr.mp4');
      render('auto', gpu);
      const receipt = JSON.parse(await readFile(join(project, '.akari', 'render.json'), 'utf8'));
      assert.equal(receipt.provenance?.engine ?? receipt.engine, 'gpu');
      assert.equal(receipt.provenance?.gpu?.provenance?.launcher_tier, 2);
      render('osr', osr);
      const switchFrame = 2 * fps;
      const frames = [...new Set(starts.flatMap((start, index) => {
        const boundary = Math.round(start * fps);
        const middle = Math.round(((start + words[index].end) / 2) * fps);
        return [boundary - 1, boundary + 1, middle];
      }).concat([switchFrame - 1, switchFrame + 6]))]
        // GPU fades in the new fragment for 0.2 s; OSR displays it immediately even without karaoke.
        .filter(frame => frame >= 0 && frame < duration * fps
          && (frame < switchFrame || frame >= switchFrame + 6))
        .sort((a, b) => a - b);
      assert.ok(frames.includes(switchFrame + 6), 'compare the crossing word after the fragment fade');
      const gpuPixels = decodeSelected(gpu, frames), osrPixels = decodeSelected(osr, frames);
      for (const [index, frame] of frames.entries()) {
        const g = highlightGeometry(gpuPixels[index]);
        const o = highlightGeometry(osrPixels[index]);
        assert.equal(Boolean(g), Boolean(o), `highlight visibility in frame ${frame}`);
        if (!g || !o) continue;
        // Japanese glyph rasterization differs by a few pixels at 640px; a wrong word shifts cx much farther.
        for (const key of ['cx', 'cy']) assert.ok(Math.abs(g[key] - o[key]) <= 0.005,
          `frame ${frame} ${key}: GPU ${g[key]} OSR ${o[key]}`);
        for (const key of ['w', 'h']) assert.ok(Math.abs(g[key] - o[key]) <= 0.007,
          `frame ${frame} ${key}: GPU ${g[key]} OSR ${o[key]}`);
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
