#!/usr/bin/env node
// Offline only. Each invocation appends a start and an end event; it never truncates the journal.
import { appendFile, copyFile, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const atomicJson = async (file, value) => {
  await writeFile(`${file}.${process.pid}.tmp`, JSON.stringify(value, null, 2));
  await rename(`${file}.${process.pid}.tmp`, file);
};
export async function run(args) {
  if (args[0] !== 'generate' || args[1] !== 'video' || !args.includes('--yes')) throw Error('Expected approved generate video');
  if (args.includes('--inputs')) throw Error('Legacy --inputs is forbidden');
  const project = path.resolve(args[2]);
  const itemId = args[args.indexOf('--item') + 1];
  if (!['clip-a', 'clip-b'].includes(itemId)) throw Error(`Unexpected target: ${itemId}`);
  const started_at = Date.now();
  const journal = path.join(project, 'fake-invocations.jsonl');
  const append = event => appendFile(journal, `${JSON.stringify(event)}\n`);
  await append({ event: 'start', itemId, started_at, args });
  let ok = false;
  try {
    const editPath = path.join(project, 'edit.json');
    const edit = JSON.parse(await readFile(editPath, 'utf8'));
    const item = edit.tracks.flatMap(track => track.items ?? []).find(item => item.id === itemId);
    const source = edit.sources.find(source => source.id === item.source.src);
    const { next } = JSON.parse(await readFile(path.join(project, `${source.path}.meta.json`), 'utf8'));
    if (!next) throw Error('Missing next draft');
    const output = `assets/generated/gen-${itemId}.mp4`;
    const target = path.join(project, `${output}.meta.json`);
    await mkdir(path.dirname(target), { recursive: true });
    const base = { version: 1, kind: 'video', model: next.model, inputs: next.inputs, output: next.output,
      placeholder: { path: source.path, item_id: itemId },
      job: { provider: 'fake', request_id: `fake-${itemId}`, started_at: new Date(started_at).toISOString(), stale_after_s: 900 }
    };
    await atomicJson(target, { ...base, status: 'generating' });
    await sleep(1800);
    await copyFile(path.join(project, 'fake-result.mp4'), path.join(project, output));
    const sha256 = createHash('sha256').update(await readFile(path.join(project, output))).digest('hex');
    await atomicJson(target, { ...base, status: 'done', result: { path: output, sha256, duration_s_actual: 6 } });
    source.path = output;
    await atomicJson(editPath, edit);
    ok = true;
    return 0;
  } finally {
    await append({ event: 'end', itemId, started_at, ended_at: Date.now(), ok });
  }
}
if (process.argv[1] && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) {
  process.exitCode = await run(process.argv.slice(2));
}
