import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const packageRoot = dirname(fileURLToPath(new URL('../index.cjs', import.meta.url)));
const generator = fileURLToPath(new URL('../../../scripts/gen-i18n-catalog.mjs', import.meta.url));

function temporaryPackage(t) {
  const root = mkdtempSync(join(tmpdir(), 'akari-i18n-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const locales = join(root, 'locales');
  for (const language of ['ja', 'en']) mkdirSync(join(locales, language), { recursive: true });
  copyFileSync(join(packageRoot, 'index.cjs'), join(root, 'index.cjs'));
  return { root, locales };
}

function generate(locales, ...options) {
  return spawnSync(process.execPath, [generator, '--root', locales, ...options], { encoding: 'utf8' });
}

test('generator loads a new namespace through t() in filename order', t => {
  const { root, locales } = temporaryPackage(t);
  for (const language of ['ja', 'en']) {
    writeFileSync(join(locales, language, 'zeta.json'), JSON.stringify({ 'fixture.shared': 'overridden', 'fixture.zeta': `${language} zeta` }));
    writeFileSync(join(locales, language, 'alpha.json'), JSON.stringify({ 'fixture.shared': 'first', 'fixture.alpha': `${language} alpha` }));
  }
  assert.equal(generate(locales).status, 0);
  const source = readFileSync(join(locales, 'index.cjs'), 'utf8');
  assert.match(source.split('\n')[0], /生成物・手で編集しない/);
  assert.ok(source.indexOf('ja/alpha.json') < source.indexOf('ja/zeta.json'));
  assert.ok(source.indexOf('ja/zeta.json') < source.indexOf('en/alpha.json'));
  assert.match(source, /require\("\.\/ja\/alpha\.json"\)/);
  const { t: translate } = require(join(root, 'index.cjs'));
  for (const language of ['ja', 'en']) {
    assert.equal(translate('fixture.alpha', {}, language), `${language} alpha`);
    assert.equal(translate('fixture.zeta', {}, language), `${language} zeta`);
    assert.equal(translate('fixture.shared', {}, language), 'overridden');
  }
});

test('--check fails when a namespace is added and passes after regeneration', t => {
  const { locales } = temporaryPackage(t);
  for (const language of ['ja', 'en']) writeFileSync(join(locales, language, 'common.json'), JSON.stringify({ 'fixture.common': language }));
  assert.equal(generate(locales).status, 0);
  assert.equal(generate(locales, '--check').status, 0);
  writeFileSync(join(locales, 'ja', 'added.json'), JSON.stringify({ 'fixture.added': '追加' }));
  const stale = generate(locales, '--check');
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /out of date/);
  assert.equal(generate(locales).status, 0);
  assert.equal(generate(locales, '--check').status, 0);
});

test('every current namespace key resolves to its translation in both languages', () => {
  const { t: translate } = require(join(packageRoot, 'index.cjs'));
  for (const language of ['ja', 'en']) {
    const filenames = readdirSync(join(packageRoot, 'locales', language))
      .filter(name => name.endsWith('.json'))
      .sort();
    const expected = {};
    for (const filename of filenames) {
      const catalog = require(join(packageRoot, 'locales', language, filename));
      assert.ok(Object.keys(catalog).length > 0, `${language}/${filename} is empty`);
      Object.assign(expected, catalog);
    }
    for (const [key, value] of Object.entries(expected)) {
      const actual = translate(key, {}, language);
      assert.equal(actual, value, `${language}: ${key}`);
      assert.notEqual(actual, key, `${language}: ${key} was returned untranslated`);
    }
  }
});
