import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePromptRoute } from '../lib/common/prompt-route.js';

const extension = { agent: 'claude', focusCommandId: 'claude-vscode.focus' };
const webPartner = { agent: 'deepseek' };

test('注入先は PTY、再接続、拡張ビュー、web の順に選ぶ', () => {
    assert.deepEqual(resolvePromptRoute({ hasChannel: true, hasLiveTerminal: true, visibleExtension: extension, webPartner }), { route: 'pty' });
    assert.deepEqual(resolvePromptRoute({ hasChannel: false, hasLiveTerminal: true, visibleExtension: extension, webPartner }), { route: 'reattach-pty' });
    assert.deepEqual(resolvePromptRoute({ hasChannel: false, hasLiveTerminal: false, visibleExtension: extension, webPartner }),
        { route: 'copy', form: 'extension', agent: 'claude', focusCommandId: 'claude-vscode.focus' });
    assert.deepEqual(resolvePromptRoute({ hasChannel: false, hasLiveTerminal: false, webPartner }),
        { route: 'copy', form: 'web', agent: 'deepseek' });
    assert.deepEqual(resolvePromptRoute({ hasChannel: false, hasLiveTerminal: false }), { route: 'none' });
});
