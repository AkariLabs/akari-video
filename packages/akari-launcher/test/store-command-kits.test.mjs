import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runStoreCommand } from '../src/store-command.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIXTURE = path.join(REPO_ROOT, 'packages', 'schemas', 'examples', 'kit-manifest-v1-valid');
const FIXTURE_WITH_ASSET = path.join(REPO_ROOT, 'packages', 'schemas', 'examples', 'kit-manifest-v1-with-asset');

function context() {
  const home = mkdtempSync(path.join(tmpdir(), 'akari-store-kits-test-'));
  const lines = [];
  return {
    home, lines,
    options: { env: { AKARI_HOME: home }, log: (line) => lines.push(line) },
    cleanup: () => rmSync(home, { recursive: true, force: true })
  };
}

function fixtureZip(ctx, {
  compatible = false,
  invalid = false,
  manifest = true,
  withAsset = false,
  id = 'sample-kit',
  skillName = 'sample-kit-skill'
} = {}) {
  const source = path.join(ctx.home, `zip-source-${id}`);
  mkdirSync(source, { recursive: true });
  if (manifest) cpSync(withAsset ? FIXTURE_WITH_ASSET : FIXTURE, source, { recursive: true });
  else writeFileSync(path.join(source, 'README.md'), 'legacy');
  if (manifest && !invalid) {
    const manifestPath = path.join(source, 'manifest.json');
    const value = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (compatible) value.requires.cli = '>=0.1.0';
    value.id = id;
    value.skills[0].name = skillName;
    writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
    const skillPath = path.join(source, value.skills[0].dir, 'SKILL.md');
    writeFileSync(skillPath, readFileSync(skillPath, 'utf8').replace('name: sample-kit-skill', `name: ${skillName}`));
  }
  if (invalid) writeFileSync(path.join(source, 'manifest.json'), '{broken');
  const zipPath = path.join(ctx.home, `${id}.zip`);
  const zipped = spawnSync('zip', ['-q', '-r', zipPath, '.'], { cwd: source, encoding: 'utf8' });
  assert.equal(zipped.status, 0, zipped.stderr);
  return zipPath;
}

function zipTree(ctx, name, writeTree) {
  const source = path.join(ctx.home, `zip-source-${name}`);
  mkdirSync(source, { recursive: true });
  writeTree(source);
  const zipPath = path.join(ctx.home, `${name}.zip`);
  const zipped = spawnSync('zip', ['-q', '-r', zipPath, '.'], { cwd: source, encoding: 'utf8' });
  assert.equal(zipped.status, 0, zipped.stderr);
  return zipPath;
}

test('kit install --from: compatible fixture を検査して台帳・skill・marketplace を生成する', async () => {
  const ctx = context();
  try {
    const result = await runStoreCommand(['install', 'sample-kit', '--from', fixtureZip(ctx, { compatible: true })], ctx.options);
    assert.equal(result.exitCode, 0);
    const ledger = JSON.parse(readFileSync(path.join(ctx.home, 'kits', 'installed.json'), 'utf8'));
    assert.equal(ledger.kits[0].id, 'sample-kit');
    const skill = path.join(ctx.home, 'kits', 'plugin', 'skills', 'sample-kit-skill');
    assert.equal(readlinkSync(skill), '../../../assets/store/sample-kit/skills/sample-kit-skill');
    assert.ok(existsSync(path.join(ctx.home, 'kits', '.claude-plugin', 'marketplace.json')));
    assert.ok(ctx.lines.some((line) => line.includes('claude plugin install akari-kits@akari-kits')));
  } finally { ctx.cleanup(); }
});

