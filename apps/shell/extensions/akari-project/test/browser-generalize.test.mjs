import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { siteUrlAllowed, siteDownloadChainAllowed } = require('../lib/common/asset-sites.js');
const { navigationAllowed, downloadChainAllowed } = require('../lib/common/site-navigation-policy.js');
const { buildSearchUrl, cleanSearchQuery, validateEngine, validateBrowserConfig, validUserEngines,
  BROWSER_COMMAND_IDS, validateBrowserArgs } = require('../lib/common/browser-engines.js');
const { cssRectToViewBounds } = require('../lib/common/browser-zoom.js');
const { HOST_OVERLAY_SELECTORS, shouldHide } = require('../lib/common/browser-host-guard.js');

const allowlist = { hosts: ['example.com', '*.booth.pm'], download_hosts: ['cdn.example.net'] };
const open = { navigation: 'open', downloads: 'deny', hosts: [], download_hosts: [] };

test('allowlist は既存の判定に委譲し、省略と未知の方針も閉じる', () => {
  for (const url of ['https://example.com/', 'https://shop.booth.pm/', 'https://booth.pm/',
    'https://example.com.evil.test/', 'file:///tmp/a', 'http://127.0.0.1/']) {
    assert.equal(navigationAllowed(url, allowlist), siteUrlAllowed(url, allowlist.hosts), url);
    assert.equal(navigationAllowed(url, { ...allowlist, navigation: 'unknown' }), siteUrlAllowed(url, allowlist.hosts), url);
  }
  const chain = ['https://example.com/a', 'https://cdn.example.net/b'];
  assert.equal(downloadChainAllowed(chain, allowlist), siteDownloadChainAllowed(chain, allowlist));
});

test('開いたウェブは安全な https だけを許す', () => {
  for (const url of ['https://www.google.com/search', 'https://例え.テスト/']) assert.equal(navigationAllowed(url, open), true, url);
  for (const url of ['http://www.google.com/', 'javascript:alert(1)', 'data:text/html,hi', 'file:///tmp/a',
    'blob:https://www.google.com/a', 'about:srcdoc', 'https://u:p@www.google.com/',
    'https://localhost/', 'https://foo.localhost/', 'https://foo.local/', 'https://foo.internal/',
    'https://127.0.0.1/', 'https://10.0.0.1/', 'https://172.16.0.1/', 'https://192.168.1.1/',
    'https://169.254.169.254/', 'https://[::1]/', 'https://[fc00::1]/', 'https://0.0.0.0/'])
    assert.equal(navigationAllowed(url, open), false, url);
  assert.equal(navigationAllowed('http://127.0.0.1:3000/', open, true), true);
  assert.equal(navigationAllowed('about:blank', open), true);
  assert.equal(navigationAllowed('http://localhost:3000/', open, true), false);
  assert.equal(downloadChainAllowed(['https://www.google.com/a'], open), false);
});

const engine = { id: 'google-images', label: 'Google 画像', template: 'https://www.google.com/search?q={q}' };
test('検索語の除去・切り詰め・URL 符号化', () => {
  const query = ' 日本語 & # % + 😀 ';
  assert.equal(buildSearchUrl(engine, query).url, `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`);
  assert.equal(cleanSearchQuery('a\u200b\u202eb\u0000c'), 'abc');
  assert.equal(cleanSearchQuery('a'.repeat(600)).length, 512);
  assert.equal(buildSearchUrl(engine, ' \u200b ').code, 'empty-query');
  assert.equal(buildSearchUrl({ ...engine, template: 'https://127.0.0.1/?q={q}' }, 'x').code, 'invalid-url');
});

