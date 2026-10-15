import assert from 'node:assert/strict';
import test from 'node:test';
import { choosePromptPartner, promptPartnerAncestorId, rememberPromptPartner } from '../lib/common/prompt-partner-target.js';

const targets = [
    { id: 'terminal-a', form: 'terminal', live: true },
    { id: 'terminal-b', form: 'terminal', live: true },
    { id: 'web', form: 'web', live: true },
    { id: 'extension', form: 'extension', live: true }
];

test('the last foreground partner wins, including the second terminal', () => {
    let last;
    for (const id of ['terminal-a', 'web', 'terminal-b', 'extension']) {
        last = rememberPromptPartner(last, { id }, targets);
        assert.equal(choosePromptPartner(last, targets).id, id);
    }
    assert.equal(rememberPromptPartner(last, { id: 'editor' }, targets), 'extension');
});

test('inner extension and web views resolve to the live parent partner', () => {
    const extension = { id: 'extension' };
    const web = { id: 'web' };
    const nestedExtension = { id: 'extension-editor', parent: { id: 'extension-tab', parent: extension } };
    const nestedWeb = { id: 'web-frame', parent: web };
    assert.equal(promptPartnerAncestorId(nestedExtension, targets), 'extension');
    assert.equal(promptPartnerAncestorId(nestedWeb, targets), 'web');
    let last = rememberPromptPartner('terminal-a', nestedExtension, targets);
    assert.equal(choosePromptPartner(last, targets).id, 'extension');
    last = rememberPromptPartner(last, nestedWeb, targets);
    assert.equal(choosePromptPartner(last, targets).id, 'web');
    assert.equal(rememberPromptPartner(last, { id: 'editor' }, targets), 'web');
    assert.equal(promptPartnerAncestorId(nestedWeb, targets.map(target => target.id === 'web'
        ? { ...target, live: false } : target)), undefined);
});

test('closed last partner falls back to live terminal, web, extension, then none', () => {
    assert.equal(choosePromptPartner('web', targets.map(target => target.id === 'web'
        ? { ...target, live: false } : target)).id, 'terminal-a');
    const noTerminals = targets.map(target => target.form === 'terminal' ? { ...target, live: false } : target);
    assert.equal(choosePromptPartner('terminal-b', noTerminals).id, 'web');
    const onlyExtension = noTerminals.map(target => target.id === 'web' ? { ...target, live: false } : target);
    assert.equal(choosePromptPartner('terminal-b', onlyExtension).id, 'extension');
    assert.equal(choosePromptPartner('terminal-b', onlyExtension.map(target => ({ ...target, live: false }))), undefined);
});
