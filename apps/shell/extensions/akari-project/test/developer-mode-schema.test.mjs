import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const extensionsRoot = fileURLToPath(new URL('../../', import.meta.url));

function* sourceFiles(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            yield* sourceFiles(path);
        } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
            yield path;
        }
    }
}

function schemaDeclarations(source) {
    // 文字列を保ったままコメントを除き、説明中の宣言例を数えない。
    const code = source.replace(/(['"])(?:\\.|(?!\1)[^\\])*?\1|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
        match => match.startsWith('/') ? ' ' : match);
    const constants = new Set([...code.matchAll(/\bconst\s+([\w$]+)\s*(?::\s*string\s*)?=\s*(['"])akari\.developerMode\2/g)]
        .map(([, name]) => name));
    return [...code.matchAll(/(['"])akari\.developerMode\1\s*:\s*\{|\[\s*([\w$]+)\s*\]\s*:\s*\{/g)]
        .filter(match => match[1] || constants.has(match[2]));
}

test('スキーマ宣言を文字列定数・参照・コメントと区別する', () => {
    assert.equal(schemaDeclarations(`
        export const MODE = 'akari.developerMode';
        preferences.get('akari.developerMode', false);
        preferences.get(MODE);
        // 'akari.developerMode': { type: 'boolean' }
        /* [MODE]: { type: 'boolean' } */
    `).length, 0);
    assert.equal(schemaDeclarations(`
        const MODE: string = 'akari.developerMode';
        const schema = { properties: {
            'akari.developerMode': { type: 'boolean' },
            "akari.developerMode": { type: 'boolean' },
            [MODE]: { type: 'boolean' }
        } };
    `).length, 3);
});

test('akari.developerMode のスキーマ宣言は akari-project の 1 か所だけ', () => {
    const declarations = [];
    for (const extension of readdirSync(extensionsRoot, { withFileTypes: true })) {
        if (!extension.isDirectory()) { continue; }
        const extensionRoot = join(extensionsRoot, extension.name);
        if (!readdirSync(extensionRoot).includes('src')) { continue; }
        for (const path of sourceFiles(join(extensionRoot, 'src'))) {
            for (const _match of schemaDeclarations(readFileSync(path, 'utf8'))) {
                declarations.push(relative(extensionsRoot, path).split(sep).join('/'));
            }
        }
    }
    assert.equal(declarations.length, 1, `schema declarations: ${JSON.stringify(declarations)}`);
    assert.deepEqual(declarations, ['akari-project/src/browser/akari-project-frontend-module.ts']);
});
