import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/daihon/akari-caption-popup.ts', import.meta.url), 'utf8');

test('caption popup has no fixed dark surfaces or borders', () => {
    assert.doesNotMatch(source, /#(?:[1-4][0-9a-f]{5}|333|444)\b/iu);
});

test('footer buttons use Theia classes without overriding theme dimensions', () => {
    const helper = source.slice(source.indexOf('const button = '), source.indexOf('const plainButton = '));
    assert.ok(helper);
    assert.match(helper, /node\.className = 'theia-button secondary'/u);
    assert.doesNotMatch(helper, /node\.style|Object\.assign\(node\.style/u);
    const primaryAssignments = [...source.matchAll(/\.dataset\.primary = 'true';\s*(\w+)\.className = 'theia-button'/gu)];
    assert.equal(primaryAssignments.length, [...source.matchAll(/\.dataset\.primary = 'true'/gu)].length);
    assert.equal(primaryAssignments.length, 4);
});

test('step tabs use theme colors and an accent underline without Theia button classes', () => {
    const plainHelper = source.slice(source.indexOf('const plainButton = '), source.indexOf('/** All five entrances'));
    assert.doesNotMatch(plainHelper, /theia-button|className/u);
    assert.match(plainHelper, /border: '1px solid var\(--akari-line\)'/u);
    assert.match(plainHelper, /background: 'var\(--akari-card\)'/u);
    const render = source.slice(source.indexOf('    protected render(): void {'), source.indexOf('    protected async start():'));
    assert.match(render, /const control = plainButton\(/u);
    assert.match(render, /height: 'auto'/u);
    assert.match(render, /padding: '13px 5px'/u);
    assert.match(render, /borderBottom: index === this\.step \? '2px solid var\(--akari-accent\)' : '2px solid transparent'/u);
    assert.match(render, /color: index === this\.step \? 'var\(--akari-ink\)' : 'var\(--akari-muted\)'/u);
});

test('finish choices keep their own accent border and listen uses a plain button', () => {
    const finish = source.slice(source.indexOf('    protected renderFinish(): void {'), source.indexOf('    protected updateExample():'));
    assert.equal([...finish.matchAll(/const choice = plainButton\(/gu)].length, 2);
    assert.equal([...finish.matchAll(/choice\.style\.borderColor = 'var\(--akari-accent\)'/gu)].length, 2);
    assert.match(finish, /listen\.append\(plainButton\('▶ 聞く'/u);
});
