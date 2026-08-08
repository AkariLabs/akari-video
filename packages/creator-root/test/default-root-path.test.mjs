import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { defaultRootPath } from '../src/index.mjs';

test('defaultRootPath: posix は HOME 起点で <home>/Akari を返す', () => {
    const result = defaultRootPath({ HOME: '/Users/example' }, { platform: 'darwin' });
    assert.equal(result, join('/Users/example', 'Akari'));
});

test('defaultRootPath: win32 は USERPROFILE 起点になる（実 Windows 不要・env 注入で分岐を検証）', () => {
    const result = defaultRootPath({ USERPROFILE: 'C:\\Users\\example' }, { platform: 'win32' });
    assert.equal(result, join('C:\\Users\\example', 'Akari'));
});

test('defaultRootPath: win32 で USERPROFILE が無ければ HOMEDRIVE+HOMEPATH にフォールバックする', () => {
    const result = defaultRootPath({ HOMEDRIVE: 'C:', HOMEPATH: '\\Users\\example' }, { platform: 'win32' });
    assert.equal(result, join('C:\\Users\\example', 'Akari'));
});

test('defaultRootPath: win32 でも USERPROFILE が優先される（HOMEDRIVE/HOMEPATH より優先）', () => {
    const result = defaultRootPath({
        USERPROFILE: 'C:\\Users\\primary',
        HOMEDRIVE: 'C:',
        HOMEPATH: '\\Users\\secondary'
    }, { platform: 'win32' });
    assert.equal(result, join('C:\\Users\\primary', 'Akari'));
});
