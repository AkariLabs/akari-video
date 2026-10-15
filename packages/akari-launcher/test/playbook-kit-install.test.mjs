import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStoreCommand } from '../src/store-command.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cli = path.join(root, 'packages', 'akari-launcher', 'bin', 'akari.mjs');
const sample = path.join(root, 'packages', 'project-scaffold', 'test', 'fixtures', 'playbook-sample');
const id = 'lab-example';

function makeZip(temp) {
  const kit = path.join(temp, 'kit');
  const playbook = path.join(kit, 'playbooks', id);
  mkdirSync(playbook, { recursive: true });
  const record = JSON.parse(readFileSync(path.join(sample, 'playbook.json'), 'utf8'));
  record.id = id;
  writeFileSync(path.join(playbook, 'playbook.json'), `${JSON.stringify(record)}\n`);
  cpSync(path.join(sample, 'playbook.md'), path.join(playbook, 'playbook.md'));
  writeFileSync(path.join(kit, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, id, kind: 'kit', name: 'Lab example', version: 1,
    requires: { cli: '>=1.4.0' }, playbooks: [{ dir: `playbooks/${id}` }], license: 'CC0-1.0'
  }));
  writeFileSync(path.join(kit, 'README.md'), '# Lab example\n');
  writeFileSync(path.join(kit, 'LICENSE.md'), '# CC0\n');
  const zip = path.join(temp, 'kit.zip');
  const archived = spawnSync('zip', ['-q', '-r', zip, 'kit'], { cwd: temp, encoding: 'utf8' });
  assert.equal(archived.status, 0, archived.stderr);
  return zip;
}

test('local zip installs one playbook, records it, and uninstall removes only its link', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'akari-playbook-kit-'));
  const home = path.join(temp, 'home');
  const runAt = (akariHome, ...args) => spawnSync(process.execPath, [cli, 'store', ...args], {
    env: { ...process.env, AKARI_HOME: akariHome }, encoding: 'utf8'
  });
  const run = (...args) => runAt(home, ...args);
  try {
    const zip = makeZip(temp);
    let result = run('install', id, '--from-file', zip);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const link = path.join(home, 'playbooks', id);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.equal(path.isAbsolute(readlinkSync(link)), false);
    let ledger = JSON.parse(readFileSync(path.join(home, 'kits', 'installed.json'), 'utf8'));
    assert.deepEqual(ledger.kits[0].playbooks, [id]);
    const homeAlias = path.join(temp, 'home-alias');
    symlinkSync(home, homeAlias, 'dir');
    result = runAt(homeAlias, 'install', id, '--from-file', zip);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    ledger = JSON.parse(readFileSync(path.join(home, 'kits', 'installed.json'), 'utf8'));
    assert.deepEqual(ledger.kits[0].playbooks, [id], 'reinstall recognizes its link through an aliased home');
    result = run('uninstall', id);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(link), false);
    ledger = JSON.parse(readFileSync(path.join(home, 'kits', 'installed.json'), 'utf8'));
    assert.deepEqual(ledger.kits, []);

    mkdirSync(link, { recursive: true });
    writeFileSync(path.join(link, 'keep.txt'), 'mine');
    result = run('install', id, '--from-file', zip);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /playbooks\/lab-example/);
    assert.equal(lstatSync(link).isDirectory(), true);
    assert.equal(readFileSync(path.join(link, 'keep.txt'), 'utf8'), 'mine');
    ledger = JSON.parse(readFileSync(path.join(home, 'kits', 'installed.json'), 'utf8'));
    assert.deepEqual(ledger.kits[0].playbooks, []);
    result = run('uninstall', id);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(path.join(link, 'keep.txt')), true);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('free product downloads public R2 zip without credentials', async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'akari-free-kit-'));
  const urls = [];
  try {
    const result = await runStoreCommand(['download', id, '--dest', temp], {
      env: { AKARI_HOME: path.join(temp, 'home') }, log: () => {},
      fetch: async url => {
        urls.push(url);
        if (url.endsWith('/products')) return new Response(JSON.stringify({ products: [
          { id, tier: 'free', current_version: 2 }
        ] }), { status: 200 });
        return new Response(Buffer.from('PK-free-zip'), { status: 200 });
      }
    });
    assert.equal(result.exitCode, 0);
    assert.equal(urls[1], `https://akari.video/assets/products/${id}/v2/${id}-v2.zip`);
    assert.equal(readFileSync(result.filePath, 'utf8'), 'PK-free-zip');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('a free starter pack still uses the authenticated legacy download when no public zip exists', async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'akari-starter-pack-'));
  const urls = [];
  const options = {
    env: { AKARI_HOME: path.join(temp, 'home') }, log: () => {},
    fetch: async (url, init) => {
      urls.push(url);
      if (url.endsWith('/v1/entitlements')) return new Response(JSON.stringify({ email: 'test@example.com', entitlements: [] }));
      if (url.endsWith('/products')) return new Response(JSON.stringify({ products: [
        { id: 'starter-pack', tier: 'free', current_version: 1 }
      ] }));
      if (url.includes('/assets/products/')) return new Response(null, { status: 404 });
      assert.match(init.headers.authorization, /^Bearer akst_/);
      return new Response(Buffer.from('PK-legacy'), { headers: { 'content-disposition': 'attachment; filename="starter-pack-v1.zip"' } });
    }
  };
  try {
    assert.equal((await runStoreCommand(['connect', '--token', 'akst_test-token_0123456789'], options)).exitCode, 0);
    const result = await runStoreCommand(['download', 'starter-pack', '--dest', temp], options);
    assert.equal(result.exitCode, 0);
    assert.ok(urls.some(url => url.endsWith('/v1/download/starter-pack')));
    assert.equal(readFileSync(result.filePath, 'utf8'), 'PK-legacy');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('a free Lab playbook is found in the public R2 catalog and verified by sha256', async () => {
  const { createHash } = await import('node:crypto');
  const temp = mkdtempSync(path.join(tmpdir(), 'akari-free-playbook-'));
  const body = Buffer.from('PK-playbook-zip');
  const sha256 = createHash('sha256').update(body).digest('hex');
  const urls = [];
  const catalog = sha => ({ items: [{ id: 'example-film', category: 'playbook', tier: 'free', version: 1,
    files: [{ name: 'example-film.zip', key: 'playbook/example-film/v1/example-film.zip', sha256: sha }] }] });
  try {
    const fetchFor = sha => async url => {
      urls.push(url);
      if (url.endsWith('/products')) return new Response(JSON.stringify({ products: [] }), { status: 200 });
      if (url.endsWith('/assets/catalog.json')) return new Response(JSON.stringify(catalog(sha)), { status: 200 });
      return new Response(body, { status: 200 });
    };
    const ok = await runStoreCommand(['download', 'example-film', '--dest', temp], { env: { AKARI_HOME: path.join(temp, 'home') }, log: () => {}, fetch: fetchFor(sha256) });
    assert.equal(ok.exitCode, 0);
    assert.ok(urls.includes('https://akari.video/assets/playbook/example-film/v1/example-film.zip'));
    assert.equal(readFileSync(ok.filePath, 'utf8'), 'PK-playbook-zip');
    const bad = await runStoreCommand(['download', 'example-film', '--dest', temp], { env: { AKARI_HOME: path.join(temp, 'home') }, log: () => {}, fetch: fetchFor('0'.repeat(64)) });
    assert.equal(bad.exitCode, 1);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
