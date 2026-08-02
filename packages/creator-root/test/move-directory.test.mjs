import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { moveDirectory } from '../src/index.mjs';
import { withScratchRoot } from './helpers.mjs';

test('moveDirectory: 同一デバイスでは rename で移動する', async () => {
    await withScratchRoot(async (scratch) => {
        const source = join(scratch, 'source');
        const destination = join(scratch, 'destination');
        await mkdir(source, { recursive: true });
        await writeFile(join(source, 'file.txt'), 'hello\n', 'utf8');

        const result = await moveDirectory(source, destination);
        assert.equal(result.method, 'rename');
        assert.ok((await stat(destination)).isDirectory());
        await assert.rejects(stat(source));
    });
});

test('moveDirectory: rename が EXDEV で失敗したら再帰コピー→検証→元削除にフォールバックする', async () => {
    await withScratchRoot(async (scratch) => {
        const source = join(scratch, 'source');
        const destination = join(scratch, 'destination');
        await mkdir(join(source, 'nested'), { recursive: true });
        await writeFile(join(source, 'file.txt'), 'hello\n', 'utf8');
        await writeFile(join(source, 'nested', 'inner.txt'), 'inner\n', 'utf8');

        const exdevError = Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
        const renameImpl = async () => { throw exdevError; };

        const result = await moveDirectory(source, destination, { renameImpl });
        assert.equal(result.method, 'copy-fallback');

        assert.equal(await readFile(join(destination, 'file.txt'), 'utf8'), 'hello\n');
        assert.equal(await readFile(join(destination, 'nested', 'inner.txt'), 'utf8'), 'inner\n');
        await assert.rejects(stat(source));
    });
});

test('moveDirectory: EXDEV 以外のエラーはそのまま投げてフォールバックしない（元は残る）', async () => {
    await withScratchRoot(async (scratch) => {
        const source = join(scratch, 'source');
        const destination = join(scratch, 'destination');
        await mkdir(source, { recursive: true });

        const otherError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
        const renameImpl = async () => { throw otherError; };

        await assert.rejects(moveDirectory(source, destination, { renameImpl }), (error) => {
            assert.equal(error.code, 'EACCES');
            return true;
        });

        assert.ok((await stat(source)).isDirectory());
        await assert.rejects(stat(destination));
    });
});
