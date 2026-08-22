#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const worktree = path.resolve(fixtureDir, '..', '..');
const templateDir = path.join(worktree, 'templates', 'project-default');
const outputDir = path.join(fixtureDir, 'generated-project');
const assetRoot = process.env.AKARI_INTERNAL_ASSETS_DIR;

if (!assetRoot) {
  throw new Error('AKARI_INTERNAL_ASSETS_DIR must point to the asset library root.');
}

const sceneAssetDir = path.join(assetRoot, 'scene3d', 'laptop-slim-aluminum');
const overlayAssetDir = path.join(assetRoot, 'overlay', 'telop-chapter-tag');

await rm(outputDir, { recursive: true, force: true });
await cp(templateDir, outputDir, { recursive: true });
await Promise.all([
  mkdir(path.join(outputDir, 'assets', 'private'), { recursive: true }),
  mkdir(path.join(outputDir, 'overlays'), { recursive: true }),
  mkdir(path.join(outputDir, 'runtime'), { recursive: true })
]);

const mediaPath = path.join(outputDir, 'assets', 'main.mp4');
const ffmpeg = spawnSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
  '-t', '12', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mediaPath
], { encoding: 'utf8' });
if (ffmpeg.status !== 0) {
  throw new Error(`ffmpeg failed: ${ffmpeg.stderr || ffmpeg.stdout}`);
}

await cp(
  path.join(sceneAssetDir, 'model.glb'),
  path.join(outputDir, 'assets', 'private', 'laptop-slim-aluminum.glb')
);

const chapterSource = await readFile(path.join(overlayAssetDir, 'fragment.html'), 'utf8');
const chapterHtml = chapterSource
  .replace('data-duration="4.5"', 'data-duration="9"')
  .replace('問題の本質', 'パッケージ版書き出し検証');
if (chapterHtml === chapterSource) {
  throw new Error('telop-chapter-tag title marker was not found.');
}
await writeFile(path.join(outputDir, 'overlays', 'telop-chapter-tag.html'), chapterHtml);

const sceneHtml = `<div class="laptop-slim-aluminum-scene">
  <style>
    .laptop-slim-aluminum-scene { position: absolute; inset: 0; background: #111827; }
    .laptop-slim-aluminum-scene canvas { width: 100%; height: 100%; display: block; }
    .laptop-slim-aluminum-scene [data-akari-3d-fallback] {
      position: absolute; inset: 0; display: grid; place-items: center;
      color: #f8fafc; font: 700 28px/1.4 system-ui, sans-serif;
    }
  </style>
  <canvas></canvas>
  <div data-akari-3d-fallback>3D を読み込み中</div>
  <script type="application/json" data-akari-3d-scene>{"model":"assets/private/laptop-slim-aluminum.glb"}</script>
</div>
`;
await writeFile(path.join(outputDir, 'overlays', 'laptop-slim-aluminum.html'), sceneHtml);

const simpleHtml = `<div class="simple-html-telop">
  <style>
    .simple-html-telop { position: absolute; right: 60px; bottom: 80px; padding: 14px 22px;
      border-radius: 10px; background: #111827dd; color: white; font: 700 28px/1.2 system-ui, sans-serif; }
  </style>
  <span>比較用 HTML テロップ</span>
</div>
`;
await writeFile(path.join(outputDir, 'overlays', 'simple-html-telop.html'), simpleHtml);

for (const relativePath of [
  'src/vendor/three-bundle.js',
  'src/three-runtime.js',
  'src/overlay-runtime.js',
  'src/interaction.js',
  'src/interaction.css'
]) {
  await cp(
    path.join(worktree, 'packages', 'overlay-runtime', relativePath),
    path.join(outputDir, 'runtime', path.basename(relativePath))
  );
}

const edit = {
  version: 2,
  output: { width: 1280, height: 720, fps: 30 },
  sources: [{ id: 'main', path: 'assets/main.mp4' }],
  tracks: [
    {
      id: 'v-main', lane: 'visual', name: '本編（source 5–7 秒を削除）', items: [
        { id: 'cut-a', at: 0, duration: 90, source: { kind: 'media', src: 'main', in: 2, out: 5 } },
        { id: 'cut-b', at: 120, duration: 150, source: { kind: 'media', src: 'main', in: 7, out: 12 } }
      ]
    },
    {
      id: 'v-3d', lane: 'visual', name: 'laptop-slim-aluminum', items: [
        { id: 'laptop-3d', at: 0, duration: 270,
          source: { kind: 'html', path: 'overlays/laptop-slim-aluminum.html' } }
      ]
    },
    {
      id: 'v-chapter', lane: 'visual', name: 'telop-chapter-tag', items: [
        { id: 'chapter-tag', at: 0, duration: 270,
          source: { kind: 'html', path: 'overlays/telop-chapter-tag.html' } }
      ]
    },
    {
      id: 'v-simple-html', lane: 'visual', name: '比較用 HTML', items: [
        { id: 'simple-html', at: 0, duration: 270,
          source: { kind: 'html', path: 'overlays/simple-html-telop.html' } }
      ]
    },
    {
      id: 'v-native-telop', lane: 'visual', name: '比較用 未焼成テロップ', items: [
        { id: 'native-telop', at: 30, duration: 180,
          source: { kind: 'telop', preset: 'ref3_name_rounded', params: { name: '比較用' } } }
      ]
    },
    { id: 'captions', lane: 'visual', name: '字幕', content: { from: 'captions.json' } }
  ]
};

