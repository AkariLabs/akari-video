#!/usr/bin/env node
import { cp, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CENTERED_BARS, FRAGMENT_IDS, FRAGMENTS } from './fixtures.mjs';

const workspaceArg = process.argv[2];
if (!workspaceArg) throw new Error('usage: prepare-fixture.mjs <workspace>');
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = path.resolve(here, '../../../../../../..');
await mkdir(workspaceArg, { recursive: true });
const workspace = await realpath(workspaceArg);
const htmlItem = (id, extra = {}) => ({ id, at: 0, duration: 120, ...extra,
  source: { kind: 'html', path: `overlays/${id}.html` } });

// kind: 'flat' = 木の無いプロジェクト / 'group' = group を 1 つ持つ / 'scaled' = 棒グラフだけ・拡縮と回転つき
const create = async (folder, kind) => {
  const project = path.join(workspace, folder);
  await cp(path.join(repo, 'templates/project-default'), project, { recursive: true });
  await mkdir(path.join(project, 'overlays'), { recursive: true });
  const ids = kind === 'scaled' ? ['bars'] : FRAGMENT_IDS;
  for (const id of ids) {
    await writeFile(path.join(project, 'overlays', `${id}.html`),
      kind === 'scaled' ? CENTERED_BARS : FRAGMENTS[id]);
  }
  const items = kind === 'scaled'
    ? [htmlItem('bars', { transform: { x: 0, y: 0, scale: 1.5, rotate: 20 } })]
    : ids.map(id => htmlItem(id));
  const edit = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
    tracks: kind === 'group'
      ? [{ id: 'visual', lane: 'visual', items: [
        { id: 'group', at: 0, duration: 120, source: { kind: 'group' }, items }] }]
      : items.map((item, index) => ({ id: `visual-${index + 1}`, lane: 'visual', items: [item] })) };
  await writeFile(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
  await writeFile(path.join(project, 'review.json'), '{"version":0,"annotations":[]}\n');
};
await create('project', 'flat');
await create('project/group-project', 'group');
await create('project/scaled-project', 'scaled');
