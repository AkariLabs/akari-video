import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { AkariVoiceDictionaryServiceImpl } from '../lib/node/voice-dictionary-service.js';
import { sharedHistory } from '../../../../../packages/akari-ear/src/index.mjs';

test('サービスは不正な項目と同梱の削除を拒否し、上書きを表示する', async () => {
    const home = await mkdtemp(path.join(process.env.TMPDIR, 'vd-service-'));
    try {
        const service = new AkariVoiceDictionaryServiceImpl({ AKARI_HOME: home });
        const invalid = await service.upsert({ kind: 'fix', from: ['てろっぷ'] });
        assert.equal(invalid.ok, false);
        assert.match(invalid.errors.join(' '), /to/);
        assert.equal((await service.remove('vd-builtin-telop')).ok, false);
        const saved = await service.upsert({ kind: 'fix', from: ['てろっぷ'], to: '表示文字' });
        assert.equal(saved.ok, true);
        assert.ok((await service.list()).overriddenIds.includes('vd-builtin-telop'));
        const history = sharedHistory({ env: { AKARI_HOME: home } });
        history.setEnabled(true);
        history.record({ id: 'u1', final: true, purpose: 'note', raw: 'てろっぷを出して', text: 'テロップを出して' });
        await history.flush();
        assert.equal((await service.history())[0].text, '表示文字を出して');
        assert.equal(await service.countHistoryMatches(saved.entry.id), 1);
    } finally { await rm(home, { recursive: true, force: true }); }
});
