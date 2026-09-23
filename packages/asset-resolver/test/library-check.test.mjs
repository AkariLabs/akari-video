import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { checkLibrary, projectCredits } from '../src/library-check.mjs';
import { recordProjectReference } from '../src/project-references.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
function meta(category, id, extra = {}) {
  return { id, category, title: id, description: 'fixture', when_to_use: 'test', tags: [], knobs: [],
    ai_usage: 'test', requires: [], provenance: { origin: 'test', generator: null }, author: 'test',
    license: { spdx: 'CC0-1.0', scope: 'commercial-ok', attribution_required: false, ai_training_allowed: true }, price: 0, ...extra };
}
async function asset(root, category, id, data = meta(category, id), files = {}) {
  const dir = path.join(root, category, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(data));
  await fs.writeFile(path.join(dir, 'preview.png'), png);
  for (const [name, body] of Object.entries(files)) await fs.writeFile(path.join(dir, name), body);
  return dir;
}
async function digest(dir) {
  const rows = [];
  async function walk(at) {
    for (const name of (await fs.readdir(at)).sort()) {
      const file = path.join(at, name), info = await fs.stat(file);
      if (info.isDirectory()) await walk(file);
      else rows.push([path.relative(dir, file), createHash('sha256').update(await fs.readFile(file)).digest('hex')]);
    }
  }
  await walk(dir); return rows;
}

test('点検 fixture: meta・読めない音・変換・クレジット・サブスク・台帳欠落を分類し、置き場を変えない', async t => {
  const temp = await fs.mkdtemp(path.join(tmpdir(), 'akari-check-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const library = path.join(temp, 'library'), project = path.join(temp, 'project');
  const env = { AKARI_HOME: path.join(temp, 'home'), AKARI_LIBRARY_ROOT: library, AKARI_CREATOR_ROOT: path.join(temp, 'creator') };
  await fs.mkdir(project);
  await asset(library, 'overlay', 'good', meta('overlay', 'good'), { 'fragment.html': '<div>ok</div>' });
  await asset(library, 'overlay', 'bad-meta', { wrong: true }, { 'fragment.html': '<div>x</div>' });
  await asset(library, 'audio', 'bad-audio', meta('audio', 'bad-audio'), { 'bad-audio.mp3': 'not audio' });
  await asset(library, 'still', 'convert', meta('still', 'convert'), { 'convert.gif': 'GIF89a' });
  await asset(library, 'overlay', 'credit', meta('overlay', 'credit', { license: { ...meta('overlay', 'credit').license, attribution_required: true } }), { 'fragment.html': '<div>x</div>' });
  await asset(library, 'overlay', 'subscription', meta('overlay', 'subscription', { tags: ['license:subscription'] }), { 'fragment.html': '<div>x</div>' });
  await asset(library, 'font', 'bad-font', meta('font', 'bad-font'), { 'bad-font.ttf': 'wrong' });
  await asset(library, 'overlay', 'bad-cube', meta('overlay', 'bad-cube'), { 'fragment.html': '<div>x</div>', 'bad.cube': 'LUT_3D_SIZE 2\n0 0\n' });
  await recordProjectReference(project, { category: 'audio', id: 'missing' });
  const before = await digest(library);
  const result = await checkLibrary({ env, project });
  assert.deepEqual(await digest(library), before);
  const codes = new Set(result.findings.map(row => `${row.id}:${row.code}`));
  for (const key of ['bad-meta:meta', 'bad-audio:media-unreadable', 'convert:conversion', 'credit:credit-missing',
    'subscription:subscription', 'bad-font:media-unreadable', 'bad-cube:cube', 'missing:reference-missing']) assert.ok(codes.has(key), key);
  assert.ok(result.ok >= 1);
});

test('クレジットは台帳と assets/ の双方を読み、同じ文面を一度だけ返す', async t => {
  const temp = await fs.mkdtemp(path.join(tmpdir(), 'akari-credits-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const library = path.join(temp, 'library'), project = path.join(temp, 'project');
  const env = { AKARI_HOME: path.join(temp, 'home'), AKARI_LIBRARY_ROOT: library, AKARI_CREATOR_ROOT: path.join(temp, 'creator') };
  await fs.mkdir(project);
  const license = { ...meta('overlay', 'one').license, attribution_required: true };
  const one = await asset(library, 'overlay', 'one', meta('overlay', 'one', { license }), { 'fragment.html': '<div>x</div>', 'CREDIT.txt': '作者 A\n' });
  const two = await asset(path.join(project, 'assets'), 'overlay', 'two', meta('overlay', 'two', { license }), { 'fragment.html': '<div>x</div>', 'CREDIT.txt': '作者 A\n' });
  await recordProjectReference(project, { category: 'overlay', id: 'one' });
  await recordProjectReference(project, { category: 'overlay', id: 'two' });
  assert.ok(one && two);
  assert.deepEqual(await projectCredits(project, env), ['作者 A']);
  const cli = path.resolve(import.meta.dirname, '../bin/akari-assets.mjs');
  const command = spawnSync(process.execPath, [cli, 'credits', '--project', project],
    { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 30000 });
  assert.equal(command.status, 0, command.stderr);
  assert.equal(command.stdout.trim(), '作者 A');
  const checked = spawnSync(process.execPath, [cli, 'check', '--json'],
    { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120000 });
  assert.ok([0, 1].includes(checked.status), checked.stderr);
  assert.ok(Array.isArray(JSON.parse(checked.stdout).findings));
});
