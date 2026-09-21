#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintProjectCandidates, findEditLintBinPath } from '../../../../../../../packages/edit-store/lib/write-gate.js';
import { serializeEdit } from '../../../../../../../packages/edit-store/lib/canonical.js';

const workspaceArg = process.argv[2];
if (!workspaceArg) throw new Error('usage: prepare-fixture.mjs <workspace>');
const repo = fileURLToPath(new URL('../../../../../../../', import.meta.url));
await mkdir(workspaceArg, { recursive: true });
const workspace = await realpath(workspaceArg);
const project = path.join(workspace, 'project');
if (await stat(project).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
})) throw new Error(`Refusing to replace existing project: ${project}`);
await cp(path.join(repo, 'templates/project-default'), project, { recursive: true });
await cp(path.join(repo, 'packages/render-cut/test/fixtures/object-tree-html-bag'), project,
  { recursive: true, force: true });
const editPath = path.join(project, 'edit.json');
const edit = JSON.parse(await readFile(editPath, 'utf8'));
// Keep the P0 bag/part/plain targets and add disjoint native media + captions.
const bag = edit.tracks.flatMap(track => track.items ?? []).find(item => item.id === 's01');
bag.items.find(item => item.id === 's01.B').transform = { y: 40 };
edit.tracks = edit.tracks.filter(track => track.id !== 'v2');
await mkdir(path.join(project, 'assets'), { recursive: true });
for (const [name, size, color] of [['base', '640x360', '0x172033'], ['layer', '160x100', '0x37aacc']]) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `color=c=${color}:s=${size}`, '-frames:v', '1',
    path.join(project, 'assets', `${name}.png`)], { stdio: 'pipe' });
}
edit.sources = [{ id: 'base', path: 'assets/base.png' }, { id: 'layer-src', path: 'assets/layer.png' }];
edit.tracks.unshift(
  { id: 'base-track', lane: 'visual', items: [{ id: 'base', at: 0, duration: 120,
    source: { kind: 'media', src: 'base', in: 0, out: 4 } }] },
  { id: 'layer-track', lane: 'visual', items: [{ id: 'layer', at: 0, duration: 120,
    transform: { x: 160, y: 0, scale: 1, rotate: 0 },
    source: { kind: 'media', src: 'layer-src', in: 0, out: 4 } }] }
);
edit.tracks.push({ id: 'caption-track', lane: 'visual', items: [{ id: 'captions', at: 0, duration: 120,
  source: { kind: 'captions', path: 'captions.json' }, items: [] }] });
await writeFile(path.join(project, 'captions.json'), JSON.stringify({
  default_text_style: { text_anchor: 'bc', position: { y: 0.92 }, size_px: 24, max_width_pct: 80 },
  captions: [
    { id: 'c-0001', start: 0, end: 2, text: 'Original caption', speaker: null, sourceRef: null, edited: false },
    { id: 'c-0002', start: 2, end: 4, text: 'Second caption', speaker: null, sourceRef: null, edited: false }
  ]
}, null, 2) + '\n');
await writeFile(editPath, serializeEdit(edit));
await writeFile(path.join(project, 'review.json'), '{ "version": 0, "annotations": [] }\n');
// Fail before Electron or a baseline commit if the fixture cannot pass the
// same project lint used by preview writes (including the captions sidecar).
if (!findEditLintBinPath()) throw new Error('edit-lint unavailable: cannot validate fixture');
const lint = await lintProjectCandidates(project, {});
console.log(JSON.stringify({ fixtureLint: lint }));
if (!lint.pass || lint.errors.length) throw new Error(`Fixture lint failed: ${lint.errors.join('; ')}`);
// Headless fixture validation can stop here without creating any Git commit.
if (!process.argv.includes('--lint-only')) {
  // This repository belongs ONLY to the disposable project, never the product.
  const git = (...args) => execFileSync('git', [
    '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false',
    '-c', 'user.name=AKARI L1 Fixture', '-c', 'user.email=l1-fixture@example.invalid',
    ...args
  ], { cwd: project, stdio: 'pipe' });
  git('init', '--quiet');
  git('add', '--all');
  git('commit', '--quiet', '-m', 'Initial isolated modifier keys fixture');
}
console.log(`prepared ${project} (sample time 0.5s; overlays, layer, two captions)`);
