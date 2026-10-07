import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ROUGH_CANVAS_COMMANDS, SKETCH_NOT_OPEN, validRoughCanvasTool, confirmRoughCanvasSend, withOpenRoughCanvas } from '../lib/browser/rough-canvas/rough-canvas-command-model.js';

test('7 コマンドは受け口の表と一致', async () => {
    const catalog = JSON.parse(await readFile(new URL('../../../../../packages/akari-vibe/src/jev/jev-actions.json', import.meta.url)));
    const actions = catalog.actions;
    const expected = actions.filter(entry => entry.id?.startsWith('roughCanvas.')).map(entry => entry.commands[0].commandId).sort();
    assert.deepEqual(Object.values(ROUGH_CANVAS_COMMANDS).map(item => item.id).sort(), expected);
});
test('道具の引数と閉じた紙への操作', () => {
    for (const tool of ['select', 'pen', 'arrow', 'text']) assert.equal(validRoughCanvasTool({ tool }), true);
    for (const argument of [undefined, {}, { tool: 'erase' }, { tool: 1 }]) assert.equal(validRoughCanvasTool(argument), false);
    assert.deepEqual(SKETCH_NOT_OPEN, { ok: false, reason: 'sketch-not-open' });
    assert.deepEqual(withOpenRoughCanvas(undefined, () => { throw new Error('called'); }), SKETCH_NOT_OPEN);
    assert.deepEqual(withOpenRoughCanvas({ isOpen: false }, () => { throw new Error('called'); }), SKETCH_NOT_OPEN);
    assert.equal(withOpenRoughCanvas({ isOpen: true }, () => 3), 3);
});
test('送信は同じ入力の二度目でだけ実行', () => {
    assert.deepEqual(confirmRoughCanvasSend(false), { execute: false, armed: true });
    assert.deepEqual(confirmRoughCanvasSend(true), { execute: true, armed: false });
});
