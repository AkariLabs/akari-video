import test from 'node:test';
import assert from 'node:assert/strict';
import { AKARI_PROJECT_SURFACE, AKARI_PROJECT_LINE } from '../lib/common/akari-surface-tokens.js';
import { memberText } from './helpers/role-buckets-source.mjs';

test('プロジェクト専用の面と線はテーマ変数を参照する', () => {
    assert.deepEqual(AKARI_PROJECT_SURFACE, {
        base: 'var(--akari-panel-project)',
        item: 'var(--akari-panel-project-item)',
        elevated: 'var(--akari-panel-project-elevated)'
    });
    assert.equal(AKARI_PROJECT_LINE, 'var(--akari-panel-project-line)');
    assert.doesNotMatch(JSON.stringify({ AKARI_PROJECT_SURFACE, AKARI_PROJECT_LINE }), /#[0-9a-f]{3,8}/i);
});

test('上のプロジェクト面と切り替え帯だけに専用色を適用する', () => {
    const render = memberText('render', { in: 'widget' });
    const controls = memberText('renderTopControls', { in: 'widget' });
    assert.match(render, /background: libraryOnly \? undefined : AKARI_PROJECT_SURFACE\.base/);
    assert.match(render, /borderBottom: libraryOnly \? undefined : `1px solid \$\{AKARI_PROJECT_LINE\}`/);
    assert.match(controls, /this\.topView === 'materials' \? AKARI_PROJECT_SURFACE\.base : undefined/);
    assert.match(controls, /this\.topView === 'materials' \? AKARI_PROJECT_SURFACE\.item : AKARI_SURFACE\.raised/);
    assert.match(controls, /this\.topView === 'materials' \? AKARI_PROJECT_SURFACE\.elevated : AKARI_SURFACE\.elevated/);
    assert.match(render, /minHeight: 0, overflow: 'hidden'/);
    assert.match(render, /this\.lintPane\.renderLintBadge\(\)/);
});
