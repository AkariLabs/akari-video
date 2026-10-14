import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { setLanguage } from '../../i18n/index.mjs';
import { cliText } from '../src/i18n.mjs';

const entry = fileURLToPath(new URL('../bin/akari.mjs', import.meta.url));
const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

test('English launcher help, diagnosis, version, and delegated help contain no Japanese', () => {
  for (const args of [
    ['--help'], ['--version'], ['doctor'], ['new', '--help'],
    ['narration', 'engines'], ['narration', '--help'], ['captions', '--help'], ['media', '--help'],
    ['clean', '--help'], ['storyboard', '--help'],
  ]) {
    const result = spawnSync(process.execPath, [entry, ...args], {
      encoding: 'utf8', env: { ...process.env, AKARI_LANG: 'en' }, timeout: 30_000,
    });
    if (args[0] === 'doctor') {
      assert.match(result.stdout, /^Verdict: (?:ok|degraded|broken)$/mu);
      assert.equal(result.status, /^Verdict: broken$/mu.test(result.stdout) ? 1 : 0, `doctor: ${result.stderr}`);
    } else {
      assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    }
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, japanese, args.join(' '));
  }
});

test('English media argument error is readable', () => {
  const result = spawnSync(process.execPath, [entry, 'media', 'transcribe'], {
    encoding: 'utf8', env: { ...process.env, AKARI_LANG: 'en' }, timeout: 30_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /transcribe: target is required/u);
});

test('content --lang does not change the Japanese UI language', () => {
  for (const [args, expected] of [
    [['new', '--help', '--lang', 'en'], /^使い方: akari new/u],
    [['media', '--help', '--lang', 'en'], /^使い方: akari media/u],
    [['narration', '--help', '--lang', 'en'], /^使い方: akari narration/u],
  ]) {
    const result = spawnSync(process.execPath, [entry, ...args], {
      encoding: 'utf8', env: { ...process.env, AKARI_LANG: 'ja' }, timeout: 30_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, expected, args.join(' '));
  }
});

test('content --lang keeps Japanese argument errors', () => {
  for (const [args, expected] of [
    [['new', 'project', '--lang', 'en', '--template'], /--template にはパスが必要です/u],
    [['narration', 'generate', '--lang', 'en'], /--project が必要です/u],
  ]) {
    const result = spawnSync(process.execPath, [entry, ...args], {
      encoding: 'utf8', env: { ...process.env, AKARI_LANG: 'ja' }, timeout: 30_000,
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, expected);
  }
});

test('CLI count labels use singular and plural English, with unchanged Japanese wording', () => {
  setLanguage('en');
  try {
    assert.equal(cliText('cli.new.result.copied', { count: 1, n: 1 }), 'Copied: 1 file');
    assert.equal(cliText('cli.new.result.copied', { count: 2, n: 2 }), 'Copied: 2 files');
    setLanguage('ja');
    assert.equal(cliText('cli.new.result.copied', { count: 1, n: 1 }), 'コピー: 1 件');
    assert.equal(cliText('cli.new.result.copied', { count: 2, n: 2 }), 'コピー: 2 件');
  } finally { setLanguage(undefined); }
});
