import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { VENDOR_SOURCES } from '../src/vendor-sources.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const catalog = path.join(repo, 'catalog');
const prefixes = VENDOR_SOURCES.filter(source => source.startsWith('catalog/'));
const covered = relative => prefixes.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`));

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (entry.isFile()) yield full;
  }
}

test('vendor catalog covers every distributable file and excludes restricted licenses', () => {
  let count = 0;
  for (const file of files(catalog)) {
    count++;
    const relative = path.relative(repo, file).replaceAll('\\', '/');
    const restricted = /^catalog\/audio\/akari-sounds-[^/]+\//u.test(relative) || relative === 'catalog/audio/INDEX.md';
    assert.equal(covered(relative), !restricted, relative);
    if (covered(relative)) assert.equal(readFileSync(file).includes('LicenseRef-AKARI-'), false, relative);
  }
  assert.ok(count > 0);
});
