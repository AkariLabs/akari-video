import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { setChildProcessLanguage } from '@akari-video/i18n';
import { probePartnerCliHelp } from '../../lib/node/akari-partner-server.js';

test('partner CLI spawn uses the latest app language', async () => {
    const previous = process.env.AKARI_LANG;
    const calls = [];
    const spawnImpl = (command, args, options) => {
        calls.push({ command, args, env: options.env });
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        queueMicrotask(() => { child.stdout.emit('data', Buffer.from('Usage')); child.emit('close', 0, null); });
        return child;
    };
    try {
        for (const [choice, expected] of [['en', 'en'], ['ja', 'ja'], ['auto', previous]]) {
            setChildProcessLanguage(choice);
            assert.equal((await probePartnerCliHelp('agent', process.platform,
                { PATH: 'bin', AKARI_LANG: 'stale' }, spawnImpl)).kind, 'ok');
            const call = calls.at(-1);
            assert.deepEqual(call.args, ['--help']);
            assert.equal(call.env.AKARI_LANG, expected);
            assert.equal(Object.hasOwn(call.env, 'AKARI_LANG'), expected !== undefined);
        }
    } finally {
        setChildProcessLanguage('auto');
        if (previous !== undefined) process.env.AKARI_LANG = previous;
    }
});
