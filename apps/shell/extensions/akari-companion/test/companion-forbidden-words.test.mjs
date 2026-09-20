import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const blocked = new RegExp([['vo', 'ice'].join(''), String.fromCodePoint(0x97f3, 0x58f0)].join('|'), 'iu');

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.tsx?$/u.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

test('公開ソースに禁止された語が無い', async () => {
  for (const file of await sourceFiles(sourceRoot)) {
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/u);
    lines.forEach((line, index) => assert.doesNotMatch(line, blocked, `${file}:${index + 1}`));
  }
});
