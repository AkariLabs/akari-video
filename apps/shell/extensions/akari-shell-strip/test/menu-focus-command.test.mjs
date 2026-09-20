import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../src/browser/akari-menu-command-contribution.ts');

test('exactly the three external menu commands are registered', () => {
    assert.deepEqual([...source.matchAll(/id:\s*'(akari\.menu\.[^']+)'/g)].map(match => match[1]), [
        'akari.menu.focus', 'akari.menu.listSkills', 'akari.menu.listOpenTargets'
    ]);
    assert.deepEqual([...source.matchAll(/registry\.registerCommand\(AkariMenuFocusCommands\.(\w+),/g)].map(match => match[1]), [
        'FOCUS', 'LIST_SKILLS', 'LIST_OPEN_TARGETS'
    ]);
    assert.equal([...source.matchAll(/registry\.registerCommand\(/g)].length, 3);
    assert.doesNotMatch(source, /from\s+['"][^'"]*akari-partner/);
});

test('focus validates before opening and activates before focusing', () => {
    assert.match(source, /readAkariMenuFocusArgs\(raw\);\s*if \(args === undefined\) \{\s*return false;\s*\}\s*const widget = await this\.widgetManager\.getOrCreateWidget/);
    assert.match(source, /if \(!widget\.isAttached\) \{\s*this\.shell\.addWidget\(widget, \{ area: 'left', rank: 500 \}\);\s*\}\s*await this\.shell\.activateWidget\(widget\.id\);\s*return widget\.focusSection\(args\);/);
    assert.match(source, /return widget\.listSkills\(\);/);
});

test('open targets reflect the current map state and expose only IDs and labels', () => {
    const execute = source.slice(source.indexOf('registry.registerCommand(AkariMenuFocusCommands.LIST_OPEN_TARGETS'));
    assert.match(execute, /akariMenuRows\(\{ worldMap: this\.scopeService\.worldMap\.state === 'present' \}\)/);
    assert.match(execute, /\.map\(row => \(\{ id: row\.id, label: row\.label \}\)\)/);
    assert.doesNotMatch(execute, /\bicon\b/);
});

test('frontend module binds the command contribution as a singleton', () => {
    const module = read('../src/browser/akari-shell-strip-frontend-module.ts');
    assert.match(module, /bind\(AkariMenuFocusCommandContribution\)\.toSelf\(\)\.inSingletonScope\(\);/);
    assert.match(module, /bind\(CommandContribution\)\.toService\(AkariMenuFocusCommandContribution\);/);
});
