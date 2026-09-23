#!/usr/bin/env node
// Local fixture only: record next and arguments, then produce a failed job without any network access.
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

async function run(args) {
  if (args[0] !== 'generate' || args[1] !== 'video') throw new Error('Expected generate video');
  if (args.includes('--inputs')) throw new Error('Legacy --inputs is forbidden');
  const root = path.resolve(args[2]);
  const itemId = args[args.indexOf('--item') + 1];
  const edit = JSON.parse(await readFile(path.join(root, 'edit.json'), 'utf8'));
  const item = edit.tracks.flatMap(track => track.items ?? []).find(item => item.id === itemId);
  const source = edit.sources.find(source => source.id === item.source.src);
  const { next } = JSON.parse(await readFile(path.join(root, `${source.path}.meta.json`), 'utf8'));
  await writeFile(path.join(root, 'fake-invocation.json'), JSON.stringify({ args, next }, null, 2));
  const target = path.join(root, 'assets/generated', `gen-${itemId}.mp4.meta.json`);
  await mkdir(path.dirname(target), { recursive: true });
  const base = {
    version: 1, kind: 'video', model: next.model, inputs: next.inputs, output: next.output,
    placeholder: { path: source.path, item_id: itemId },
    job: { provider: 'fake', request_id: `fake-${itemId}`, started_at: new Date().toISOString(), stale_after_s: 900 }
  };
  const write = async status => {
    await writeFile(`${target}.tmp`, JSON.stringify({ ...base, status }));
    await rename(`${target}.tmp`, target);
  };
  await write('generating');
  await sleep(45_000);
  await write('failed');
  console.error('Fixture failure: no provider request was sent.');
  return 1;
}
if (process.argv[1] && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) {
  process.exitCode = await run(process.argv.slice(2));
}
