import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const cli = new URL('../bin/validate-asset.mjs', import.meta.url);
const declaration = (value) => `<script type="application/json" data-akari-glass-scene>${JSON.stringify(value)}</script>`;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'akari-glass-asset-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'overlay/lower-third-clean');
  cpSync(new URL('./fixtures/asset/valid-library/overlay/lower-third-clean', import.meta.url), dir, { recursive: true });
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json')));
  meta.requires = ['glass-runtime'];
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
  for (const sub of ['variants', 'runtime', 'backgrounds']) mkdirSync(join(dir, sub));
  writeFileSync(join(dir, 'backgrounds/bg.png'), 'image');
  writeFileSync(join(dir, 'sample-press.mp4'), 'sample');
  cpSync(new URL('../../overlay-runtime/src/glass-runtime.js', import.meta.url), join(dir, 'runtime/glass-runtime.js'));
  writeFileSync(join(dir, 'fragment.html'), `<div data-akari-glass>${declaration({ backdrop: 'backgrounds/bg.png' })}</div>`);
  writeFileSync(join(dir, 'variants/press.html'), `<div data-akari-glass>${declaration({ backdrop: '../backgrounds/bg.png' })}</div>`);
  return dir;
}
const run = (dir) => spawnSync(process.execPath, [cli.pathname, dir], { encoding: 'utf8' });

test('glass pack variants, runtime, backgrounds and sample mp4 pass', (t) => {
  const result = run(fixture(t));
  assert.equal(result.status, 0, result.stderr);
});

test('glass declaration validation rejects malformed JSON, missing surfaces and bad references', (t) => {
  const dir = fixture(t);
  for (const [html, error] of [
    [declaration({}), /ガラス面が無い/],
    ['<div data-akari-glass>' + declaration([]) + '</div>', /JSON object/],
    ...['https://example.com/bg.png', 'data:image/png;base64,AA==', 'missing.png', '/tmp/bg.png', '../outside.png', 42].map((backdrop) => [`<div data-akari-glass>${declaration({ backdrop })}</div>`, /相対パス|見つかりません|ディレクトリ外/]),
    ['<div data-akari-glass><script type="application/json" data-akari-glass-scene>{</script></div>', /JSON を読めません/],
  ]) {
    writeFileSync(join(dir, 'variants/press.html'), html);
    const result = run(dir);
    assert.equal(result.status, 1, html);
    assert.match(result.stderr, error);
  }
  writeFileSync(join(dir, 'variants/press.html'), `<div data-akari-glass>${declaration({})}</div>`);
  assert.equal(run(dir).status, 0, 'backdrop is optional');
});

test('quoted JS asset loaders still detect missing pack assets', (t) => {
  const dir = fixture(t);
  writeFileSync(join(dir, 'runtime/missing.js'), 'const image = new URL("missing.png", document.baseURI);');
  assert.match(run(dir).stderr, /missing.png/);
  writeFileSync(join(dir, 'runtime/missing.js'), 'const css = `background: url(missing-style.png)`;');
  assert.match(run(dir).stderr, /missing-style.png/);
});
