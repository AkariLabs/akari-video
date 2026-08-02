import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { resolveAkariHome, updateMachinePointer } from '../src/index.mjs';
import { withScratchRoot } from './helpers.mjs';

test('updateMachinePointer: <AKARI_HOME>/creator-root.json に lastRoot / updatedAt を原子的に書き込む', async () => {
    await withScratchRoot(async (scratch) => {
        const root = join(scratch, 'AkariVideo');
        const akariHome = join(scratch, 'dot-akari');

        const pointer = await updateMachinePointer(root, { AKARI_HOME: akariHome });

        assert.equal(pointer.lastRoot, root);
        assert.ok(typeof pointer.updatedAt === 'string' && !Number.isNaN(Date.parse(pointer.updatedAt)));

        const onDisk = JSON.parse(await readFile(join(akariHome, 'creator-root.json'), 'utf8'));
        assert.deepEqual(onDisk, pointer);
    });
});

test('updateMachinePointer: 2 回目の呼び出しで前回の内容を最新へ置き換える', async () => {
    await withScratchRoot(async (scratch) => {
        const rootA = join(scratch, 'AkariVideo-A');
        const rootB = join(scratch, 'AkariVideo-B');
        const akariHome = join(scratch, 'dot-akari');

        await updateMachinePointer(rootA, { AKARI_HOME: akariHome });
        const second = await updateMachinePointer(rootB, { AKARI_HOME: akariHome });

        const onDisk = JSON.parse(await readFile(join(akariHome, 'creator-root.json'), 'utf8'));
        assert.equal(onDisk.lastRoot, rootB);
        assert.deepEqual(onDisk, second);
    });
});

test('resolveAkariHome: 既定は <home>/.akari（HOME 注入で検証）', () => {
    const home = resolveAkariHome({ HOME: '/Users/example' }, { platform: 'darwin' });
    assert.equal(home, join('/Users/example', '.akari'));
});

test('resolveAkariHome: AKARI_HOME が設定されていれば最優先する（既存規約）', () => {
    const home = resolveAkariHome({ HOME: '/Users/example', AKARI_HOME: '/custom/akari-home' }, { platform: 'darwin' });
    assert.equal(home, '/custom/akari-home');
});

test('resolveAkariHome: win32 は USERPROFILE 起点になる（実 Windows 不要・env 注入で分岐を検証）', () => {
    const home = resolveAkariHome({ USERPROFILE: 'C:\\Users\\example' }, { platform: 'win32' });
    assert.equal(home, join('C:\\Users\\example', '.akari'));
});