const captions = {
  default_text_style: {
    color: '#ffffff', size_px: 42,
    background: { color: '#000000', opacity: 0.72, mode: 'block' },
    zone: 'bottom'
  },
  captions: [
    {
      id: 'c-0001', start: 2, end: 3,
      text: '残っている1本目の字幕', speaker: null, sourceRef: null, edited: false
    },
    {
      id: 'c-0002', start: 3, end: 4,
      text: '出力gap数値の字幕', speaker: null, sourceRef: null, edited: false
    },
    {
      id: 'c-0003', start: 4, end: 8,
      text: '削除区間をまたぐ字幕', speaker: null, sourceRef: null, edited: false
    },
    {
      id: 'c-0004', start: 8, end: 9,
      text: '残っている2本目の字幕', speaker: null, sourceRef: null, edited: false
    }
  ]
};

await Promise.all([
  writeFile(path.join(outputDir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`),
  writeFile(path.join(outputDir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`)
]);

const harnessSummary = {
  output: edit.output,
  overlays: [
    { id: 'laptop-3d', start: 0, duration: 9, html: sceneHtml },
    { id: 'chapter-tag', start: 0, duration: 9, html: chapterHtml },
    { id: 'simple-html', start: 0, duration: 9, html: simpleHtml }
  ]
};
const harnessHtml = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="runtime/interaction.css">
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #090d18; overflow: hidden; }
    #preview-pane { position: relative; width: 1280px; height: 720px; overflow: hidden; }
    #preview-video { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; }
    #overlay-stage { position: absolute; inset: 0; width: 1280px; height: 720px; overflow: hidden; }
    #caption-plate { position: absolute; left: 0; right: 0; bottom: 7%; color: white;
      text-align: center; font: 700 42px/1.4 system-ui, sans-serif; text-shadow: 0 2px 5px #000; }
  </style>
</head>
<body>
  <main id="preview-pane">
    <video id="preview-video"></video>
    <div id="overlay-stage"></div>
    <div id="caption-plate"></div>
  </main>
  <script>
    window.akari = window.akari || {};
    window.akari.state = { editPath: 'edit.json', summary: ${JSON.stringify(harnessSummary).replace(/</g, '\\u003c')} };
    window.akari.stageScale = () => 1;
    window.akari.engine = { overlayWrite: async () => ({ ok: true }) };
  </script>
  <script src="runtime/three-bundle.js"></script>
  <script src="runtime/three-runtime.js"></script>
  <script src="runtime/overlay-runtime.js"></script>
  <script src="runtime/interaction.js"></script>
  <script>
    window.__reportHarness = {
      ready: false,
      errors: [],
      caption: ${JSON.stringify(captions.captions[0])},
      segments: [
        { in: 2, out: 5, tlStart: 0, tlEnd: 3 },
        { in: 7, out: 12, tlStart: 4, tlEnd: 9 }
      ],
      setSourceTime(sourceTime) {
        const segment = this.segments.find(candidate => candidate.in <= sourceTime && sourceTime < candidate.out);
        const outputTime = segment ? segment.tlStart + sourceTime - segment.in : 0;
        const caption = this.caption.start <= sourceTime && sourceTime < this.caption.end ? this.caption : null;
        document.getElementById('caption-plate').textContent = caption?.text ?? '';
        window.akari.runtime.tick(outputTime, false);
        return { sourceTime, outputTime, captionText: caption?.text ?? '' };
      }
    };
    window.addEventListener('error', event => {
      window.__reportHarness.errors.push({ message: event.message, stack: event.error?.stack ?? null });
    });
    Promise.resolve(window.akari.runtime.mount(window.akari.state.summary)).then(() => {
      window.__reportHarness.setSourceTime(3);
      window.__reportHarness.ready = true;
    }).catch(error => {
      window.__reportHarness.error = { message: error.message, stack: error.stack };
    });
  </script>
</body>
</html>
`;
await writeFile(path.join(outputDir, 'harness.html'), harnessHtml);

console.log(path.relative(worktree, outputDir));
