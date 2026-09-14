import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkRequires, enableHint, ensureKitsMarketplace, linkKitAssets, linkKitSkills,
  readKitManifest, readKitsLedger, registerKitAssets, removeKit, writeKitsLedger
} from '../src/kits.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function scratch() {
  const home = mkdtempSync(path.join(tmpdir(), 'akari-kits-test-'));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test('checkRequires: 単純 semver 6 例と runtime / product の扱い', () => {
  const cases = [
    ['>=1.2.3', '1.2.3', true],
    ['>=1.2.3', '1.2.2', false],
    ['^1.2.3', '1.9.0', true],
    ['^0.2.3', '0.3.0', false],
    ['~1.2.3', '1.3.0', false],
    ['1.2.3', '1.2.3', true]
  ];
  for (const [range, version, ok] of cases) {
    assert.equal(checkRequires({ requires: { cli: range } }, { cliVersion: version }).ok, ok, `${range} / ${version}`);
  }
  const result = checkRequires(
    { requires: { cli: '>=1.0.0', runtimes: ['three', 'world'], products: ['asset-pack'] } },
    { cliVersion: '1.0.0', runtimeIds: ['three'], entitledProductIds: [] }
  );
  assert.equal(result.ok, false);
  assert.match(result.blockers.join('\n'), /world/u);
  assert.match(result.warnings.join('\n'), /asset-pack/u);
});

test('readKitManifest: manifest が無ければ null', () => {
  const ctx = scratch();
  try { assert.equal(readKitManifest(ctx.home), null); } finally { ctx.cleanup(); }
});

test('skills / assets を所定位置へ相対 symlink で合成する', () => {
  const ctx = scratch();
  try {
    const kitDir = path.join(ctx.home, 'assets', 'store', 'sample-kit');
    mkdirSync(path.join(kitDir, 'skills', 'sample-skill'), { recursive: true });
    mkdirSync(path.join(kitDir, 'assets', 'still', 'sample-still'), { recursive: true });
    writeFileSync(path.join(kitDir, 'assets', 'still', 'sample-still', 'payload.txt'), 'fixture');
    const manifest = {
      id: 'sample-kit',
      skills: [{ dir: 'skills/sample-skill', name: 'sample-skill' }],
      assets: [{ category: 'still', id: 'sample-still' }]
    };
    const skills = linkKitSkills(kitDir, manifest, ctx.home);
    const assets = linkKitAssets(kitDir, manifest, ctx.home, {
      validateAssetPath: '/fixture/validator.mjs',
      spawnSyncImpl: () => ({ status: 0 })
    });
    assert.deepEqual(skills.blockers, []);
    assert.deepEqual(assets.linked, [{ category: 'still', id: 'sample-still' }]);
    assert.equal(readlinkSync(path.join(ctx.home, 'kits', 'plugin', 'skills', 'sample-skill')), '../../../assets/store/sample-kit/skills/sample-skill');
    assert.equal(readlinkSync(path.join(ctx.home, 'assets', 'still', 'sample-still')), '../../assets/store/sample-kit/assets/still/sample-still');
  } finally { ctx.cleanup(); }
});

