#!/usr/bin/env node

import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.resolve(here, '..');
const repositoryRoot = path.resolve(here, '../../../../../../..');
const [, , workspaceArg] = process.argv;
if (!workspaceArg) throw new Error('usage: setup-workspace.mjs <workspace>');
const workspace = path.resolve(workspaceArg);

await rm(workspace, { recursive: true, force: true });
await cp(path.join(repositoryRoot, 'templates/project-default'), workspace, { recursive: true });
await copyFile(path.join(evidenceDir, 'fixture/edit.json'), path.join(workspace, 'edit.json'));
await copyFile(path.join(evidenceDir, 'fixture/captions.json'), path.join(workspace, 'captions.json'));
await mkdir(path.join(workspace, 'assets'), { recursive: true });

for (const [name, color] of [['source-a', '0x2448c8'], ['source-b', '0x26a65b']]) {
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', `color=c=${color}:size=320x180:rate=30:duration=2`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    path.join(workspace, 'assets', `${name}.mp4`),
  ], { stdio: 'ignore' });
}
console.log(JSON.stringify({ fixture: 'caption-output-domain', ready: true }));
