import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rewriteAppUpdateFeed } from '../rewrite-app-update-feed.mjs';

const source = [
  'version: 0.1.94',
  'files:',
  '  - url: shell-win-setup.exe',
  '    sha512: abc=',
  '    size: 123',
  'path: shell-win-setup.exe',
  'sha512: abc=',
  "releaseDate: '2026-09-27T07:29:14.025Z'",
  ''
].join('\n');

test('本体 URL と path だけを対象タグの絶対 URL にし、hash・size・日時を保つ', () => {
  const actual = rewriteAppUpdateFeed(source, 'v0.1.94');
  const url = 'https://github.com/AkariLabs/akari-video/releases/download/v0.1.94/shell-win-setup.exe';
  assert.equal(actual, source.replaceAll('shell-win-setup.exe', `'${url}'`));
  assert.equal(actual.includes('updates/shell-win-setup.exe'), false);
  assert.equal(`${url}.blockmap`, 'https://github.com/AkariLabs/akari-video/releases/download/v0.1.94/shell-win-setup.exe.blockmap');
});

test('Mac の zip と複数 file を変換し、path が files に無ければ拒否する', () => {
  const mac = source.replaceAll('shell-win-setup.exe', 'shell-mac.zip');
  assert.match(rewriteAppUpdateFeed(mac, 'v0.1.94'), /v0\.1\.94\/shell-mac\.zip/);
  assert.throws(() => rewriteAppUpdateFeed(source.replace('path: shell-win-setup.exe', 'path: other.exe'), 'v0.1.94'));
});

test('対象タグとの版ずれや相対ディレクトリを拒否する', () => {
  assert.throws(() => rewriteAppUpdateFeed(source, 'v0.1.95'));
  assert.throws(() => rewriteAppUpdateFeed(source.replaceAll('shell-win-setup.exe', '../other.exe'), 'v0.1.94'));
});
