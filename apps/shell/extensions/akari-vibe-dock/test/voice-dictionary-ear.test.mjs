import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { AkariEarServiceImpl } from '../lib/node/ear-service.js';
import { sharedHistory, voiceDictionaryPaths } from '../../../../../packages/akari-ear/src/index.mjs';

const modulePath = path.resolve(import.meta.dirname, '../../../../../packages/akari-ear/src/index.mjs');

test('偽ヘルパーの途中経過と確定に辞書を当て、確定だけを履歴に残す', async () => {
    const home = await mkdtemp(path.join(process.env.TMPDIR, 'vd-ear-'));
    const env = { AKARI_HOME: home };
    const helper = path.join(home, 'fake-ear.mjs');
    await writeFile(helper, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({type:'ready',locale:'ja-JP'})+'\\n');\nfor(const final of [false,true]) process.stdout.write(JSON.stringify({type:'stt',t:0.2,final,text:'てろっぷを出して'})+'\\n');\n`);
    await chmod(helper, 0o755);
    const history = sharedHistory({ env });
    history.setEnabled(true);
    const service = new AkariEarServiceImpl({ helperPath: helper, earModulePath: modulePath,
        platform: 'darwin', darwinMajor: 25, env });
    const utterances = [];
    const both = new Promise(resolve => service.setClient({ onStatus() {}, onLevel() {}, onUtterance(value) {
        utterances.push(value); if (utterances.length === 2) resolve();
    } }));
    try {
        await service.start({ purpose: 'note' });
        await both;
        assert.deepEqual(utterances.map(value => value.text), ['テロップを出して', 'テロップを出して']);
        assert.deepEqual(utterances[1].applied[0].range, [0, 4]);
        await history.flush();
        assert.equal((await history.list()).length, 1);
        assert.equal((await history.list())[0].text, 'テロップを出して');
    } finally { await service.stop(); await rm(home, { recursive: true, force: true }); }
});

test('壊れた自分の辞書でも発話が流れる', async () => {
    const home = await mkdtemp(path.join(process.env.TMPDIR, 'vd-ear-broken-'));
    const env = { AKARI_HOME: home };
    const paths = voiceDictionaryPaths({ env });
    await import('node:fs/promises').then(fs => fs.mkdir(path.dirname(paths.user), { recursive: true }));
    await writeFile(paths.user, '{');
    try {
        const service = new AkariEarServiceImpl({ earModulePath: modulePath, platform: 'win32', env,
            transcribe: async () => ({ segments: [{ t0: 0, t1: 1, text: 'てろっぷを出して' }] }) });
        const values = [];
        service.setClient({ onStatus() {}, onLevel() {}, onUtterance(value) { values.push(value); } });
        await service.start({ purpose: 'note' });
        await service.stop();
        assert.equal(values[0].text, 'テロップを出して');
    } finally { await rm(home, { recursive: true, force: true }); }
});
