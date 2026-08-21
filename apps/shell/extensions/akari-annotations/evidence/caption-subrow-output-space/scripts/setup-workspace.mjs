#!/usr/bin/env node
// caption-subrow-output-space の L1 用 隔離ワークスペースを作る。
// templates/project-default/ を複製し、fixture/ の edit.json / captions.json を重ね、
// 実素材 assets/source.mp4 を ffmpeg で生成する（14 秒 / 30fps / 320x180）。
//
// Usage: node setup-workspace.mjs <workspaceDir> [captionsFixtureName]
//   captionsFixtureName 既定 = captions.json（もう一方は captions-no-dropped.json）

import { cp, mkdir, rm, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(HERE, '../../../../../../..');
const TEMPLATE = path.join(REPO_ROOT, 'templates/project-default');

const [, , workspaceDirArg, captionsNameArg] = process.argv;
if (!workspaceDirArg) {
  console.error('usage: node setup-workspace.mjs <workspaceDir> [captionsFixtureName]');
  process.exit(2);
}
const WORKSPACE = path.resolve(workspaceDirArg);
const CAPTIONS_NAME = captionsNameArg || 'captions.json';

await rm(WORKSPACE, { recursive: true, force: true });
await mkdir(path.dirname(WORKSPACE), { recursive: true });
await cp(TEMPLATE, WORKSPACE, { recursive: true });
await copyFile(path.join(EVIDENCE_DIR, 'fixture/edit.json'), path.join(WORKSPACE, 'edit.json'));
await copyFile(path.join(EVIDENCE_DIR, 'fixture', CAPTIONS_NAME), path.join(WORKSPACE, 'captions.json'));
await mkdir(path.join(WORKSPACE, 'assets'), { recursive: true });

execFileSync('ffmpeg', [
  '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=14',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=14',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
  path.join(WORKSPACE, 'assets/source.mp4')
], { stdio: 'ignore' });

console.log(JSON.stringify({ workspace: WORKSPACE, captions: CAPTIONS_NAME, template: TEMPLATE }, null, 2));
