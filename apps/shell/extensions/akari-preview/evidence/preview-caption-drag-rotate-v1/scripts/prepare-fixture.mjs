#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintProjectCandidates, findEditLintBinPath } from '../../../../../../../packages/edit-store/lib/write-gate.js';
import { serializeEdit } from '../../../../../../../packages/edit-store/lib/canonical.js';

if (!process.argv[2]) throw new Error('usage: prepare-fixture.mjs <temporary-workspace> [--lint-only]');
const repo = fileURLToPath(new URL('../../../../../../../', import.meta.url));
await mkdir(process.argv[2], { recursive: true });
const workspace = await realpath(process.argv[2]);
const project = path.join(workspace, 'project');
if (await stat(project).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
})) throw new Error(`Refusing to replace existing project: ${project}`);
await cp(path.join(repo, 'templates/project-default'), project, { recursive: true });
await cp(path.join(repo, 'packages/render-cut/test/fixtures/caption-item-render'), project, { recursive: true, force: true });
const editPath = path.join(project, 'edit.json');
const edit = JSON.parse(await readFile(editPath, 'utf8'));
edit.sources = [{ id: 'main', path: 'assets/base.png' }];
// Preserve the fixture's declared caption bag, without detached/HTML occluders.
edit.tracks = edit.tracks.filter(track => ['video', 'caption-bag-track'].includes(track.id));
delete edit.tracks[1].items[0].source.exclude;
await mkdir(path.join(project, 'assets'), { recursive: true });
execFileSync(process.env.AKARI_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
  '-f', 'lavfi', '-i', 'color=c=0x172033:s=640x360', '-frames:v', '1', path.join(project, 'assets/base.png')], { stdio: 'pipe' });
await writeFile(editPath, serializeEdit(edit));
const cue = (id, start, end, text, y) => ({ id, start, end, text, src: 'main',
  ...(id === 'c-0002' ? { time_domain: 'output' } : {}),
  speaker: null, sourceRef: null, edited: false, text_style: { text_anchor: 'bc', position: { y } } });
await writeFile(path.join(project, 'captions.json'), JSON.stringify({
  default_text_style: { size_px: 28, max_width_pct: 80 },
  captions: [cue('c-0001', 0.25, 2, 'First caption', 0.78),
    cue('c-0002', 0.25, 2, 'Overlapping caption', 0.34),
    cue('c-0003', 2.5, 4.5, 'Later caption', 0.78)]
}, null, 2) + '\n');
await writeFile(path.join(project, 'review.json'), '{"version":0,"annotations":[]}\n');
if (!findEditLintBinPath()) throw new Error('edit-lint unavailable');
const lint = await lintProjectCandidates(project, {});
console.log(JSON.stringify({ fixtureLint: lint }));
if (!lint.pass || lint.errors.length) throw new Error(`Fixture lint failed: ${lint.errors.join('; ')}`);
if (!process.argv.includes('--lint-only')) {
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false',
    '-c', 'user.name=AKARI L1 Fixture', '-c', 'user.email=l1-fixture@example.invalid', ...args], { cwd: project, stdio: 'pipe' });
  git('init', '--quiet');
  git('add', '--all');
  git('commit', '--quiet', '-m', 'Initial isolated caption drag rotate fixture');
}
console.log(`prepared ${project}; at 0.5s: c-0001+c-0002; at 3s: c-0003; at 2.25s: none`);
