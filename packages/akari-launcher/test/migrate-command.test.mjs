import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runMigrateCommand } from '../src/migrate-command.mjs';
import * as migrate from '../../edit-store/lib/migrate/index.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'akari-launcher-migrate-'));
  const editPath = join(root, 'edit.json');
  const text = `${JSON.stringify({
    version: 0, output: { width: 1280, height: 720, fps: 30 },
    source: { path: 'source.mp4', proxy: null }, cuts: [{ in: 0, out: 1 }], overlays: [],
  }, null, 2)}\n`;
  await writeFile(editPath, text);
  return { root, editPath, text };
}

test('akari migrate --dry-run は提案だけで書かない', async () => {
  const item = await fixture();
  try {
    const result = await runMigrateCommand([item.root, '--dry-run'], { migrate, log: () => {}, error: () => {} });
    assert.equal(result.exitCode, 0);
    assert.equal(await readFile(item.editPath, 'utf8'), item.text);
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test('非 TTY で --yes なしは exit 2 で書かない', async () => {
  const item = await fixture();
  try {
    const errors = [];
    const result = await runMigrateCommand([item.root], { migrate, isTTY: false, log: () => {}, error: line => errors.push(line) });
    assert.equal(result.exitCode, 2);
    assert.equal(await readFile(item.editPath, 'utf8'), item.text);
    assert.match(errors.join('\n'), /--yes/);
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test('--yes は .akari/backup へ退避して v2 を書く', async () => {
  const item = await fixture();
  try {
    const result = await runMigrateCommand([item.root, '--yes'], {
      migrate, now: new Date('2026-08-19T00:00:00.000Z'), log: () => {}, error: () => {},
    });
    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(await readFile(item.editPath, 'utf8')).version, 2);
    assert.equal(await readFile(result.proposal.backupPath, 'utf8'), item.text);
  } finally { await rm(item.root, { recursive: true, force: true }); }
});
