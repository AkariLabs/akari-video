import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { typedPromptText } = require('../lib/common/type-prompt.js');
const { TerminalPartnerChannel } = require('../lib/browser/partner-channel.js');

test('入力欄の文末に空白を一つだけ補う', () => {
    assert.equal(typedPromptText('/skill'), '/skill ');
    assert.equal(typedPromptText('/skill '), '/skill ');
    assert.equal(typedPromptText('/skill\n'), '/skill\n');
});

test('type は改行を送らず、コマンドは三つの結果を持つ', () => {
    const sent = [];
    const terminal = { isDisposed: false, onOutput: () => ({ dispose() {} }), sendText: text => sent.push(text) };
    const channel = new TerminalPartnerChannel(terminal);
    channel.type(typedPromptText('/skill'));
    channel.dispose();
    assert.deepEqual(sent, ['/skill ']);
    const commands = readFileSync(new URL('../src/browser/akari-partner-command-contribution.ts', import.meta.url), 'utf8');
    assert.match(commands, /Promise<'typed' \| 'no-partner' \| 'unsupported'>/);
    assert.match(commands, /return 'typed'/);
    assert.match(commands, /return 'no-partner'/);
    assert.match(commands, /return 'unsupported'/);
});
