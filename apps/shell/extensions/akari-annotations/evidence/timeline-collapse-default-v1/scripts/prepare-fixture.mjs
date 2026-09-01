#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { serializeEdit } from '../../../../../../../packages/edit-store/lib/canonical.js';

const [, , workspaceDir, sourceProjectArg] = process.argv;
const sourceProject = sourceProjectArg ?? process.env.AKARI_FIELDTEST_DIR;
if (!workspaceDir || !sourceProject) {
  throw new Error('usage: prepare-fixture.mjs <workspaceDir> <object-tree-fieldtest>');
}

const projectDir = path.join(workspaceDir, 'project');
await rm(projectDir, { recursive: true, force: true });
await mkdir(path.join(projectDir, 'assets'), { recursive: true });
await cp(sourceProject, projectDir, { recursive: true, force: true });
await mkdir(path.join(projectDir, 'assets'), { recursive: true });
await mkdir(path.join(projectDir, 'overlays'), { recursive: true });

const editPath = path.join(projectDir, 'edit.json');
const edit = JSON.parse(await readFile(editPath, 'utf8'));
edit.sources = [...(edit.sources ?? []).filter(source => source.id !== 'collapse-sfx-source'), {
  id: 'collapse-sfx-source', path: 'assets/bgm.mp3'
}];
delete edit.audio;

const htmlTracks = Array.from({ length: 3 }, (_, bagIndex) => ({
  id: `collapse-html-track-${bagIndex + 1}`,
  lane: 'visual',
  items: [{
    id: `collapse-html-bag-${bagIndex + 1}`,
    name: `オーバーレイ ${bagIndex + 1}`,
    at: bagIndex * 90,
    duration: 90,
    source: { kind: 'html', path: `overlays/collapse-bag-${bagIndex + 1}.html`, exclude: [] }
  }]
}));
const groupTracks = Array.from({ length: 2 }, (_, groupIndex) => ({
  id: `collapse-group-track-${groupIndex + 1}`,
  lane: 'visual',
  items: [{
    id: `collapse-group-${groupIndex + 1}`,
    name: `グループ ${groupIndex + 1}`,
    at: groupIndex * 150,
    duration: 150,
    source: { kind: 'group' },
    items: Array.from({ length: 5 }, (_, childIndex) => ({
      id: `collapse-group-${groupIndex + 1}-child-${childIndex + 1}`,
      at: childIndex * 20,
      duration: 50,
      source: {
        kind: 'telop', preset: 'ref3_chapter_tag',
        params: { text: `G${groupIndex + 1}-${childIndex + 1}` }
      }
    }))
  }]
}));
const audioTrack = {
  id: 'collapse-audio-track',
  lane: 'audio',
  items: Array.from({ length: 30 }, (_, index) => ({
    id: `collapse-sfx-${String(index + 1).padStart(2, '0')}`,
    name: `SFX ${String(index + 1).padStart(2, '0')}`,
    at: index * 10,
    duration: 5,
    role: 'sfx',
    source: { kind: 'media', src: 'collapse-sfx-source', in: 0, out: 1 / 6 }
  }))
};
edit.tracks = [
  ...(edit.tracks ?? []).filter(track => !String(track.id).startsWith('collapse-')),
  ...htmlTracks,
  ...groupTracks,
  audioTrack
];
await writeFile(editPath, serializeEdit(edit));

const captions = Array.from({ length: 30 }, (_, index) => ({
  id: `collapse-caption-${String(index + 1).padStart(2, '0')}`,
  start: index * 0.34,
  end: index * 0.34 + 0.28,
  text: `字幕 ${String(index + 1).padStart(2, '0')}`,
  speaker: null,
  sourceRef: null,
  edited: false,
  time_domain: 'output'
}));
await writeFile(path.join(projectDir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);

for (let bagIndex = 0; bagIndex < 3; bagIndex++) {
  const parts = Array.from({ length: 5 }, (_, partIndex) =>
    `<span data-akari-part="p${partIndex + 1}" style="position:absolute;left:${partIndex * 18}%;top:${20 + partIndex * 8}%">P${partIndex + 1}</span>`
  ).join('\n');
  await writeFile(path.join(projectDir, 'overlays', `collapse-bag-${bagIndex + 1}.html`),
    `<!doctype html><html><body style="margin:0;background:transparent">${parts}</body></html>\n`);
}
await writeFile(path.join(projectDir, 'review.json'), '{ "version": 0, "annotations": [] }\n');
console.log(`prepared timeline-collapse-default L1 fixture at ${projectDir}`);