test('kit install --from: 素材を installed.json に登録し uninstall で索引から外す', async () => {
  const ctx = context();
  try {
    const zipPath = fixtureZip(ctx, { compatible: true, withAsset: true });
    const installed = await runStoreCommand(['install', 'sample-kit', '--from', zipPath], ctx.options);
    assert.equal(installed.exitCode, 0);

    const indexPath = path.join(ctx.home, 'assets', 'installed.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    const pack = index.packs['sample-kit'];
    assert.equal(index.schema, 'akari-installed-assets/v0');
    assert.equal(pack.version, 1);
    assert.equal(pack.root, path.join(ctx.home, 'assets', 'store', 'sample-kit'));
    assert.equal(pack.items.length, 1);
    assert.equal(pack.items[0].id, 'sample-kit-frame');
    assert.equal(pack.items[0].path, 'assets/overlay/sample-kit-frame');
    assert.ok(pack.items[0].files.some((file) => file.path === 'fragment.html'));
    assert.ok(pack.items[0].files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256)));

    const removed = await runStoreCommand(['uninstall', 'sample-kit'], ctx.options);
    assert.equal(removed.exitCode, 0);
    assert.equal(JSON.parse(readFileSync(indexPath, 'utf8')).packs['sample-kit'], undefined);
  } finally { ctx.cleanup(); }
});

test('kit install --from: 素の fixture は cli blocker で symlink を作らず exit 1', async () => {
  const ctx = context();
  try {
    const result = await runStoreCommand(['install', 'sample-kit', '--from', fixtureZip(ctx)], ctx.options);
    assert.equal(result.exitCode, 1);
    assert.ok(ctx.lines.some((line) => line.includes('CLI >=0.1.70')));
    assert.equal(existsSync(path.join(ctx.home, 'kits', 'plugin', 'skills', 'sample-kit-skill')), false);
    assert.ok(existsSync(path.join(ctx.home, 'assets', 'store', 'sample-kit', 'manifest.json')));
  } finally { ctx.cleanup(); }
});

test('kit install --from: manifest 検査失敗は fail-closed', async () => {
  const ctx = context();
  try {
    const result = await runStoreCommand(['install', 'sample-kit', '--from', fixtureZip(ctx, { invalid: true })], ctx.options);
    assert.equal(result.exitCode, 1);
    assert.ok(ctx.lines.some((line) => line.includes('キットの検査に失敗')));
    assert.equal(existsSync(path.join(ctx.home, 'kits', 'plugin', 'skills', 'sample-kit-skill')), false);
  } finally { ctx.cleanup(); }
});

test('配布形で manifest 検査器と runtime registry が無ければ warning で続行する', async () => {
  const ctx = context();
  try {
    ctx.options.assets = { repoRoot: path.join(ctx.home, 'vendor'), schemasSourceDir: null, skillsSourceDir: null };
    const result = await runStoreCommand(['install', 'sample-kit', '--from', fixtureZip(ctx, { compatible: true })], ctx.options);
    assert.equal(result.exitCode, 0);
    assert.ok(ctx.lines.some((line) => line.includes('キットの検査ツールが見つからないため検査をスキップしました')));
    assert.ok(ctx.lines.some((line) => line.includes('runtime registry が見つからないため')));
  } finally { ctx.cleanup(); }
});

test('manifest 無し zip は従来どおり展開だけ行う', async () => {
  const ctx = context();
  try {
    const result = await runStoreCommand(['install', 'legacy-pack', '--from', fixtureZip(ctx, { manifest: false })], ctx.options);
    assert.equal(result.exitCode, 0);
    assert.equal(existsSync(path.join(ctx.home, 'kits', 'installed.json')), false);
    assert.ok(existsSync(path.join(ctx.home, 'assets', 'store', 'legacy-pack', 'README.md')));
  } finally { ctx.cleanup(); }
});

test('深い階層の無関係な manifest.json はキットとして探索せず従来どおり展開する', async () => {
  const ctx = context();
  try {
    const zipPath = zipTree(ctx, 'deep-manifest', (source) => {
      const nested = path.join(source, 'assets', 'overlay', 'foo');
      mkdirSync(nested, { recursive: true });
      writeFileSync(path.join(nested, 'manifest.json'), JSON.stringify({ kind: 'asset-pack' }));
    });
    const result = await runStoreCommand(['install', 'deep-manifest', '--from', zipPath], ctx.options);
    assert.equal(result.exitCode, 0);
    assert.equal(existsSync(path.join(ctx.home, 'kits', 'installed.json')), false);
    assert.ok(existsSync(path.join(ctx.home, 'assets', 'store', 'deep-manifest', 'assets', 'overlay', 'foo', 'manifest.json')));
  } finally { ctx.cleanup(); }
});

