#!/usr/bin/env node

import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(HERE, '../../../../../../..');
const TEMPLATE = path.join(REPO_ROOT, 'templates/project-default');
const [, , workspaceDirArg] = process.argv;

if (!workspaceDirArg) {
  console.error('usage: node setup-workspace.mjs <workspaceDir>');
  process.exit(2);
}

const workspace = path.resolve(workspaceDirArg);
await rm(workspace, { recursive: true, force: true });
await mkdir(path.dirname(workspace), { recursive: true });
await cp(TEMPLATE, workspace, { recursive: true });
await copyFile(path.join(EVIDENCE_DIR, 'fixture/edit.json'), path.join(workspace, 'edit.json'));
await copyFile(path.join(EVIDENCE_DIR, 'fixture/captions.json'), path.join(workspace, 'captions.json'));
await mkdir(path.join(workspace, 'assets'), { recursive: true });

for (const [name, hue] of [['source-a', 0], ['source-b', 120]]) {
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=30:duration=2`,
    '-vf', `hue=h=${hue}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    path.join(workspace, 'assets', `${name}.mp4`)
  ], { stdio: 'ignore' });
}

console.log(JSON.stringify({ workspace, template: TEMPLATE }, null, 2));
