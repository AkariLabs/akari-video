#!/usr/bin/env node
import { cp, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHELL_BOX_FRAGMENTS, SHELL_BOX_PROJECTS } from '../../../../../../../packages/overlay-runtime/test-harness/fixtures/element-box-fixtures.mjs';

const workspaceArg = process.argv[2];
if (!workspaceArg) throw new Error('usage: prepare-fixture.mjs <workspace>');
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = path.resolve(here, '../../../../../../..');
await mkdir(workspaceArg, { recursive: true });
const workspace = await realpath(workspaceArg);
// 断片は 1 プロジェクトに 1 枚。アイテムの id は断片の種類（bars / small / inline / svg）。
for (const [folder, { id, fragment, transform }] of Object.entries(SHELL_BOX_PROJECTS)) {
  const project = path.join(workspace, folder);
  await cp(path.join(repo, 'templates/project-default'), project, { recursive: true });
  await mkdir(path.join(project, 'overlays'), { recursive: true });
  await writeFile(path.join(project, 'overlays', `${id}.html`), SHELL_BOX_FRAGMENTS[fragment]);
  const item = { id, at: 0, duration: 120, ...(transform ? { transform } : {}),
    source: { kind: 'html', path: `overlays/${id}.html` } };
  const edit = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
    tracks: [{ id: 'visual-1', lane: 'visual', items: [item] }] };
  await writeFile(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
  await writeFile(path.join(project, 'review.json'), '{"version":0,"annotations":[]}\n');
}
