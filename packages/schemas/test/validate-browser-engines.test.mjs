import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateBrowserEngines } from '../bin/validate-browser-engines.mjs';

const schema = JSON.parse(fs.readFileSync(new URL('../browser-engines.schema.json', import.meta.url), 'utf8'));
const config = JSON.parse(fs.readFileSync(new URL('../../../catalog/browser/browser-engines.json', import.meta.url), 'utf8'));

test('組み込み検索サイト設定の schema と URL 規則', () => {
  assert.deepEqual(validateBrowserEngines(config, schema), []);
  const changed = engine => ({ ...config, engines: [{ ...config.engines[0], ...engine }] });
  for (const template of ['http://example.com/?q={q}', 'https://example.com/?q=x',
    'https://example.com/?q={q}&x={q}', 'https://u:p@example.com/?q={q}',
    'https://localhost/?q={q}', 'https://169.254.169.254/?q={q}', 'https://[::ffff:127.0.0.1]/?q={q}'])
    assert.notDeepEqual(validateBrowserEngines(changed({ template }), schema), [], template);
  assert.notDeepEqual(validateBrowserEngines({ ...config, engines: [...config.engines, config.engines[0]] }, schema), []);
  assert.notDeepEqual(validateBrowserEngines({ ...config, engines: Array(25).fill(config.engines[0]) }, schema), []);
});
