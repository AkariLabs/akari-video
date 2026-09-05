import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { __testing } from '../src/server.mjs';

const { hasMoovBox, usableProxy, MAX_PROXY_BOX_SCAN } = __testing;

function box(type, payload = Buffer.alloc(0), sizeMode = 'normal') {
  const header = Buffer.alloc(sizeMode === 'large' ? 16 : 8);
  const size = header.length + payload.length;
  header.writeUInt32BE(sizeMode === 'large' ? 1 : sizeMode === 'to-end' ? 0 : size, 0);
  header.write(type, 4, 4, 'latin1');
  if (sizeMode === 'large') header.writeBigUInt64BE(BigInt(size), 8);
  return Buffer.concat([header, payload]);
}

function normalProxy() {
  return Buffer.concat([box('ftyp'), box('moov'), box('mdat', Buffer.alloc(32))]);
}

function brokenProxy() {
  return Buffer.concat([box('ftyp'), box('free'), box('mdat', Buffer.alloc(32), 'to-end')]);
}

function moovAt(position) {
  return Buffer.concat([
    ...Array.from({ length: position - 1 }, () => box('free')),
    box('moov'),
  ]);
}

function withFixture(bytes, run) {
  const directory = mkdtempSync(path.join(tmpdir(), 'akari-moov-'));
  try {
    const proxyPath = path.join(directory, 'proxy.mp4');
    if (bytes !== null) writeFileSync(proxyPath, bytes);
    run(proxyPath, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const moovCases = [
  ['正常な ftyp + moov + mdat', normalProxy(), true],
  ['ftyp + free + サイズ 0 の mdat の残骸', brokenProxy(), false],
  ['大きめの mdat の後ろにある moov', Buffer.concat([
    box('ftyp'), box('mdat', Buffer.alloc(128 * 1024)), box('moov'),
  ]), true],
  ['largesize の mdat の後ろにある moov', Buffer.concat([
    box('ftyp'), box('mdat', Buffer.alloc(32), 'large'), box('moov'),
  ]), true],
  ['空ファイル', Buffer.alloc(0), false],
  ['8 バイト未満のファイル', Buffer.alloc(7), false],
  ['存在しないパス', null, false],
  ['走査上限ちょうどの位置にある moov', moovAt(MAX_PROXY_BOX_SCAN), true],
  ['走査上限を 1 個超えた位置にある moov', moovAt(MAX_PROXY_BOX_SCAN + 1), false],
];

for (const [name, bytes, expected] of moovCases) {
  test(`hasMoovBox: ${name}`, () => {
    withFixture(bytes, proxyPath => {
      assert.equal(hasMoovBox(proxyPath), expected);
    });
  });
}

test('usableProxy: moov の無い残骸を拒否して削除する', t => {
  t.mock.method(console, 'warn', () => {});
  withFixture(brokenProxy(), (proxyPath, directory) => {
    assert.equal(existsSync(proxyPath), true);
    assert.equal(usableProxy(path.join(directory, 'source.mp4'), proxyPath), false);
    assert.equal(existsSync(proxyPath), false);
  });
});

test('usableProxy: 正常な proxy を受け入れて保持する', () => {
  withFixture(normalProxy(), (proxyPath, directory) => {
    assert.equal(usableProxy(path.join(directory, 'source.mp4'), proxyPath), true);
    assert.equal(existsSync(proxyPath), true);
  });
});
