#!/usr/bin/env node
// 切り分け用の変種を作る。原本は読み取りのみ（複製先だけを書き換える）。
//   node make-variants.mjs <sourceProjectDir> <outRoot>
import { cp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [, , base, outRoot] = process.argv;
if (!base || !outRoot) throw new Error('usage: make-variants.mjs <sourceProjectDir> <outRoot>');

const variants = {
  'v0-original': edit => edit,
  'v1-no-captions': edit => { edit.tracks = edit.tracks.filter(t => t.id !== 'v-captions'); return edit; },
  'v2-no-group': edit => { edit.tracks = edit.tracks.filter(t => t.id !== 'v-deco'); return edit; },
  'v3-no-html-bag': edit => { edit.tracks = edit.tracks.filter(t => t.id !== 'v-parts'); return edit; },
  'v4-no-keyframes': edit => {
    for (const track of edit.tracks) for (const item of track.items ?? []) {
      for (const child of item.items ?? []) delete child.keyframes;
      delete item.keyframes;
    }
    return edit;
  },
  'v5-no-telop': edit => {
    const strip = items => (items ?? []).filter(i => i.source?.kind !== 'telop')
      .map(i => (i.items ? { ...i, items: strip(i.items) } : i));
    edit.tracks = edit.tracks.map(t => (t.items ? { ...t, items: strip(t.items) } : t))
      .filter(t => !t.items || t.items.length > 0);
    return edit;
  }
};

await rm(outRoot, { recursive: true, force: true });
for (const [name, mutate] of Object.entries(variants)) {
  const dir = path.join(outRoot, name);
  await cp(base, dir, { recursive: true });
  const editPath = path.join(dir, 'edit.json');
  const edit = mutate(JSON.parse(await readFile(editPath, 'utf8')));
  await writeFile(editPath, JSON.stringify(edit, null, 2) + '\n');
  console.log(name, 'tracks=', edit.tracks.map(t => t.id).join(','));
}
