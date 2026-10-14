import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { chatEnabled, chatCommandAllowed, shouldCloseRestoredChat, CHAT_ENABLED_PREFERENCE } = require('../lib/browser/chat-visibility.js');

test('AKARI チャットは明示的な true のときだけ表示とコマンド実行を許可する', () => {
    for (const value of [undefined, null, false, 'true', 1]) {
        assert.equal(chatEnabled(value), false);
        assert.equal(chatCommandAllowed(value), false);
    }
    assert.equal(chatEnabled(true), true);
    assert.equal(chatCommandAllowed(true), true);
    assert.equal(shouldCloseRestoredChat('akari-chat-widget', false), true);
    assert.equal(shouldCloseRestoredChat('akari-chat-widget', true), false);
    assert.equal(shouldCloseRestoredChat('other-widget', false), false);
});

test('レイアウト復元後と遅れて追加されたチャットをオフなら閉じる', async () => {
    const sourceText = readFileSync(new URL('../src/browser/akari-chat-contribution.ts', import.meta.url), 'utf8');
    const source = ts.createSourceFile('chat.ts', sourceText, ts.ScriptTarget.Latest, true);
    const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariChatContribution');
    const names = ['queueVisibility', 'syncVisibility', 'onStart', 'onDidInitializeLayout'];
    const members = owner.members.filter(node => names.includes(node.name?.getText(source))
        || node.name?.getText(source) === 'visibilityTail').map(node => node.getText(source));
    const compiled = ts.transpileModule(`class Contribution { ${members.join('\n')} }`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const Constructor = new Function('chatEnabled', 'shouldCloseRestoredChat', 'CHAT_ENABLED_PREFERENCE',
        'AkariChatWidget', 'console', `${compiled}\nreturn Contribution;`)(chatEnabled, shouldCloseRestoredChat,
        CHAT_ENABLED_PREFERENCE, { ID: 'akari-chat-widget' }, { warn: () => assert.fail('unexpected warning') });
    const contribution = new Constructor();
    const calls = [];
    let current;
    let added;
    contribution.preferences = { ready: Promise.resolve(), get: () => false, onPreferenceChanged: () => {} };
    contribution.widgets = { getWidget: async () => { calls.push('get'); return current; } };
    contribution.shell = { onDidAddWidget: listener => { added = listener; } };
    contribution.chat = { closeAll: async () => { calls.push('close'); } };
    const restored = () => ({ id: 'akari-chat-widget', dispose() { calls.push('dispose'); current = undefined; } });
    contribution.onStart();
    await contribution.visibilityTail;
    assert.deepEqual(calls, ['get']);
    current = restored();
    await contribution.onDidInitializeLayout();
    assert.deepEqual(calls, ['get', 'get', 'dispose', 'close']);
    current = restored();
    added(current);
    await contribution.visibilityTail;
    assert.deepEqual(calls.slice(-3), ['get', 'dispose', 'close']);
});
