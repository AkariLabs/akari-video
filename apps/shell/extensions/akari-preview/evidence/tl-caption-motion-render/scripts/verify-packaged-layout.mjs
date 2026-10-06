#!/usr/bin/env node
// Copy only the relevant extraResources entries, then import the copied CLIs.
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../../');
const shell = path.join(repo, 'apps/shell');
const target = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !target.includes('tl-caption-motion-render')
  || target === repo || target.startsWith(repo + path.sep)) throw new Error('dedicated external target required');
const config = JSON.parse(await readFile(path.join(shell, 'package.json')));
const wanted = new Set(['packages/render-cut', 'packages/gpu-export', 'packages/asset-resolver',
  'packages/creator-root', 'packages/akari-launcher', 'packages/media-bin/src', 'packages/edit-store/lib',
  'packages/overlay-runtime', 'assets/font']);
const resources = config.build.extraResources.filter(item => wanted.has(item.to));
assert.deepEqual(new Set(resources.map(item => item.to)), wanted);
await rm(target, { recursive: true, force: true });
const included = (name, filters) => !filters?.length || filters.some(pattern => pattern === name
  || (pattern.endsWith('/**/*') && name.startsWith(pattern.slice(0, -4))));
async function copyResource(entry) {
  const source = path.resolve(shell, entry.from);
  const destination = path.join(target, entry.to);
  const visit = async (current, relative = '') => {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const name = relative ? `${relative}/${item.name}` : item.name;
      if (item.isDirectory()) { await visit(path.join(current, item.name), name); continue; }
      if (!item.isFile() || !included(name, entry.filter)) continue;
      const output = path.join(destination, name);
      await mkdir(path.dirname(output), { recursive: true });
      await copyFile(path.join(current, item.name), output);
    }
  };
  await visit(source);
}
for (const entry of resources) await copyResource(entry);

const captionsPath = path.join(target, 'packages/render-cut/src/captions.mjs');
const { generateCaptionOverlays, CAPTION_ANIMATION_RECIPES } = await import(pathToFileURL(captionsPath));
const cue = { id: 'c-1', start: 0, end: 3, text: '文字送り', time_domain: 'output',
  text_style: { animation: { in: { id: 'typewriter', duration_sec: 1.4 } } } };
const [overlay] = generateCaptionOverlays([cue], [{ id: 'cut-1', src: 'a', in: 0, out: 3, at: 0 }],
  { output: { width: 640, height: 360, fps: 30 } });
assert.equal(Object.keys(CAPTION_ANIMATION_RECIPES).length, 47);
assert.ok(overlay?.html.includes('akari-typewriter-char-in'));
assert.equal((overlay.html.match(/class="akari-caption__type-char"/gu) || []).length, 4);
const { isCaptionMotionSupported } = await import(pathToFileURL(path.join(target, 'packages/gpu-export/src/eligibility.mjs')));
assert.deepEqual(isCaptionMotionSupported(cue.text_style.animation), { supported: false, unsupported: ['typewriter'] });
console.log(JSON.stringify({ copied: [...wanted], recipes: 47, spans: 4, gpuEligibilityImport: true }));
