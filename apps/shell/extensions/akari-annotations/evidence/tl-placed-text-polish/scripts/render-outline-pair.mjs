#!/usr/bin/env node
// Render the same caption with HEAD's old renderer and the current renderer, without a worktree.
// Usage: node render-outline-pair.mjs <repository> <project-fixture> <temporary-directory> <evidence-directory>
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [repoArg, fixtureArg, temporaryArg, evidenceArg] = process.argv.slice(2);
if (!repoArg || !fixtureArg || !temporaryArg || !evidenceArg) throw new Error('four directory arguments are required');
const repo = path.resolve(repoArg), fixture = path.resolve(fixtureArg);
const temporary = path.resolve(temporaryArg), evidence = path.resolve(evidenceArg);
if (!path.basename(temporary).includes('tl-placed-text-polish')) throw new Error('dedicated temporary directory required');
await rm(temporary, { recursive: true, force: true });
const packages = path.join(temporary, 'packages');
await mkdir(packages, { recursive: true });
for (const name of await readdir(path.join(repo, 'packages'))) {
    if (name === 'render-cut' || name === 'osr-export') continue;
    await symlink(path.join(repo, 'packages', name), path.join(packages, name));
}
const render = path.join(packages, 'render-cut');
await mkdir(render, { recursive: true });
for (const name of ['src', 'bin']) await cp(path.join(repo, 'packages', 'render-cut', name),
    path.join(render, name), { recursive: true });
await cp(path.join(repo, 'packages', 'render-cut', 'package.json'), path.join(render, 'package.json'));
const osr = path.join(packages, 'osr-export');
await mkdir(osr, { recursive: true });
await cp(path.join(repo, 'packages', 'osr-export', 'src'), path.join(osr, 'src'), { recursive: true });
await cp(path.join(repo, 'packages', 'osr-export', 'package.json'), path.join(osr, 'package.json'));
for (const name of ['bin', 'scripts']) await symlink(path.join(repo, 'packages', 'osr-export', name), path.join(osr, name));
for (const name of ['node_modules', 'presets', 'catalog', 'templates', 'docs']) {
    const item = path.join(repo, name);
    if ((await stat(item).catch(() => null))?.isDirectory()) await symlink(item, path.join(temporary, name));
}
const font = 'assets/font/noto-sans-jp/NotoSansJP-Variable.ttf';
await mkdir(path.dirname(path.join(temporary, font)), { recursive: true });
await cp(path.join(repo, font), path.join(temporary, font));
const old = spawnSync('git', ['show', 'HEAD:packages/render-cut/src/captions.mjs'],
    { cwd: repo, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
if (old.status !== 0) throw new Error('old caption generator unavailable');
await writeFile(path.join(render, 'src', 'captions.mjs'), old.stdout);
for (const label of ['before', 'after']) {
    const project = path.join(temporary, label);
    await cp(fixture, project, { recursive: true });
    const file = path.join(project, 'captions.json');
    const root = JSON.parse(await readFile(file, 'utf8'));
    const cue = (Array.isArray(root) ? root : root.captions).find(item => item.id === 'c-0005');
    if (!cue) throw new Error('placed caption missing');
    cue.text_style = { font_family: 'Noto Sans JP', weight: 700, size_px: 160,
        stroke: { color: '#000000', width_px: 12 }, wrap_width_pct: 90, zone: 'center' };
    if (!Array.isArray(root)) root.default_text_style = { zone: 'bottom' };
    await writeFile(file, `${JSON.stringify(root, null, 2)}\n`);
    const cli = label === 'before'
        ? path.join(render, 'bin', 'render-cut.mjs')
        : path.join(repo, 'packages', 'render-cut', 'bin', 'render-cut.mjs');
    const video = path.join(project, 'exports', 'out.mp4');
    const result = spawnSync(process.execPath, [cli, project, '--out', video, '--engine', 'osr',
        '--force', '--no-verify-blank', '--no-audio'], { encoding: 'utf8', timeout: 600_000,
        maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`${label} OSR failed`);
}
const comparison = spawnSync(process.execPath, [new URL('./outline-compare.mjs', import.meta.url).pathname,
    path.join(temporary, 'before', 'exports', 'out.mp4'),
    path.join(temporary, 'after', 'exports', 'out.mp4'), evidence],
{ encoding: 'utf8', timeout: 180_000 });
if (comparison.status !== 0) throw new Error('outline comparison failed');
console.log(comparison.stdout.trim());
