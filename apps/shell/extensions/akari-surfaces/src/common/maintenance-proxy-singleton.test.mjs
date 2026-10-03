import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const extensions = resolve(import.meta.dirname, '../../..');

function browserSources(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return browserSources(path);
        return /[/\\]src[/\\]browser[/\\]/.test(path) && /\.tsx?$/.test(path) ? [path] : [];
    });
}

test('the settings maintenance RPC has exactly one browser proxy across extensions', () => {
    const matches = [];
    const sources = readdirSync(extensions, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .flatMap(entry => {
            const browser = join(extensions, entry.name, 'src', 'browser');
            return existsSync(browser) ? browserSources(browser) : [];
        });
    for (const file of sources) {
        const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
            file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const visit = node => {
            if (ts.isCallExpression(node) && node.expression.getText(source).endsWith('createProxy')
                && node.arguments.some(argument => argument.getText(source) === 'AKARI_SETTINGS_MAINTENANCE_PATH'
                    || ts.isStringLiteral(argument) && argument.text === '/services/akari-settings-maintenance')) {
                matches.push(file);
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    assert.equal(matches.length, 1, matches.join('\n'));
    assert.match(matches[0], /akari-surfaces-frontend-module\.ts$/);
});
