import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCatalog } from '../../../../../packages/akari-vibe/src/jev/jev-actions.mjs';

test('新たに使える動きはシェルのコマンド登録を持つ', () => {
    const extensions = path.resolve(import.meta.dirname, '../..');
    const readSources = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) return readSources(file);
        return /\.tsx?$/.test(entry.name) ? [fs.readFileSync(file, 'utf8')] : [];
    });
    const sources = fs.readdirSync(extensions, { withFileTypes: true }).filter(entry => entry.isDirectory())
        .flatMap(entry => readSources(path.join(extensions, entry.name, 'src'))).join('\n');
    for (const action of loadCatalog().actions.filter(row => row.available && row.owner !== 'existing')) {
        for (const { commandId } of action.commands) {
            const direct = sources.includes(`registerCommand({ id: '${commandId}'`);
            const sketchName = commandId.startsWith('akari.sketch.') ? commandId.slice('akari.sketch.'.length) : undefined;
            const sketch = sketchName && sources.includes(`${sketchName}: { id: '${commandId}'`)
                && sources.includes(`registerCommand(ROUGH_CANVAS_COMMANDS.${sketchName}`);
            const browserName = commandId.startsWith('akari.browser.') ? commandId.slice('akari.browser.'.length) : undefined;
            const browserConstant = { search: 'BROWSER_SEARCH', pickMode: 'BROWSER_PICK_MODE', close: 'BROWSER_CLOSE' }[browserName];
            const browser = browserName && browserConstant && sources.includes(`${browserName}: '${commandId}'`)
                && sources.includes(`registerCommand(${browserConstant},`);
            assert.ok(direct || sketch || browser, commandId);
        }
    }
});
