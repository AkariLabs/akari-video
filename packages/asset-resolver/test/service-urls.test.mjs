import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  DEFAULT_ASSETS_BASE_URL, DEFAULT_CATALOG_URL, DEFAULT_STORE_API,
  DEFAULT_STORE_BASE_URL, DEFAULT_STORE_LAB_BASE_URL, LEGACY_AKARI_HOST,
  deriveStoreLabBaseUrl, normalizeAkariUrl,
} from '../src/service-urls.mjs';
import { resolveCatalogSource, resolveDownloadUrl, resolveEffectiveBase, resolveEntitlementsUrl } from '../src/env.mjs';
import { fetchEntitlements } from '../src/entitlements.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

test('tracked sources and documentation cannot reintroduce the retired domain', () => {
  const allowed = new Set([
    'packages/akari-launcher/src/service-urls.cjs',
    'packages/asset-resolver/test/service-urls.test.mjs',
  ]);
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);
  const targets = files.filter(file => {
    // Evidence and changelogs record historical observations, not current defaults.
    if (/(^|\/)evidence\//.test(file) || /(^|\/)CHANGELOG[^/]*$/i.test(file)) return false;
    return /^(apps|packages)\/.*\/(src|bin|test)\//.test(file)
      || /^(docs|skills)\//.test(file) || /(^|\/)README[^/]*$/i.test(file)
      || /(^|\/)package\.json$/.test(file);
  });
  assert.ok(targets.includes('packages/asset-resolver/src/env.mjs'));
  assert.ok(targets.includes('apps/shell/extensions/akari-surfaces/src/browser/akari-settings-dialog.ts'));
  const violations = targets.filter(file => !allowed.has(file) && readFileSync(path.join(repo, file), 'utf8').includes('akari-oss'));
  assert.deepEqual(violations, [], 'Use the shared service URLs; only the legacy constant and this test may mention the retired domain');
});

test('all official defaults use the current origin', () => {
  assert.equal(LEGACY_AKARI_HOST, 'akari-oss.app');
  assert.equal(DEFAULT_STORE_API, 'https://akari.video');
  assert.equal(DEFAULT_STORE_BASE_URL, 'https://akari.video/api/store');
  assert.equal(DEFAULT_STORE_LAB_BASE_URL, 'https://akari.video/lab');
  assert.equal(DEFAULT_ASSETS_BASE_URL, 'https://akari.video/assets/');
  assert.equal(DEFAULT_CATALOG_URL, 'https://akari.video/assets/catalog.json');
  assert.equal(resolveEntitlementsUrl({}), 'https://akari.video/api/store/v1/entitlements');
  assert.equal(resolveCatalogSource({}).value, DEFAULT_CATALOG_URL);
});

for (const [input, expected] of [
  [`https://${LEGACY_AKARI_HOST}/api/store`, 'https://akari.video/api/store'],
  [`http://${LEGACY_AKARI_HOST}/assets/a?x=1#preview`, 'https://akari.video/assets/a?x=1#preview'],
  [`https://${LEGACY_AKARI_HOST.toUpperCase()}/api/store/`, 'https://akari.video/api/store/'],
  ['https://akari.video/api/store', 'https://akari.video/api/store'],
  ['http://localhost:8788/api/store', 'http://localhost:8788/api/store'],
  [`https://${LEGACY_AKARI_HOST}.evil.example/api/store`, `https://${LEGACY_AKARI_HOST}.evil.example/api/store`],
  [`https://evil${LEGACY_AKARI_HOST}/api/store`, `https://evil${LEGACY_AKARI_HOST}/api/store`],
  ['not a URL', 'not a URL'],
  ['/local/assets/', '/local/assets/'],
]) test(`URL normalization: ${input}`, () => assert.equal(normalizeAkariUrl(input), expected));

for (const origin of [`https://${LEGACY_AKARI_HOST}`, 'https://akari.video', 'http://localhost:8788']) {
  const expected = origin.includes(LEGACY_AKARI_HOST) ? 'https://akari.video' : origin;
  test(`configured endpoints and saved credentials: ${origin}`, async t => {
    const home = mkdtempSync(path.join(tmpdir(), 'akari-domain-'));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const credentials = { url: `${origin}/api/store/`, token: 'fixture-token' };
    writeFileSync(path.join(home, 'store-credentials.json'), JSON.stringify(credentials));
    const calls = [];
    const result = await fetchEntitlements({ env: { AKARI_HOME: home }, fetchImpl: async url => {
      calls.push(url);
      return new Response(JSON.stringify({ entitlements: [{ product_id: 'example' }] }));
    } });
    assert.equal(result.status, 'ok');
    assert.deepEqual([...result.ids], ['example']);
    assert.deepEqual(calls, [`${expected}/api/store/v1/entitlements`]);
    assert.equal(resolveEntitlementsUrl({ AKARI_STORE_API: `${origin}/` }, credentials), `${expected}/api/store/v1/entitlements`);
    assert.equal(resolveDownloadUrl({}, credentials, 'a b'), `${expected}/api/store/v1/download/a%20b`);
    assert.equal(resolveDownloadUrl({ AKARI_STORE_API: origin }, credentials, 'a b'), `${expected}/api/store/v1/download/a%20b`);
    assert.equal(resolveCatalogSource({ AKARI_ASSETS_CATALOG: `${origin}/assets/catalog.json` }).value, `${expected}/assets/catalog.json`);
    assert.equal(resolveEffectiveBase({}, { base: `${origin}/assets/` }), `${expected}/assets/`);
    assert.equal(resolveEffectiveBase({ AKARI_ASSETS_BASE: `${origin}/assets/` }), `${expected}/assets/`);
    assert.equal(deriveStoreLabBaseUrl(credentials.url), `${expected}/lab`);
  });
}

for (const [layout, resolverPath, launcherPath] of [
  ['npm vendor', 'vendor/packages/asset-resolver/src', 'src'],
  ['Electron resources', 'packages/asset-resolver/src', 'packages/akari-launcher/src'],
]) test(`${layout}: resolver loads the canonical module from the installed launcher`, async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'akari-domain-vendor-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const resolverSrc = path.join(root, resolverPath);
  const launcherSrc = path.join(root, launcherPath);
  mkdirSync(resolverSrc, { recursive: true });
  mkdirSync(launcherSrc, { recursive: true });
  cpSync(path.join(repo, 'packages/akari-launcher/src/service-urls.cjs'), path.join(launcherSrc, 'service-urls.cjs'));
  for (const file of ['service-urls.mjs', 'env.mjs']) cpSync(new URL(`../src/${file}`, import.meta.url), path.join(resolverSrc, file));
  const installed = await import(pathToFileURL(path.join(resolverSrc, 'env.mjs')));
  assert.equal(installed.resolveEntitlementsUrl({}, { url: `https://${LEGACY_AKARI_HOST}/api/store` }), 'https://akari.video/api/store/v1/entitlements');
  assert.equal(installed.resolveCatalogSource({}).value, DEFAULT_CATALOG_URL);
});