test('kit install 後は installed.json に素材実体を登録し、uninstall で削除する', () => {
  const ctx = scratch();
  try {
    const kitDir = path.join(ctx.home, 'assets', 'store', 'sample-kit');
    const assetDir = path.join(kitDir, 'assets', 'overlay', 'sample-kit-frame');
    mkdirSync(assetDir, { recursive: true });
    writeFileSync(path.join(assetDir, 'fragment.html'), '<div>kit frame</div>\n');
    writeFileSync(path.join(assetDir, 'meta.json'), '{"title":"Kit Frame"}\n');
    const manifest = {
      id: 'sample-kit', version: 3, skills: [],
      assets: [{ category: 'overlay', id: 'sample-kit-frame' }]
    };
    const assetLinks = linkKitAssets(kitDir, manifest, ctx.home, {
      validateAssetPath: '/fixture/validator.mjs', spawnSyncImpl: () => ({ status: 0 })
    });
    registerKitAssets(ctx.home, manifest, kitDir, assetLinks.items);
    writeKitsLedger(ctx.home, {
      id: manifest.id, version: manifest.version, installedAt: 'now', kitDir,
      skills: [], assets: assetLinks.linked
    });

    const indexPath = path.join(ctx.home, 'assets', 'installed.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    const pack = index.packs['sample-kit'];
    assert.equal(index.schema, 'akari-installed-assets/v0');
    assert.equal(pack.root, kitDir);
    assert.equal(pack.version, 3);
    assert.equal(pack.items[0].path, 'assets/overlay/sample-kit-frame');
    assert.equal(pack.items[0].title, 'Kit Frame');
    assert.deepEqual(pack.items[0].files.map((file) => file.path), ['fragment.html', 'meta.json']);
    assert.ok(pack.items[0].files.every((file) => Number.isInteger(file.bytes) && /^[a-f0-9]{64}$/u.test(file.sha256)));

    assert.equal(removeKit(ctx.home, 'sample-kit'), true);
    assert.equal(JSON.parse(readFileSync(indexPath, 'utf8')).packs['sample-kit'], undefined);
  } finally { ctx.cleanup(); }
});

test('asset の既存実ディレクトリを壊さず warning にする', () => {
  const ctx = scratch();
  try {
    const kitDir = path.join(ctx.home, 'assets', 'store', 'sample-kit');
    const destination = path.join(ctx.home, 'assets', 'still', 'sample-still');
    mkdirSync(path.join(kitDir, 'assets', 'still', 'sample-still'), { recursive: true });
    mkdirSync(destination, { recursive: true });
    writeFileSync(path.join(destination, 'keep.txt'), 'keep');
    const result = linkKitAssets(kitDir, { id: 'sample-kit', assets: [{ category: 'still', id: 'sample-still' }] }, ctx.home, {
      validateAssetPath: '/fixture/validator.mjs', spawnSyncImpl: () => ({ status: 0 })
    });
    assert.equal(readFileSync(path.join(destination, 'keep.txt'), 'utf8'), 'keep');
    assert.match(result.warnings.join('\n'), /既存の実ディレクトリ/u);
  } finally { ctx.cleanup(); }
});

test('別キットの同名 skill は blocker', () => {
  const ctx = scratch();
  try {
    const first = path.join(ctx.home, 'assets', 'store', 'first');
    const second = path.join(ctx.home, 'assets', 'store', 'second');
    mkdirSync(path.join(first, 'skills', 'same'), { recursive: true });
    mkdirSync(path.join(second, 'skills', 'same'), { recursive: true });
    const manifest = { skills: [{ dir: 'skills/same', name: 'same' }] };
    linkKitSkills(first, manifest, ctx.home);
    assert.match(linkKitSkills(second, manifest, ctx.home).blockers.join('\n'), /別のキット/u);
  } finally { ctx.cleanup(); }
});

test('Windows の symlink EPERM は warning に落として続行する', () => {
  const ctx = scratch();
  try {
    const kitDir = path.join(ctx.home, 'assets', 'store', 'sample-kit');
    mkdirSync(path.join(kitDir, 'skills', 'sample'), { recursive: true });
    const denied = new Error('denied');
    denied.code = 'EPERM';
    const result = linkKitSkills(
      kitDir,
      { skills: [{ dir: 'skills/sample', name: 'sample' }] },
      ctx.home,
      { platform: 'win32', symlinkSyncImpl: () => { throw denied; } }
    );
    assert.deepEqual(result.linked, []);
    assert.match(result.warnings.join('\n'), /Windows/u);
  } finally { ctx.cleanup(); }
});

test('台帳は同じ id を置換し、marketplace 生成は冪等', () => {
  const ctx = scratch();
  try {
    writeKitsLedger(ctx.home, { id: 'sample', version: 1, installedAt: 'one', kitDir: '/one', skills: [], assets: [] });
    writeKitsLedger(ctx.home, { id: 'sample', version: 2, installedAt: 'two', kitDir: '/two', skills: ['x'], assets: [] });
    assert.equal(readKitsLedger(ctx.home).kits.length, 1);
    assert.equal(readKitsLedger(ctx.home).kits[0].version, 2);
    ensureKitsMarketplace(ctx.home);
    const marketplacePath = path.join(ctx.home, 'kits', '.claude-plugin', 'marketplace.json');
    const before = readFileSync(marketplacePath, 'utf8');
    ensureKitsMarketplace(ctx.home);
    assert.equal(readFileSync(marketplacePath, 'utf8'), before);
    assert.equal(JSON.parse(before).plugins[0].source, './plugin');
    assert.ok(!before.includes(ctx.home));
    assert.match(enableHint(), /claude plugin marketplace add ~\/\.akari\/kits/u);
    assert.match(enableHint(), /claude plugin install akari-kits@akari-kits/u);
  } finally { ctx.cleanup(); }
});

test('SessionStart: キットあり・plugin 未有効なら 1 行だけナッジする', () => {
  const ctx = scratch();
  const claudeConfig = mkdtempSync(path.join(tmpdir(), 'akari-claude-config-test-'));
  try {
    writeKitsLedger(ctx.home, { id: 'sample', version: 1, installedAt: 'now', kitDir: '/fixture', skills: [], assets: [] });
    mkdirSync(claudeConfig, { recursive: true });
    writeFileSync(path.join(claudeConfig, 'settings.json'), JSON.stringify({ enabledPlugins: {} }));
    const script = path.join(REPO_ROOT, 'plugin', 'hooks', 'scripts', 'session-start.mjs');
    const result = spawnSync(process.execPath, [script], {
      cwd: ctx.home,
      input: '{}', encoding: 'utf8',
      env: { ...process.env, AKARI_HOME: ctx.home, CLAUDE_CONFIG_DIR: claudeConfig }
    });
    assert.equal(result.status, 0, result.stderr);
    const line = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.equal(line.split('\n').length, 1);
    assert.match(line, /akari-kits@akari-kits/u);
  } finally {
    ctx.cleanup();
    rmSync(claudeConfig, { recursive: true, force: true });
  }
});
