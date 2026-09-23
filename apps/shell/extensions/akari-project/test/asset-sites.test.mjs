import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { siteUrlAllowed, siteDownloadAllowed, siteDownloadChainAllowed, highlightCandidateIndex, READ_HIGHLIGHT_CANDIDATES_SCRIPT,
  markHighlightScript, siteImportMetadata } = require('../lib/common/asset-sites.js');
const { extractSiteZip, SITE_ZIP_MAX_BYTES } = require('../lib/electron-main/site-download.js');
const { composeSiteAgentPrompt } = require('../lib/common/asset-site-prompt.js');

test('navigation and download host matching rejects lookalikes and unsafe schemes', () => {
  const hosts = ['example.com', '*.booth.pm'];
  assert.equal(siteUrlAllowed('https://example.com/path', hosts), true);
  assert.equal(siteUrlAllowed('https://shop.booth.pm/item', hosts), true);
  for (const url of ['https://example.com.evil.test/', 'https://booth.pm/', 'https://evil-example.com/',
    'javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'http://example.com/',
    'https://user:pass@example.com/']) assert.equal(siteUrlAllowed(url, hosts), false, url);
  assert.equal(siteUrlAllowed('http://127.0.0.1:4321/', ['127.0.0.1'], true), true);
  assert.equal(siteUrlAllowed('http://127.0.0.1:4321/item', ['127.0.0.1'], true), true);
  assert.equal(siteUrlAllowed('http://127.0.0.1:4321/', ['127.0.0.1']), false);
  const downloadSite = { hosts: ['example.com'], download_hosts: ['cdn.example.net'] };
  assert.equal(siteDownloadAllowed('https://cdn.example.net/a.zip', downloadSite), true);
  assert.equal(siteDownloadAllowed('https://cdn.example.net.evil.test/a.zip', downloadSite), false);
  assert.equal(siteDownloadChainAllowed(['https://example.com/start', 'https://cdn.example.net/a.zip'], downloadSite), true);
  assert.equal(siteDownloadChainAllowed(['https://evil.test/start', 'https://cdn.example.net/a.zip'], downloadSite), false);
  assert.equal(siteDownloadChainAllowed(['https://example.com/start', 'https://evil.test/a.zip'], downloadSite), false);
  assert.equal(siteDownloadChainAllowed([], downloadSite), false);
});

function elements(html) {
  return [...html.matchAll(/<(a|button)\b([^>]*)>(.*?)<\/\1>/gs)].map(match => ({
    href: match[2].match(/href="([^"]*)"/)?.[1] ?? '', text: match[3].replace(/<[^>]+>/g, '').trim()
  }));
}
for (const [file, expected, name] of [
  ['direct.html', 0, 'chime01.mp3'], ['button-text.html', 0, 'chime01.mp3'],
  ['japanese.html', 0, '和音.wav'], ['missing.html', -1, 'chime01.mp3'],
  ['duplicate.html', 0, 'chime01.mp3']
]) test(`highlight fixture ${file}`, async () => {
  const html = await readFile(new URL(`fixtures/asset-sites/${file}`, import.meta.url), 'utf8');
  assert.equal(highlightCandidateIndex(elements(html), [name], []), expected);
});

test('injected scripts only read and mark, never operate the page', () => {
  const source = READ_HIGHLIGHT_CANDIDATES_SCRIPT + markHighlightScript(0);
  for (const banned of ['click(', 'submit(', 'dispatchEvent(']) assert.equal(source.includes(banned), false);
  assert.equal(highlightCandidateIndex([{ href: '', text: 'sample.wav' }], [], ['sample\\.wav']), 0);
});

function zip(name, expanded = 1) {
  const bytes = Buffer.from('a');
  const n = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(n.length, 26);
  local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(expanded, 22);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(expanded, 24);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + n.length, 12); end.writeUInt32LE(local.length + n.length + bytes.length, 16);
  return Buffer.concat([local, n, bytes, central, n, end]);
}
test('zip extraction checks total size and path escape', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'akari-site-zip-test-'));
  try {
    const file = join(dir, 'test.zip'), output = join(dir, 'out');
    await writeFile(file, zip('sound.wav'));
    assert.deepEqual((await extractSiteZip(file, output)).map(v => v.endsWith('sound.wav')), [true]);
    await writeFile(file, zip('../escape.wav'));
    await assert.rejects(() => extractSiteZip(file, output), /パス/);
    await writeFile(file, zip('large.wav', SITE_ZIP_MAX_BYTES + 1));
    await assert.rejects(() => extractSiteZip(file, output), /上限/);
    const tooMany = zip('sound.wav'); tooMany.writeUInt16LE(501, tooMany.length - 12);
    await writeFile(file, tooMany);
    await assert.rejects(() => extractSiteZip(file, output), /件数/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('site import carries provenance, credit and subscription', () => {
  const site = { id: 'sample', price: 'subscription', terms: { summary_ja: '条件' },
    attribution: { required: true, text: 'Sample' } };
  assert.deepEqual(siteImportMetadata(site, 'https://example.com/item'), {
    origin: 'site', site: 'sample', sourceUrl: 'https://example.com/item', licenseAtSource: '条件',
    subscription: true, credit: 'Sample'
  });
});

test('agent packet stops at opening and highlighting', () => {
  const prompt = composeSiteAgentPrompt({ id: 'sample', tab: 'audio', name: 'Sample', entry_url: 'https://example.com/' }, '明るい音');
  assert.match(prompt, /AKARI Lab と手持ち/);
  assert.match(prompt, /ダウンロードは利用者が押す/);
  assert.doesNotMatch(prompt, /取得し、ライセンス表記を確認/);
});