test('検索サイトの設定は不正項目を除き、組み込み id を上書きしない', () => {
  assert.equal(validateEngine(engine), true);
  for (const template of ['http://www.google.com/?q={q}', 'https://www.google.com/?q=x',
    'https://www.google.com/?q={q}&x={q}', 'https://u:p@www.google.com/?q={q}',
    'https://127.0.0.1/?q={q}']) assert.equal(validateEngine({ ...engine, template }), false, template);
  const config = JSON.parse(readFileSync(new URL('../../../../../catalog/browser/browser-engines.json', import.meta.url), 'utf8'));
  assert.equal(validateBrowserConfig(config), true);
  assert.equal(validateBrowserConfig(undefined), false, '設定ファイルを読めない場合は無効');
  assert.equal(validateBrowserConfig({ ...config, unexpected: true }), false);
  assert.equal(validateBrowserConfig({ ...config, engines: [...config.engines, config.engines[0]] }), false);
  assert.equal(validateBrowserConfig({ ...config, engines: Array(25).fill(engine) }), false);
  const user = validUserEngines([engine, { id: 'other', label: '別', template: 'https://example.com/?q={q}' },
    { id: 'bad', label: '悪', template: 'http://localhost/?q={q}' }], [engine]);
  assert.deepEqual(user.engines.map(item => item.id), ['other']);
  assert.deepEqual(user.invalidIds, ['bad']);
});

test('ズーム換算は固定値で切り下げ、異常値を閉じる', () => {
  const rect = { x: 222, y: 86, width: 390, height: 556 };
  for (const [zoom, expected] of [
    [1, [222, 86, 390, 556]], [1.095, [243, 94, 427, 608]],
    [1.2, [266, 103, 468, 667]], [0.913, [202, 78, 356, 507]],
    [0, [222, 86, 390, 556]], [NaN, [222, 86, 390, 556]], [-1, [222, 86, 390, 556]],
    [1000, [222, 86, 390, 556]]
  ]) assert.deepEqual(Object.values(cssRectToViewBounds(rect, zoom)), expected);
  assert.deepEqual(Object.values(cssRectToViewBounds({ x: -1, y: Infinity, width: -2, height: NaN }, 1)), [0, 0, 0, 0]);
});

test('重なりガードは対象の表示矩形だけで決める', () => {
  for (const selector of ['.quick-input-widget', '.dialogOverlay', '.theia-dialog-shell',
    '.theia-notification-list-item', '.lm-DockPanel-overlay', '.lm-Menu']) {
    assert.equal(HOST_OVERLAY_SELECTORS.includes(selector), true, selector);
    assert.equal(shouldHide([{ selector, display: 'block', rect: { w: 10, h: 10 } }]), true, selector);
    assert.equal(shouldHide([{ selector, display: 'none', rect: { w: 10, h: 10 } }]), false, selector);
    assert.equal(shouldHide([{ selector, display: 'block', rect: { w: 0, h: 10 } }]), false, selector);
  }
  assert.equal(shouldHide([]), false);
  assert.equal(shouldHide([{ selector: '.lm-DockPanel-overlay', display: 'flex', rect: { w: 10, h: 10 } }]), false);
});

test('Jev のコマンド表と登録 id は一致し、open は許可表にない', () => {
  const data = JSON.parse(readFileSync(new URL('../../../../../packages/akari-vibe/src/jev/jev-actions.json', import.meta.url), 'utf8'));
  const actions = Array.isArray(data) ? data : Object.values(data).flatMap(value => Array.isArray(value) ? value : []);
  for (const name of ['search', 'pickMode', 'close']) {
    const action = actions.find(row => row?.id === `browser.${name}`);
    assert.ok(action, name);
    assert.deepEqual(action.commands.map(row => row.commandId), [BROWSER_COMMAND_IDS[name]]);
  }
  assert.deepEqual(actions.find(row => row?.id === 'browser.open')?.commands, []);
  const source = readFileSync(new URL('../src/browser/browser-commands.ts', import.meta.url), 'utf8');
  for (const name of ['search', 'pickMode', 'close', 'open']) assert.match(source, new RegExp(`BROWSER_COMMAND_IDS\\.${name}`));
  assert.equal(validateBrowserArgs(BROWSER_COMMAND_IDS.search, { engine: 'google-images', query: 'x' }).ok, true);
  assert.equal(validateBrowserArgs(BROWSER_COMMAND_IDS.search, { engine: '?', query: 'x' }).code, 'bad-args');
  assert.equal(validateBrowserArgs(BROWSER_COMMAND_IDS.search, { engine: 'x', query: 'y', extra: 1 }).code, 'bad-args');
  assert.equal(validateBrowserArgs(BROWSER_COMMAND_IDS.pickMode, { on: 'yes' }).code, 'bad-args');
});
