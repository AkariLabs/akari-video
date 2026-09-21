import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCreatorRoot } from '../../creator-root/src/index.mjs';

const cli = path.resolve(import.meta.dirname, '../bin/akari-assets.mjs');
const launcher = path.resolve(import.meta.dirname, '../../akari-launcher/bin/akari.mjs');
async function manifest(root, dir = root) {
  const rows = [];
  for (const name of (await fs.readdir(dir)).sort()) {
    const file = path.join(dir, name), stat = await fs.lstat(file);
    const relative = path.relative(root, file);
    if (stat.isSymbolicLink()) rows.push([relative, 'link', await fs.readlink(file)]);
    else if (stat.isDirectory()) rows.push([relative, 'directory'], ...await manifest(root, file));
    else rows.push([relative, 'file', createHash('sha256').update(await fs.readFile(file)).digest('hex')]);
  }
  return rows;
}
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(tmpdir(), 'assets-cli-guards-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'home'), creator = path.join(temp, 'creator');
  const root = path.join(creator, 'library'), legacy = path.join(home, 'assets');
  const env = { ...process.env, HOME: temp, AKARI_HOME: home, AKARI_CREATOR_ROOT: creator,
    AKARI_LIBRARY_ROOT: root, AKARI_ASSETS_CATALOG: path.join(temp, 'catalog.json') };
  await createCreatorRoot(creator);
  await fs.mkdir(path.join(legacy, 'still/card'), { recursive: true });
  await fs.writeFile(path.join(legacy, 'still/card/frame.png'), 'original bytes');
  await fs.writeFile(env.AKARI_ASSETS_CATALOG, '{"version":1,"items":[]}');
  return { temp, home, root, legacy, env };
}
const invalid = [
  ['migrate', '--dry-runn'], ['migrate', 'extra'], ['migrate', '-x'],
  ['fetch', 'card', '--froce'], ['fetch', 'card', 'extra'], ['fetch', 'card', '--project'],
  ['fetch', 'card', '--project', '--force'], ['fetch', 'card', '--force', '--force'],
  ['bundle', '--project', 'project', '--typo'], ['bundle', '--project', 'project', 'extra'],
  ['bundle', '--project'], ['bundle', '--project', 'a', '--project', 'b'],
  ['add', '--apply', 'plan.json', '--typo'], ['add', '--apply', 'plan.json', 'extra'],
  ['add', '--apply'], ['add', '--apply', '--json'], ['add', '--apply', 'plan.json', '--plan'],
  ['add', 'file', '--plan', '-x'], ['list', 'extra'], ['sync', '--typo'], ['browse', 'extra'],
];
for (const viaLauncher of [false, true]) {
  test(`${viaLauncher ? 'akari assets' : 'akari-assets'}: help and invalid arguments preserve every file and sha256`, async t => {
    const f = await fixture(t);
    const before = await manifest(f.temp);
    const cases = [
      ...['list', 'add', 'fetch', 'bundle', 'migrate', 'sync', 'browse'].flatMap(sub =>
        ['--help', '-h'].map(flag => [[sub, flag], 0])),
      ...invalid.map(args => [args, 2]),
    ];
    for (const [args, status] of cases) {
      const result = spawnSync(process.execPath, viaLauncher ? [launcher, 'assets', ...args] : [cli, ...args],
        { env: f.env, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, status, `${args.join(' ')}: ${result.stderr}`);
      assert.match(result.stdout, /使い方: akari-assets/);
      assert.deepEqual(await manifest(f.temp), before, args.join(' '));
      await assert.rejects(fs.stat(path.join(f.home, 'library-location.json')), { code: 'ENOENT' });
    }
  });
  test(`${viaLauncher ? 'akari assets' : 'akari-assets'}: repeated migrate with legacy root symlink preserves all bytes`, async t => {
    const f = await fixture(t);
    await fs.rename(f.legacy, f.root);
    await fs.symlink(f.root, f.legacy, 'dir');
    const before = await manifest(f.temp);
    for (let run = 0; run < 2; run++) {
      const result = spawnSync(process.execPath, viaLauncher ? [launcher, 'assets', 'migrate'] : [cli, 'migrate'],
        { env: f.env, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 0, result.stderr);
      const data = JSON.parse(result.stdout);
      assert.match(data.skippedReason, /same location/);
      assert.equal(data.state, null);
      assert.equal(data.moved, 0);
      assert.deepEqual(await manifest(f.temp), before);
    }
  });
}
