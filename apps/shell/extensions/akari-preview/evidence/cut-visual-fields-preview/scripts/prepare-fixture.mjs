#!/usr/bin/env node
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [workspaceDir, mediaPath] = process.argv.slice(2);
if (!workspaceDir || !mediaPath) {
  throw new Error('usage: prepare-fixture.mjs <workspace-dir> <media.mp4>');
}

const projectDir = path.join(workspaceDir, 'project');
await mkdir(path.join(projectDir, '.akari'), { recursive: true });
await copyFile(mediaPath, path.join(projectDir, 'source.mp4'));

const target = {
  id: 'target', at: 0, duration: 90,
  transform: { x: -120, y: -60, scale: 0.5, rotate: 0 },
  opacity: 1,
  crop: { x: 0.2, y: 0.1, w: 0.6, h: 0.7 },
  perspective: { corners: [[0.08, 0], [0.92, 0], [0, 1], [1, 1]] },
  keyframes: [
    {
      t: 0,
      transform: { x: -120, y: -60, scale: 0.5, rotate: 0 },
      crop: { x: 0.2, y: 0.1, w: 0.6, h: 0.7 }
    },
    {
      t: 45,
      transform: { x: -60, y: -30, scale: 0.85, rotate: 0 },
      crop: { x: 0.3, y: 0.2, w: 0.4, h: 0.5 }
    },
    {
      t: 90,
      transform: { x: 0, y: 0, scale: 1.2, rotate: 0 },
      crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
    }
  ],
  source: { kind: 'media', src: 'field', in: 0, out: 3 }
};
const plain = {
  id: 'plain', at: 90, duration: 30,
  source: { kind: 'media', src: 'field', in: 3, out: 4 }
};
const offCanvasSibling = {
  id: 'off-canvas-sibling', at: 0, duration: 90,
  transform: { x: 10000, y: 0, scale: 1, rotate: 0 },
  source: { kind: 'media', src: 'field', in: 0, out: 3 }
};
const base = {
  version: 2,
  output: { width: 640, height: 360, fps: 30 },
  sources: [{ id: 'field', path: 'source.mp4', proxy: null }]
};
const cutEdit = {
  ...base,
  tracks: [{ id: 'v-main', lane: 'visual', items: [target, plain] }]
};
// target と兄弟を完全に同じ at/duration へ置くと computeOverlappingItemIds が両方を掴み、
// target は同じ宣言のまま layers 分類へ落ちる。兄弟自身はキャンバス外なので画を汚さない。
const layerEdit = {
  ...base,
  tracks: [{ id: 'v-main', lane: 'visual', items: [target, offCanvasSibling] }]
};

const serialize = value => `${JSON.stringify(value, null, 2)}\n`;
await writeFile(path.join(projectDir, 'edit-cut.json'), serialize(cutEdit));
await writeFile(path.join(projectDir, 'edit-layer.json'), serialize(layerEdit));
await writeFile(path.join(projectDir, 'edit.json'), serialize(cutEdit));
await writeFile(
  path.join(projectDir, '.akari', 'lint.json'),
  serialize({ version: 1, verdict: 'pass' })
);

console.log('prepared cut/layer classification pair');
