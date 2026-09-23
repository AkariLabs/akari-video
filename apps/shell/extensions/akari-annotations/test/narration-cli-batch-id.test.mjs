import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NarrationCliManager } from '../lib/node/narration-cli.js';

class ExposedCli extends NarrationCliManager {
    next(root) { return this.nextOutputId(root); }
}

test('一括生成の採番は未配置ファイルと edit.json の ID を両方避ける', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'akari-narration-id-'));
    try {
        await mkdir(path.join(root, 'out', 'narration'), { recursive: true });
        await writeFile(path.join(root, 'out', 'narration', 'n-0003.wav'), 'RIFF');
        await writeFile(path.join(root, 'edit.json'), JSON.stringify({ audio: { narration: [{ id: 'n-0002' }] } }));
        const cli = new ExposedCli();
        assert.equal(await cli.next(root), 'n-0004');
        await writeFile(path.join(root, 'out', 'narration', 'n-0004.wav'), 'RIFF');
        assert.equal(await cli.next(root), 'n-0005');
    } finally { await rm(root, { recursive: true, force: true }); }
});
