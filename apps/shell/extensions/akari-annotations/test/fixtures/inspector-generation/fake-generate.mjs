#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function run(argv = process.argv.slice(2)) {
  const video = argv[0] === 'generate' && argv[1] === 'video';
  if (!video) return 0;
  const root = path.resolve(argv[2]);
  const itemIndex = argv.indexOf('--item');
  const itemId = itemIndex >= 0 ? argv[itemIndex + 1] : '';
  const edit = JSON.parse(await fs.readFile(path.join(root, 'edit.json'), 'utf8'));
  const items = edit.tracks.flatMap(track => track.items ?? []);
  const item = items.find(candidate => candidate.id === itemId);
  const source = edit.sources.find(candidate => candidate.id === item?.source?.src);
  if (!source) throw new Error(`fixture item が見つかりません: ${itemId}`);
  const firstFrame = await fs.readFile(path.join(root, source.path));
  const generatedDirectory = path.join(root, 'assets', 'generated');
  await fs.mkdir(generatedDirectory, { recursive: true });
  const resultPath = `assets/generated/gen-${itemId}.mp4`;
  const metaPath = path.join(root, `${resultPath}.meta.json`);
  const base = {
    version: 1, kind: 'video', inputs: { first_frame: {
      path: source.path,
      sha256: createHash('sha256').update(firstFrame).digest('hex'),
      source_id: source.id
    } }, output: { duration_s: 6 },
    model: { id: 'fake:video', as_of: '2026-09-12' },
    job: {
      provider: 'fake', request_id: `fake-${itemId}-${process.pid}`,
      started_at: new Date().toISOString(), stale_after_s: 30
    }
  };
  await fs.writeFile(metaPath, `${JSON.stringify({ ...base, status: 'generating', progress: 45 }, null, 2)}\n`);
  await wait(3000);
  await fs.writeFile(metaPath, `${JSON.stringify({
    ...base, status: 'done', result: { path: resultPath }
  }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, item: itemId }));
  return 0;
}

async function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url));
  } catch { return false; }
}

if (await isMainModule()) process.exitCode = await run();