test('規定位置でも kind 非 kit の manifest はログなしで従来経路へ素通りする', async () => {
  const ctx = context();
  try {
    const zipPath = zipTree(ctx, 'asset-pack', (source) => {
      writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ kind: 'asset-pack' }));
    });
    const result = await runStoreCommand(['install', 'asset-pack', '--from', zipPath], ctx.options);
    assert.equal(result.exitCode, 0);
    assert.equal(existsSync(path.join(ctx.home, 'kits', 'installed.json')), false);
    assert.ok(ctx.lines.every((line) => !line.includes('キットの検査') && !line.includes('拡張キットを有効化')));
  } finally { ctx.cleanup(); }
});

test('有効化案内は最初のキットだけに出し、別 productId の 2 個目では出さない', async () => {
  const ctx = context();
  try {
    const first = await runStoreCommand(['install', 'sample-kit', '--from', fixtureZip(ctx, { compatible: true })], ctx.options);
    assert.equal(first.exitCode, 0);
    assert.equal(ctx.lines.filter((line) => line.includes('claude plugin marketplace add')).length, 1);
    const secondZip = fixtureZip(ctx, { compatible: true, id: 'second-kit', skillName: 'second-kit-skill' });
    const second = await runStoreCommand(['install', 'second-kit', '--from', secondZip], ctx.options);
    assert.equal(second.exitCode, 0);
    assert.equal(ctx.lines.filter((line) => line.includes('claude plugin marketplace add')).length, 1);
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(ctx.home, 'kits', 'installed.json'), 'utf8')).kits.map((kit) => kit.id),
      ['sample-kit', 'second-kit']
    );
  } finally { ctx.cleanup(); }
});

test('uninstall は symlink と台帳だけを外し、展開ディレクトリを残す', async () => {
  const ctx = context();
  try {
    await runStoreCommand(['install', 'sample-kit', '--from', fixtureZip(ctx, { compatible: true })], ctx.options);
    const result = await runStoreCommand(['uninstall', 'sample-kit'], ctx.options);
    assert.equal(result.exitCode, 0);
    assert.equal(existsSync(path.join(ctx.home, 'kits', 'plugin', 'skills', 'sample-kit-skill')), false);
    assert.equal(JSON.parse(readFileSync(path.join(ctx.home, 'kits', 'installed.json'), 'utf8')).kits.length, 0);
    assert.ok(existsSync(path.join(ctx.home, 'assets', 'store', 'sample-kit', 'manifest.json')));
    assert.equal((await runStoreCommand(['uninstall', 'sample-kit'], ctx.options)).exitCode, 1);
  } finally { ctx.cleanup(); }
});

test('store status は既存表示の後ろに拡張キット節を出す', async () => {
  const ctx = context();
  try {
    await runStoreCommand(['install', 'sample-kit', '--from', fixtureZip(ctx, { compatible: true })], ctx.options);
    writeFileSync(path.join(ctx.home, 'store-credentials.json'), JSON.stringify({ token: 'akst_test', url: 'https://example.test' }));
    ctx.options.fetch = async () => new Response(JSON.stringify({
      email: 'buyer@example.test', entitlements: [{ product_id: 'sample-kit', current_version: 1 }]
    }), { status: 200 });
    ctx.lines.length = 0;
    const result = await runStoreCommand(['status'], ctx.options);
    assert.equal(result.exitCode, 0);
    const section = ctx.lines.indexOf('拡張キット:');
    assert.ok(section > ctx.lines.findIndex((line) => line.startsWith('接続中:')));
    assert.match(ctx.lines[section + 1], /sample-kit v1.*sample-kit-skill.*素材: 0 件/u);
  } finally { ctx.cleanup(); }
});
