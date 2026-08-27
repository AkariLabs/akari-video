import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolveExecutablePath } from '../../bake-layer/src/find-chrome.mjs';
import { describeChromeNotFound } from '../src/render-cut.mjs';

const header = 'Chrome for Testing / Chromium / システム Chrome のいずれも見つかりません。';
const searchedHeader = '以下を探しましたが見つかりませんでした:';
const guidance = [
  '`akari chrome install` を実行するか、システムに Google Chrome をインストールしてください。',
  'システムの node がある場合は `npx puppeteer browsers install chrome` でも導入できます。',
];

test('Chrome 不在メッセージは探索候補と導入経路を列挙する', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-render-chrome-message-'));
  try {
    const lines = (await describeChromeNotFound({
      homeDirectory: scratch,
      platform: 'darwin',
      env: {},
      systemCandidates: ['/nope/chrome'],
    })).split('\n');
    assert.equal(lines[0], header);
    assert.equal(lines[1], searchedHeader);
    assert.ok(lines.includes('  - /nope/chrome'));
    assert.deepEqual(lines.slice(-2), guidance);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('render-cut と bake-layer は共通部分を同一文言で案内する', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-bake-chrome-message-'));
  try {
    const renderLines = (await describeChromeNotFound({
      homeDirectory: scratch,
      platform: 'darwin',
      env: {},
      systemCandidates: ['/nope/chrome'],
    })).split('\n');
    await assert.rejects(
      resolveExecutablePath(
        { executablePath: () => { throw new Error('no pin'); } },
        {
          homeDirectory: scratch,
          platform: 'darwin',
          env: {},
          systemCandidates: ['/nope/chrome'],
        }
      ),
      (cause) => {
        const bakeLines = cause.message.split('\n');
        assert.deepEqual(bakeLines.slice(0, 2), renderLines.slice(0, 2));
        assert.deepEqual(bakeLines.slice(-2), renderLines.slice(-2));
        return true;
      }
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('CHROME_PATH は探索候補として列挙する', async () => {
  const message = await describeChromeNotFound({
    homeDirectory: '/nope/home',
    platform: 'darwin',
    env: { CHROME_PATH: '/custom/chrome' },
    systemCandidates: [],
  });
  assert.match(message, /^  - \/custom\/chrome$/mu);
});
