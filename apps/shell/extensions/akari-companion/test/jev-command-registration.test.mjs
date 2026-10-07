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
            assert.ok(sources.includes(`registerCommand({ id: '${commandId}'`), commandId);
        }
    }
});
