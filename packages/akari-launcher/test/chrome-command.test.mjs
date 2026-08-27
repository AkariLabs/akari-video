import assert from 'node:assert/strict';
import test from 'node:test';

import { run } from '../src/cli.mjs';
import { runChromeCommand } from '../src/chrome-command.mjs';

function output() {
  const lines = [];
  const errors = [];
  return { log: line => lines.push(line), error: line => errors.push(line), lines, errors };
}

function browsersMock(overrides = {}) {
  return {
    detectBrowserPlatform: () => 'mac_arm',
    resolveBuildId: async () => 'stable-build',
    install: async () => ({ executablePath: '/cache/chrome' }),
    ...overrides,
  };
}

test('chrome install は cache-dir と build-id をプログラム API へ渡す', async () => {
  const calls = [];
  const io = output();
  const result = await runChromeCommand([
    'install', '--cache-dir', '/scratch/chrome-cache', '--build-id', '150.0.1'
  ], {
    ...io,
    loadBrowsers: async () => browsersMock({ install: async options => {
      calls.push(options);
      return { executablePath: '/scratch/chrome-cache/chrome' };
    } }),
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [{
    browser: 'chrome',
    buildId: '150.0.1',
    cacheDir: '/scratch/chrome-cache',
    downloadProgressCallback: 'default',
  }]);
  assert.ok(io.lines.includes('buildId: 150.0.1'));
  assert.ok(io.lines.includes('実行ファイル: /scratch/chrome-cache/chrome'));
});

test('chrome install は build-id 未指定なら stable を解決する', async () => {
  const calls = [];
  const result = await runChromeCommand(['install'], {
    ...output(),
    homeDirectory: '/users/akari',
    loadBrowsers: async () => browsersMock({
      resolveBuildId: async (...args) => {
        calls.push(['resolveBuildId', ...args]);
        return 'resolved-stable';
      },
      install: async options => {
        calls.push(['install', options]);
        return { executablePath: '/users/akari/.cache/puppeteer/chrome' };
      },
    }),
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls[0], ['resolveBuildId', 'chrome', 'mac_arm', 'stable']);
  assert.equal(calls[1][1].buildId, 'resolved-stable');
  assert.equal(calls[1][1].cacheDir, '/users/akari/.cache/puppeteer');
});

test('chrome install は導入失敗を stderr と exit 1 で返す', async () => {
  const io = output();
  const result = await runChromeCommand(['install'], {
    ...io,
    loadBrowsers: async () => browsersMock({ install: async () => { throw new Error('network down'); } }),
  });
  assert.equal(result.exitCode, 1);
  assert.match(io.errors.join('\n'), /Chrome の導入に失敗しました: network down/);
});

test('@puppeteer/browsers 解決失敗は代替経路を stderr へ案内する', async () => {
  const io = output();
  const result = await runChromeCommand(['install'], {
    ...io,
    loadBrowsers: async () => { throw new Error('module missing'); },
  });
  assert.equal(result.exitCode, 1);
  assert.match(io.errors.join('\n'), /@puppeteer\/browsers を読み込めない/);
  assert.match(io.errors.join('\n'), /npx puppeteer browsers install chrome/);
});

test('未知サブコマンドは usage と exit 2、help は usage と exit 0', async () => {
  const unknownOutput = output();
  const unknown = await runChromeCommand(['unknown'], unknownOutput);
  assert.equal(unknown.exitCode, 2);
  assert.match(unknownOutput.errors.join('\n'), /使い方: akari chrome install/);

  const helpOutput = output();
  const help = await runChromeCommand(['--help'], helpOutput);
  assert.equal(help.exitCode, 0);
  assert.match(helpOutput.lines.join('\n'), /--cache-dir/);
});

test('cli の chrome 分岐はプロジェクト処理や Claude 起動より先に実行する', async () => {
  let claudeResolved = false;
  let claudeSpawned = false;
  const result = await run(['chrome', 'install', '--build-id', 'test-build'], {
    ...output(),
    loadBrowsers: async () => browsersMock(),
    resolveClaude: () => { claudeResolved = true; return '/fake/claude'; },
    spawnClaude: () => { claudeSpawned = true; return { status: 0 }; },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(claudeResolved, false);
  assert.equal(claudeSpawned, false);
});
