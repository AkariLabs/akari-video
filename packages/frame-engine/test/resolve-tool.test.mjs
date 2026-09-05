import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { resolveTool } from './helpers/resolve-tool.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'akari-resolve-tool-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = path.join(root, 'first bin');
  const second = path.join(root, 'second');
  mkdirSync(first);
  mkdirSync(second);
  const touch = (directory, name) => {
    const file = path.join(directory, name);
    writeFileSync(file, '');
    return file;
  };
  const exists = file => !file.startsWith('/opt/homebrew/bin/') && existsSync(file);
  return { first, second, touch, exists };
}

test('environment override takes precedence without probing other locations', t => {
  const { first, touch } = fixture(t);
  const override = touch(first, 'custom-ffmpeg');
  assert.equal(resolveTool('ffmpeg', {
    env: { AKARI_TOOL_FFMPEG: override },
    exists: () => assert.fail('override must short-circuit filesystem lookup'),
  }), override);
});

test('Homebrew takes precedence over PATH', t => {
  const { first, touch } = fixture(t);
  const homebrewFixture = touch(first, 'homebrew-ffmpeg');
  touch(first, 'ffmpeg');
  assert.equal(resolveTool('ffmpeg', {
    env: { PATH: first },
    exists: file => file === '/opt/homebrew/bin/ffmpeg' ? existsSync(homebrewFixture) : existsSync(file),
  }), '/opt/homebrew/bin/ffmpeg');
});

test('POSIX PATH searches directories in order', t => {
  const { first, second, touch, exists } = fixture(t);
  // Relative paths avoid drive-letter colons when injecting POSIX on Windows.
  const a = path.relative(process.cwd(), first);
  const b = path.relative(process.cwd(), second);
  touch(second, 'ffmpeg');
  const options = { platform: 'linux', env: { PATH: `${a}:${b}` }, exists };
  assert.equal(resolveTool('ffmpeg', options), path.join(b, 'ffmpeg'));
  touch(first, 'ffmpeg');
  assert.equal(resolveTool('ffmpeg', options), path.join(a, 'ffmpeg'));
});

test('injected win32 honors PATHEXT and PATH order', t => {
  const { first, second, touch, exists } = fixture(t);
  const expected = touch(first, 'ffmpeg.CUSTOM');
  touch(second, 'ffmpeg.EXE');
  assert.equal(resolveTool('ffmpeg', {
    platform: 'win32', env: { PATH: `"${first}";${second}`, PATHEXT: '.CUSTOM;.EXE' }, exists,
  }), expected);
});

test('injected win32 defaults to EXE, CMD, BAT and supports extensionless files', t => {
  const { first, touch, exists } = fixture(t);
  for (const extension of ['.EXE', '.CMD', '.BAT', '']) {
    const expected = touch(first, `tool${extension}`);
    assert.equal(resolveTool('tool', { platform: 'win32', env: { PATH: first }, exists }), expected);
    rmSync(expected);
  }
});

test('missing tool explains PATH and the named override', t => {
  const { first, exists } = fixture(t);
  assert.throws(() => resolveTool('ffmpeg', { env: { PATH: first }, exists }), {
    message: 'ffmpeg が見つかりません（PATH または AKARI_TOOL_FFMPEG を設定してください）',
  });
});

test('CommonJS can require the synchronous ESM helper', () => {
  assert.equal(createRequire(import.meta.url)('./helpers/resolve-tool.mjs').resolveTool, resolveTool);
});
