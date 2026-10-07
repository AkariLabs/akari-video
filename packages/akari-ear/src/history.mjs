import { randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { voiceDictionaryPaths } from './dictionary.mjs';

const histories = new Map();
export function sharedHistory({ env = process.env } = {}) {
  const file = voiceDictionaryPaths({ env }).history;
  if (!histories.has(file)) histories.set(file, createHistory({ env }));
  return histories.get(file);
}

export function createHistory({ env = process.env, enabled = false, now = Date.now } = {}) {
  const file = voiceDictionaryPaths({ env }).history;
  let on = enabled === true;
  let pending = [];
  let timer;
  let writes = Promise.resolve();
  const read = async () => {
    try { return (await readFile(file, 'utf8')).split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const enqueue = operation => {
    writes = writes.then(operation, operation);
    return writes;
  };
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const batch = pending;
    pending = [];
    if (!batch.length) return writes;
    return enqueue(async () => {
      const cutoff = now() - 7 * 24 * 60 * 60 * 1000;
      const rows = [...await read(), ...batch].filter(row => Date.parse(row.at) >= cutoff).slice(-200);
      await mkdir(path.dirname(file), { recursive: true });
      const temporary = path.join(path.dirname(file), `.ear-history.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), { flag: 'wx', mode: 0o600 });
        await rename(temporary, file);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    });
  };
  return {
    record(utterance) {
      if (!on || !utterance?.final || utterance.purpose === 'trial') return;
      pending.push({ id: utterance.id, at: new Date(now()).toISOString(), raw: utterance.raw,
        text: utterance.text, applied: utterance.applied ?? [], purpose: utterance.purpose });
      if (!timer) timer = setTimeout(() => { void flush().catch(() => {}); }, 1000);
    },
    async list() { await flush(); return read(); },
    async clear() { pending = []; if (timer) clearTimeout(timer); timer = undefined; return enqueue(async () => { await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; }); }); },
    setEnabled(value) { on = value === true; if (!on) { pending = []; if (timer) clearTimeout(timer); timer = undefined; } },
    flush,
  };
}
